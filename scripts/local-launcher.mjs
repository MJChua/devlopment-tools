import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  LOCAL_LAUNCHER_HOST,
  LOCAL_LAUNCHER_PORT,
  LOCAL_LAUNCHER_VERSION,
  WORKER_MANIFEST_FILE,
  applyWorkerManifestToProfile,
  buildCorsHeaders,
  buildControlPlaneAzureRequestBody,
  buildLauncherWorkerStatus,
  buildWorkerEnvironment,
  clearLauncherProfilePat,
  deleteLauncherProfile,
  ensureLauncherDirectories,
  getLauncherPaths,
  getWorkerManifestFile,
  hashWorkerFileContent,
  isWorkerManifestCurrent,
  listLauncherProfiles,
  loadLauncherConfig,
  loadLauncherProfile,
  mergeLauncherProfileForConnect,
  normalizeWorkerBootstrapManifest,
  normalizeConnectPayload,
  redactProfile,
  saveLauncherProfile,
} from "./local-launcher-utils.mjs";

const workerFiles = ["local-worker.mjs", "local-worker-utils.mjs"];
const paths = getLauncherPaths();
const workerProcesses = new Map();
const workerRestartsInFlight = new Set();
const workerSupervisorIntervalMs = 15000;

async function main() {
  await ensureLauncherDirectories(paths);
  await appendLauncherLog(
    `starting launcher ${LOCAL_LAUNCHER_VERSION} on ${LOCAL_LAUNCHER_HOST}:${LOCAL_LAUNCHER_PORT}`,
  );

  await startSavedProfiles();
  startWorkerSupervisor();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      void appendLauncherLog(`request failed: ${formatError(error)}`);
      sendErrorJson(response, error);
    });
  });

  server.listen(LOCAL_LAUNCHER_PORT, LOCAL_LAUNCHER_HOST, () => {
    void appendLauncherLog(
      `launcher listening on http://${LOCAL_LAUNCHER_HOST}:${LOCAL_LAUNCHER_PORT}`,
    );
  });
}

