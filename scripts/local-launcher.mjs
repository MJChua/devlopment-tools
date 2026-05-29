import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  LOCAL_LAUNCHER_HOST,
  LOCAL_LAUNCHER_PORT,
  LOCAL_LAUNCHER_VERSION,
  buildCorsHeaders,
  buildControlPlaneAzureRequestBody,
  buildWorkerEnvironment,
  clearLauncherProfilePat,
  deleteLauncherProfile,
  ensureLauncherDirectories,
  getLauncherPaths,
  listLauncherProfiles,
  loadLauncherConfig,
  loadLauncherProfile,
  mergeLauncherProfileForConnect,
  normalizeConnectPayload,
  redactProfile,
  saveLauncherProfile,
} from "./local-launcher-utils.mjs";

const workerFiles = ["local-worker.mjs", "local-worker-utils.mjs"];
const paths = getLauncherPaths();
const workerProcesses = new Map();

async function main() {
  await ensureLauncherDirectories(paths);
  await appendLauncherLog(
    `starting launcher ${LOCAL_LAUNCHER_VERSION} on ${LOCAL_LAUNCHER_HOST}:${LOCAL_LAUNCHER_PORT}`,
  );

  await startSavedProfiles();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      void appendLauncherLog(`request failed: ${formatError(error)}`);
      sendJson(response, 500, { ok: false, error: formatError(error) });
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

    const workItemDetailMatch = url.pathname.match(/^\/azure\/work-item\/(\d+)$/);
    const prDiscoverMatch = url.pathname.match(
      /^\/requests\/([^/]+)\/pr-discover$/,
    );
    const prLinkMatch = url.pathname.match(/^\/requests\/([^/]+)\/pr-link$/);
    if (
      request.method === "POST" &&
      (url.pathname === "/azure/iterations" ||
        url.pathname === "/azure/work-items" ||
        workItemDetailMatch ||
        prDiscoverMatch ||
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
    sendJson(response, 500, { ok: false, error: formatError(error) }, corsHeaders);
  }
}

async function connectProfile(profile) {
  const existingProfile = await loadLauncherProfile(paths, profile.workerId).catch(
    () => null,
  );
  const nextProfile = mergeLauncherProfileForConnect(profile, existingProfile);

  await downloadWorkerFiles(nextProfile.controlPlaneUrl);
  const started = await startWorkerProcess(nextProfile);
  const updatedProfile = {
    ...nextProfile,
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
  const profile = await loadLauncherProfile(paths, workerId);
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

async function startSavedProfiles() {
  const profiles = await listLauncherProfiles(paths);
  for (const profile of profiles) {
    try {
      await downloadWorkerFiles(profile.controlPlaneUrl);
      if (profile.workerPid && isPidRunning(profile.workerPid)) {
        workerProcesses.set(profile.workerId, profile.workerPid);
        continue;
      }
      const started = await startWorkerProcess(profile);
      await saveLauncherProfile(paths, {
        ...profile,
        workerPid: started.pid,
        updatedAt: new Date().toISOString(),
      });
      await appendLauncherLog(`auto-started worker ${profile.workerId}`);
    } catch (error) {
      await appendLauncherLog(
        `auto-start failed for ${profile.workerId}: ${formatError(error)}`,
      );
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
  const profile = await loadLauncherProfile(paths, workerId);
  await downloadWorkerFiles(profile.controlPlaneUrl);
  await stopKnownProcess(workerId, profile.workerPid);

  const env = {
    ...process.env,
    ...buildWorkerEnvironment(profile),
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
  const existingProfile = await loadLauncherProfile(paths, workerId);
  await stopKnownProcess(workerId, existingProfile.workerPid || 0);
  const profile = await clearLauncherProfilePat(paths, workerId);
  await connectProfile(profile);
  await appendLauncherLog(`cleared Azure PAT for worker ${workerId}`);
  return profile;
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
        hasProfile: Boolean(profile),
        hasAzurePat: Boolean(profile?.azurePat),
        running: Boolean(pid && isPidRunning(pid)),
        pid: pid || null,
      };
  }

  const profiles = await listLauncherProfiles(paths);
  return {
    ok: true,
    profiles: profiles.map((profile) => {
      const redacted = redactProfile(profile);
      return {
        ...redacted,
        running: Boolean(redacted.workerPid && isPidRunning(redacted.workerPid)),
      };
    }),
  };
}

async function downloadWorkerFiles(controlPlaneUrl) {
  await mkdir(paths.workerRoot, { recursive: true });
  for (const workerFile of workerFiles) {
    const response = await fetch(
      `${controlPlaneUrl}/api/workers/bootstrap?file=${encodeURIComponent(workerFile)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to download ${workerFile}: HTTP ${response.status}.`,
      );
    }
    await writeFile(
      path.join(paths.workerRoot, workerFile),
      await response.text(),
      "utf8",
    );
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
