import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const {
  buildCorsHeaders,
  buildControlPlaneAzureRequestBody,
  buildWorkerEnvironment,
  clearLauncherProfilePat,
  deleteLauncherProfile,
  getLauncherPaths,
  listLauncherProfiles,
  loadLauncherProfile,
  mergeLauncherProfileForConnect,
  normalizeConnectPayload,
  redactProfile,
  saveLauncherProfile,
} = await import("../scripts/local-launcher-utils.mjs");

const testCipher = {
  protect: async (value) => Buffer.from(value, "utf8").toString("base64"),
  unprotect: async (value) => Buffer.from(value, "base64").toString("utf8"),
};

test("launcher connect payload validation locks to allowed control plane origins", () => {
  const profile = normalizeConnectPayload(
    {
      controlPlaneUrl: "https://control-plane.example.com/app/path",
      worker: {
        workerId: "local-user-local",
        token: "cw_token",
        repoPath: "C:\\repo",
        sandboxMode: "danger-full-access",
        autoCommitAndPr: true,
      },
      azurePat: "secret-pat",
    },
    ["https://control-plane.example.com"],
  );

  assert.equal(profile.controlPlaneUrl, "https://control-plane.example.com");
  assert.equal(profile.controlPlaneOrigin, "https://control-plane.example.com");
  assert.equal(profile.workerId, "local-user-local");
  assert.equal(profile.sandboxMode, "danger-full-access");
  assert.equal(profile.autoCommitAndPr, true);
  assert.equal(profile.azurePat, "secret-pat");
});

test("launcher rejects a control plane URL outside configured origins", () => {
  assert.throws(
    () =>
      normalizeConnectPayload(
        {
          controlPlaneUrl: "https://evil.example.com",
          worker: { workerId: "worker", token: "token" },
        },
        ["https://control-plane.example.com"],
      ),
    /not allowed/,
  );
});

test("launcher CORS allows configured app origin and blocks unknown origins", () => {
  const allowed = buildCorsHeaders("https://control-plane.example.com", [
    "https://control-plane.example.com",
  ]);
  const blocked = buildCorsHeaders("https://evil.example.com", [
    "https://control-plane.example.com",
  ]);

  assert.equal(
    allowed?.["Access-Control-Allow-Origin"],
    "https://control-plane.example.com",
  );
  assert.equal(blocked, null);
});

test("launcher worker environment preserves runtime inputs without logging secrets", () => {
  const env = buildWorkerEnvironment({
    controlPlaneUrl: "https://control-plane.example.com",
    workerId: "worker",
    token: "cw_token",
    repoPath: "C:\\repo",
    sandboxMode: "workspace-write",
    autoCommitAndPr: true,
    azurePat: "secret-pat",
  });

  assert.deepEqual(env, {
    CONTROL_PLANE_URL: "https://control-plane.example.com",
    WORKER_ID: "worker",
    WORKER_TOKEN: "cw_token",
    REPO_PATH: "C:\\repo",
    CODEX_SANDBOX_MODE: "workspace-write",
    AZURE_DEVOPS_PAT: "secret-pat",
    CONTROL_PLANE_AUTO_COMMIT_PR: "1",
  });
});

test("launcher reconnect preserves a saved PAT when no replacement PAT is submitted", () => {
  const existingProfile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: {
        workerId: "worker-preserve-pat",
        token: "old-token",
        sandboxMode: "danger-full-access",
        autoCommitAndPr: true,
      },
      azurePat: "secret-pat",
    },
    ["http://localhost:3000"],
  );
  const reconnectProfile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: {
        workerId: "worker-preserve-pat",
        token: "new-token",
        sandboxMode: "danger-full-access",
        autoCommitAndPr: true,
      },
      azurePat: "",
    },
    ["http://localhost:3000"],
  );

  const merged = mergeLauncherProfileForConnect(
    reconnectProfile,
    existingProfile,
  );

  assert.equal(merged.azurePat, "secret-pat");
  assert.equal(merged.token, "new-token");
  assert.equal(merged.sandboxMode, "danger-full-access");
  assert.equal(merged.autoCommitAndPr, true);
});