async function handleRequest(request, response) {
  const config = await loadLauncherConfig(paths);
  const origin = request.headers.origin || "";
  const corsHeaders = buildCorsHeaders(origin, config.allowedOrigins);

  if (!corsHeaders) {
    sendJson(response, 403, { ok: false, error: "Origin is not allowed." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url || "/", `http://${LOCAL_LAUNCHER_HOST}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(
        response,
        200,
        {
          ok: true,
          name: "Codex Mission Control Local Launcher",
          version: LOCAL_LAUNCHER_VERSION,
          port: LOCAL_LAUNCHER_PORT,
          installMode: config.installMode,
          scheduledTaskStatus: config.scheduledTaskStatus,
          requiresAdminInstall: config.requiresAdminInstall,
          scheduledTaskError: config.scheduledTaskError,
        },
        corsHeaders,
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const workerId = url.searchParams.get("workerId")?.trim() || "";
      const status = await getStatus(workerId);
      sendJson(response, 200, status, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/connect") {
      const payload = await readJsonBody(request);
      const profile = normalizeConnectPayload(payload, config.allowedOrigins);
      await connectProfile(profile);
      sendJson(
        response,
        200,
        {
          ok: true,
          profile: {
            ...redactProfile(profile),
            running: isPidRunning(profile.workerPid),
          },
        },
        corsHeaders,
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      await stopProfile(workerId);
      sendJson(response, 200, { ok: true, workerId }, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/clear-pat") {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      const profile = await clearProfilePat(workerId);
      sendJson(
        response,
        200,
        {
          ok: true,
          workerId,
          hasAzurePat: Boolean(profile.azurePat),
        },
        corsHeaders,
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/setup-codex") {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      await startVisibleCodexSetup(workerId);
      sendJson(response, 200, { ok: true, workerId, setupStarted: true }, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/repository/status") {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      const profile = await loadRequiredLauncherProfile(workerId);
      const repoPath = String(payload.repoPath || profile.repoPath || "").trim();
      const status = await readRepositoryStatus(repoPath);
      sendJson(response, 200, status, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/refresh-worker") {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      const profile = await refreshWorkerProfile(workerId);
      sendJson(
        response,
        200,
        {
          ok: true,
          profile: {
            ...redactProfile(profile),
            running: isPidRunning(profile.workerPid),
          },
        },
        corsHeaders,
      );
      return;
    }

    const workItemDetailMatch = url.pathname.match(/^\/azure\/work-item\/(\d+)$/);
    const prDiscoverMatch = url.pathname.match(
      /^\/requests\/([^/]+)\/pr-discover$/,
    );
    const prCreateMatch = url.pathname.match(/^\/requests\/([^/]+)\/pr-create$/);
    const prLinkMatch = url.pathname.match(/^\/requests\/([^/]+)\/pr-link$/);
    if (
      request.method === "POST" &&
      (url.pathname === "/azure/iterations" ||
        url.pathname === "/azure/work-items" ||
        workItemDetailMatch ||
        prDiscoverMatch ||
        prCreateMatch ||
        prLinkMatch)
    ) {
      const payload = await readJsonBody(request);
      const workerId = String(payload.workerId || "").trim();
      if (!workerId) {
        throw new Error("workerId is required.");
      }
      const apiPath = workItemDetailMatch
        ? `/api/azure/work-item/${workItemDetailMatch[1]}`
        : prDiscoverMatch
          ? `/api/requests/${encodeURIComponent(prDiscoverMatch[1])}/pr-discover`
          : prCreateMatch
            ? `/api/requests/${encodeURIComponent(prCreateMatch[1])}/pr-create`
          : prLinkMatch
            ? `/api/requests/${encodeURIComponent(prLinkMatch[1])}/pr-link`
        : url.pathname === "/azure/iterations"
          ? "/api/azure/iterations"
          : "/api/azure/work-items";
      const result = await callControlPlaneAzureApi(
        workerId,
        apiPath,
        payload,
      );
      sendJson(response, 200, result, corsHeaders);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found." }, corsHeaders);
  } catch (error) {
    await appendLauncherLog(`request failed: ${formatError(error)}`);
    sendErrorJson(response, error, corsHeaders);
  }
}

async function connectProfile(profile) {
  const existingProfile = await loadLauncherProfile(paths, profile.workerId).catch(
    () => null,
  );
  const nextProfile = mergeLauncherProfileForConnect(profile, existingProfile);

  const manifest = await downloadWorkerFiles(nextProfile.controlPlaneUrl);
  await stopKnownProcess(nextProfile.workerId, existingProfile?.workerPid || 0);
  const readyProfile = applyWorkerManifestToProfile(nextProfile, manifest);
  const started = await startWorkerProcess(readyProfile);
  const updatedProfile = {
    ...readyProfile,
    workerPid: started.pid,
    updatedAt: new Date().toISOString(),
  };
  await saveLauncherProfile(paths, updatedProfile);
  await appendLauncherLog(
    `connected worker ${updatedProfile.workerId} pid=${updatedProfile.workerPid}`,
  );
  Object.assign(profile, updatedProfile);
}

async function callControlPlaneAzureApi(workerId, apiPath, payload) {
  const profile = await loadRequiredLauncherProfile(workerId);
  const url = new URL(apiPath, profile.controlPlaneUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildControlPlaneAzureRequestBody(payload, profile)),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || `Azure request failed with HTTP ${response.status}.`);
  }

  return data;
}

async function readRepositoryStatus(repoPath) {
  if (!repoPath) {
    throw new Error("repoPath is required.");
  }

  const root = await runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  if (root.exitCode !== 0) {
    throw new Error(
      `Selected workspace is not a Git repository: ${root.output.trim()}`,
    );
  }

  const [branch, status, originDevelop] = await Promise.all([
    runGit(repoPath, ["branch", "--show-current"]),
    runGit(repoPath, ["status", "--porcelain"]),
    runGit(repoPath, ["rev-parse", "--verify", "origin/develop"]),
  ]);

  return {
    ok: true,
    repoPath,
    rootPath: root.output.trim(),
    currentBranch: branch.exitCode === 0 ? branch.output.trim() : "",
    dirty: status.exitCode === 0 && status.output.trim().length > 0,
    hasOriginDevelop: originDevelop.exitCode === 0,
    error: "",
  };
}

async function startSavedProfiles() {
  const profiles = await listLauncherProfiles(paths);
  for (const profile of profiles) {
    try {
      const manifest = await fetchWorkerManifest(profile.controlPlaneUrl);
      if (profile.workerPid && isPidRunning(profile.workerPid)) {
        if (isWorkerManifestCurrent(profile, manifest)) {
          workerProcesses.set(profile.workerId, profile.workerPid);
          continue;
        }
        const downloadedManifest = await downloadWorkerFiles(profile.controlPlaneUrl);
        await stopKnownProcess(profile.workerId, profile.workerPid);
        const readyProfile = applyWorkerManifestToProfile(
          profile,
          downloadedManifest,
        );
        const started = await startWorkerProcess(readyProfile);
        const updatedProfile = {
          ...readyProfile,
          workerPid: started.pid,
          updatedAt: new Date().toISOString(),
        };
        await saveLauncherProfile(paths, updatedProfile);
        await appendLauncherLog(`auto-started worker ${profile.workerId}`);
        continue;
      }
      const downloadedManifest = await downloadWorkerFiles(profile.controlPlaneUrl);
      const readyProfile = applyWorkerManifestToProfile(profile, downloadedManifest);
      const started = await startWorkerProcess(readyProfile);
      const updatedProfile = {
        ...readyProfile,
        workerPid: started.pid,
        updatedAt: new Date().toISOString(),
      };
      await saveLauncherProfile(paths, updatedProfile);
      await appendLauncherLog(`auto-started worker ${profile.workerId}`);
    } catch (error) {
      await appendLauncherLog(
        `auto-start failed for ${profile.workerId}: ${formatError(error)}`,
      );
    }
  }
}

function startWorkerSupervisor() {
  const timer = setInterval(() => {
    void superviseSavedProfiles().catch((error) => {
      void appendLauncherLog(`worker supervisor failed: ${formatError(error)}`);
    });
  }, workerSupervisorIntervalMs);
  timer.unref?.();
}

async function superviseSavedProfiles() {
  const profiles = await listLauncherProfiles(paths);
  for (const profile of profiles) {
    const pid = Number(profile.workerPid || workerProcesses.get(profile.workerId) || 0);
    if (pid && isPidRunning(pid)) {
      workerProcesses.set(profile.workerId, pid);
      continue;
    }

    if (workerRestartsInFlight.has(profile.workerId)) {
      continue;
    }

    workerRestartsInFlight.add(profile.workerId);
    try {
      await appendLauncherLog(
        `worker supervisor restarting ${profile.workerId}; previous pid=${pid || "none"} is not running`,
      );
      const currentProfile = await loadLauncherProfile(paths, profile.workerId).catch(
        () => null,
      );
      if (!currentProfile) {
        await appendLauncherLog(
          `worker supervisor skipped ${profile.workerId}; profile was removed`,
        );
        continue;
      }

      const manifest = await downloadWorkerFiles(currentProfile.controlPlaneUrl);
      const readyProfile = applyWorkerManifestToProfile(currentProfile, manifest);
      const started = await startWorkerProcess(readyProfile);
      const updatedProfile = {
        ...readyProfile,
        workerPid: started.pid,
        updatedAt: new Date().toISOString(),
      };
      await saveLauncherProfile(paths, updatedProfile);
      await appendLauncherLog(
        `worker supervisor restarted ${updatedProfile.workerId} pid=${updatedProfile.workerPid}`,
      );
    } catch (error) {
      await appendLauncherLog(
        `worker supervisor restart failed for ${profile.workerId}: ${formatError(error)}`,
      );
    } finally {
      workerRestartsInFlight.delete(profile.workerId);
    }
  }
}

async function startWorkerProcess(profile) {
  await stopKnownProcess(profile.workerId, profile.workerPid);
  await ensureLauncherDirectories(paths);

  const out = createWriteStream(paths.workerOutLogFile, { flags: "a" });
  const err = createWriteStream(paths.workerErrLogFile, { flags: "a" });
  const env = {
    ...process.env,
    ...buildWorkerEnvironment(profile),
  };
  const child = spawn(process.execPath, ["local-worker.mjs"], {
    cwd: paths.workerRoot,
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(err);

  child.unref();
  workerProcesses.set(profile.workerId, child.pid || 0);
  return { pid: child.pid || 0 };
}

async function startVisibleCodexSetup(workerId) {
  const profile = await loadRequiredLauncherProfile(workerId);
  const manifest = await downloadWorkerFiles(profile.controlPlaneUrl);
  const readyProfile = applyWorkerManifestToProfile(profile, manifest);
  await saveLauncherProfile(paths, readyProfile);
  await stopKnownProcess(workerId, profile.workerPid);

  const env = {
    ...process.env,
    ...buildWorkerEnvironment(readyProfile),
    CODEX_MISSION_CONTROL_WORKER_ROOT: paths.workerRoot,
  };
  const setupCommand = [
    "$ErrorActionPreference = 'Continue'",
    "Set-Location -LiteralPath $env:CODEX_MISSION_CONTROL_WORKER_ROOT",
    "node .\\local-worker.mjs --setup-only",
    "$exitCode = $LASTEXITCODE",
    "if ($exitCode -ne 0) { Read-Host 'Codex setup failed. Press Enter to close' }",
    "exit $exitCode",
  ].join("; ");
  const launcherCommand = [
    "$argsList = @('-NoProfile','-ExecutionPolicy','Bypass','-Command',$env:CODEX_SETUP_COMMAND)",
    "$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsList -Wait -PassThru",
    "exit $p.ExitCode",
  ].join("; ");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launcherCommand],
    {
      detached: true,
      env: {
        ...env,
        CODEX_SETUP_COMMAND: setupCommand,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );

  child.on("close", () => {
    void connectProfile(profile).catch((error) => {
      void appendLauncherLog(
        `background restart failed for ${workerId}: ${formatError(error)}`,
      );
    });
  });
  await appendLauncherLog(`started visible Codex setup for ${workerId}`);
}

async function stopProfile(workerId) {
  const profile = await loadLauncherProfile(paths, workerId).catch(() => null);
  await stopKnownProcess(workerId, profile?.workerPid || 0);
  await deleteLauncherProfile(paths, workerId);
  await appendLauncherLog(`stopped worker ${workerId}`);
}

async function clearProfilePat(workerId) {
  const existingProfile = await loadRequiredLauncherProfile(workerId);
  await stopKnownProcess(workerId, existingProfile.workerPid || 0);
  const profile = await clearLauncherProfilePat(paths, workerId);
  await connectProfile(profile);
  await appendLauncherLog(`cleared Azure PAT for worker ${workerId}`);
  return profile;
}

async function refreshWorkerProfile(workerId) {
  const profile = await loadRequiredLauncherProfile(workerId);
  const manifest = await downloadWorkerFiles(profile.controlPlaneUrl);
  await stopKnownProcess(workerId, profile.workerPid || 0);
  const readyProfile = applyWorkerManifestToProfile(profile, manifest);
  const started = await startWorkerProcess(readyProfile);
  const updatedProfile = {
    ...readyProfile,
    workerPid: started.pid,
    updatedAt: new Date().toISOString(),
  };
  await saveLauncherProfile(paths, updatedProfile);
  await appendLauncherLog(`refreshed worker ${workerId}`);
  return updatedProfile;
}

async function loadRequiredLauncherProfile(workerId) {
  try {
    return await loadLauncherProfile(paths, workerId);
  } catch (error) {
    if (isMissingProfileError(error)) {
      throw new LauncherProfileMissingError(workerId);
    }
    throw error;
  }
}

async function stopKnownProcess(workerId, pid) {
  const knownPid = Number(pid || workerProcesses.get(workerId) || 0);
  workerProcesses.delete(workerId);
  if (!knownPid || !isPidRunning(knownPid)) {
    return;
  }

  await runDetachedCommand("taskkill.exe", ["/PID", String(knownPid), "/T", "/F"]);
}

async function getStatus(workerId) {
  if (workerId) {
    const profile = await loadLauncherProfile(paths, workerId).catch(() => null);
    const pid = Number(profile?.workerPid || workerProcesses.get(workerId) || 0);
    return {
      ok: true,
      workerId,
      ...buildLauncherWorkerStatus(profile, Boolean(pid && isPidRunning(pid))),
    };
  }

  const profiles = await listLauncherProfiles(paths);
  return {
    ok: true,
    profiles: profiles.map((profile) => {
      const redacted = redactProfile(profile);
      const pid = Number(redacted.workerPid || workerProcesses.get(profile.workerId) || 0);
      return {
        ...redacted,
        ...buildLauncherWorkerStatus(profile, Boolean(pid && isPidRunning(pid))),
      };
    }),
  };
}

async function fetchWorkerManifest(controlPlaneUrl) {
  const response = await fetch(
    `${controlPlaneUrl}/api/workers/bootstrap?file=${encodeURIComponent(WORKER_MANIFEST_FILE)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Failed to download worker manifest: HTTP ${response.status}.`);
  }
  return normalizeWorkerBootstrapManifest(await response.json());
}

async function downloadWorkerFiles(controlPlaneUrl) {
  const manifest = await fetchWorkerManifest(controlPlaneUrl);
  const tempRoot = path.join(
    paths.workerRoot,
    `.download-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(paths.workerRoot, { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  try {
    for (const workerFile of workerFiles) {
      const expected = getWorkerManifestFile(manifest, workerFile);
      if (!expected) {
        throw new Error(`Worker manifest is missing ${workerFile}.`);
      }

      const response = await fetch(
        `${controlPlaneUrl}/api/workers/bootstrap?file=${encodeURIComponent(workerFile)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to download ${workerFile}: HTTP ${response.status}.`,
        );
      }
      const content = await response.text();
      const actualHash = hashWorkerFileContent(content);
      if (actualHash !== expected.sha256) {
        throw new Error(
          `Downloaded ${workerFile} failed integrity check. Expected ${expected.sha256}, got ${actualHash}.`,
        );
      }
      await writeFile(path.join(tempRoot, workerFile), content, "utf8");
    }

    await writeFile(
      path.join(tempRoot, WORKER_MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    for (const workerFile of [...workerFiles, WORKER_MANIFEST_FILE]) {
      const target = path.join(paths.workerRoot, workerFile);
      await rm(target, { force: true });
      await rename(path.join(tempRoot, workerFile), target);
    }
    return manifest;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function isPidRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runDetachedCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, output: error.message });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 0, output });
    });
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
  });
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendErrorJson(response, error, headers = {}) {
  const payload = buildLauncherErrorPayload(error);
  sendJson(response, payload.status, payload.body, headers);
}

function buildLauncherErrorPayload(error) {
  if (error instanceof LauncherProfileMissingError) {
    return {
      status: 409,
      body: {
        ok: false,
        code: "launcher_profile_missing",
        error: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: formatError(error),
    },
  };
}

async function appendLauncherLog(message) {
  await ensureLauncherDirectories(paths);
  await writeFile(
    paths.launcherLogFile,
    `[${new Date().toISOString()}] ${message}\n`,
    {
      encoding: "utf8",
      flag: "a",
    },
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingProfileError(error) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

class LauncherProfileMissingError extends Error {
  constructor(workerId) {
    super(
      `本機 Launcher 沒有保存 worker ${workerId} 的連線資料。請重新啟動本機 worker 連線；如果需要 draft PR，請重新輸入 Azure PAT。`,
    );
    this.name = "LauncherProfileMissingError";
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
