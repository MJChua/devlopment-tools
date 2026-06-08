import assert from "node:assert/strict";
import test from "node:test";

const { GET } = await import("../src/app/api/workers/bootstrap/route.ts");

test("worker bootstrap serves launcher installer with no-store headers", async () => {
  const response = await GET(
    new Request(
      "http://localhost:3000/api/workers/bootstrap?file=local-launcher-install.ps1",
    ),
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/plain/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(body, /CodexMissionControlLocalLauncher/);
  assert.match(body, /-RunLevel Limited/);
  assert.doesNotMatch(body, /LeastPrivilege/);
  assert.match(body, /Startup folder/);
  assert.match(body, /temporary-startup-folder/);
  assert.match(body, /requiresAdminInstall/);
  assert.match(body, /scheduledTaskStatus/);
  assert.match(body, /Open PowerShell as Administrator/);
  assert.match(body, /Install-StartupShortcut/);
  assert.match(body, /Stop-ExistingLauncher/);
  assert.match(body, /Start-Process/);
});

test("worker bootstrap serves local launcher scripts", async () => {
  const response = await GET(
    new Request(
      "http://localhost:3000/api/workers/bootstrap?file=local-launcher.mjs",
    ),
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/javascript/);
  assert.match(body, /LOCAL_LAUNCHER_HOST/);
  assert.match(body, /sendErrorJson\(response, error/);
  assert.match(body, /launcher_profile_missing/);
});

test("worker bootstrap serves a hash manifest for worker scripts", async () => {
  const response = await GET(
    new Request(
      "http://localhost:3000/api/workers/bootstrap?file=worker-manifest.json",
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(body.workerVersion, /^\d{4}\.\d{2}\.\d{2}\./);
  assert.equal(body.launcherVersion, "0.2.2");
  assert.equal(
    body.files.some(
      (file) =>
        file.name === "local-worker.mjs" && /^[a-f0-9]{64}$/.test(file.sha256),
    ),
    true,
  );
  assert.equal(
    body.files.some(
      (file) =>
        file.name === "local-worker-utils.mjs" &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    ),
    true,
  );
  assert.equal(
    body.launcherFiles.some(
      (file) =>
        file.name === "local-launcher.mjs" &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    ),
    true,
  );
  assert.equal(
    body.launcherFiles.some(
      (file) =>
        file.name === "local-launcher-utils.mjs" &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    ),
    true,
  );
});

test("worker bootstrap rejects unknown files", async () => {
  const response = await GET(
    new Request("http://localhost:3000/api/workers/bootstrap?file=secret.env"),
  );

  assert.equal(response.status, 404);
});