test("launcher reconnect clears a saved PAT when auto commit is disabled", () => {
  const existingProfile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: {
        workerId: "worker-disable-pat",
        token: "old-token",
        autoCommitAndPr: true,
      },
      azurePat: "secret-pat",
    },
    ["http://localhost:3000"],
  );
  const reconnectProfile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: {
        workerId: "worker-disable-pat",
        token: "new-token",
        autoCommitAndPr: false,
      },
      azurePat: "",
    },
    ["http://localhost:3000"],
  );

  const merged = mergeLauncherProfileForConnect(
    reconnectProfile,
    existingProfile,
  );

  assert.equal(merged.azurePat, "");
  assert.equal(merged.autoCommitAndPr, false);
});

test("launcher Azure request body injects saved PAT without trusting browser credentials", () => {
  const body = buildControlPlaneAzureRequestBody(
    {
      workerId: "worker-azure",
      config: { orgUrl: "https://dev.azure.com/org" },
      credentials: { pat: "browser-pat" },
      iterationPath: "Project\\Sprint 1",
      top: 25,
    },
    { azurePat: "saved-pat" },
  );

  assert.deepEqual(body, {
    config: { orgUrl: "https://dev.azure.com/org" },
    credentials: { pat: "saved-pat" },
    iterationPath: "Project\\Sprint 1",
    top: 25,
  });
});

test("launcher Azure request body requires a saved PAT", () => {
  assert.throws(
    () => buildControlPlaneAzureRequestBody({ workerId: "worker-azure" }, {}),
    /Azure PAT is not saved/,
  );
});

test("launcher profile PAT clear preserves non-secret worker settings", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "launcher-clear-pat-"));
  const paths = getLauncherPaths(tempDir);
  const profile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: {
        workerId: "worker-clear-pat",
        token: "token",
        repoPath: "C:\\repo",
        sandboxMode: "danger-full-access",
        autoCommitAndPr: true,
      },
      azurePat: "secret-pat",
    },
    ["http://localhost:3000"],
  );

  await saveLauncherProfile(paths, profile, testCipher);
  const updated = await clearLauncherProfilePat(
    paths,
    profile.workerId,
    testCipher,
  );
  const loaded = await loadLauncherProfile(paths, profile.workerId, testCipher);

  assert.equal(updated.azurePat, "");
  assert.equal(loaded.azurePat, "");
  assert.equal(loaded.workerId, profile.workerId);
  assert.equal(loaded.token, profile.token);
  assert.equal(loaded.repoPath, profile.repoPath);
  assert.equal(loaded.sandboxMode, profile.sandboxMode);
  assert.equal(loaded.autoCommitAndPr, true);
  assert.equal(redactProfile(loaded).hasAzurePat, false);
  assert.deepEqual(buildWorkerEnvironment(loaded), {
    CONTROL_PLANE_URL: "http://localhost:3000",
    WORKER_ID: "worker-clear-pat",
    WORKER_TOKEN: "token",
    REPO_PATH: "C:\\repo",
    CODEX_SANDBOX_MODE: "danger-full-access",
    CONTROL_PLANE_AUTO_COMMIT_PR: "1",
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("launcher profile save/load/delete round-trips encrypted profile content", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "launcher-profile-"));
  const paths = getLauncherPaths(tempDir);
  const profile = normalizeConnectPayload(
    {
      controlPlaneUrl: "http://localhost:3000",
      worker: { workerId: "worker-profile", token: "token" },
    },
    ["http://localhost:3000"],
  );

  await saveLauncherProfile(paths, profile, testCipher);
  assert.deepEqual(await loadLauncherProfile(paths, profile.workerId, testCipher), profile);
  assert.equal((await listLauncherProfiles(paths, testCipher)).length, 1);

  await deleteLauncherProfile(paths, profile.workerId);
  assert.equal((await listLauncherProfiles(paths, testCipher)).length, 0);
  await rm(tempDir, { recursive: true, force: true });
});

test(
  "Windows DPAPI profile cipher can persist a launcher profile",
  { skip: process.platform !== "win32" },
  async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "launcher-dpapi-"));
    const paths = getLauncherPaths(tempDir);
    const profile = normalizeConnectPayload(
      {
        controlPlaneUrl: "http://localhost:3000",
        worker: { workerId: "worker-dpapi", token: "token" },
      },
      ["http://localhost:3000"],
    );

    await saveLauncherProfile(paths, profile);
    assert.deepEqual(await loadLauncherProfile(paths, profile.workerId), profile);

    await deleteLauncherProfile(paths, profile.workerId);
    await rm(tempDir, { recursive: true, force: true });
  },
);
