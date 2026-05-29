import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_LAUNCHER_HOST = "127.0.0.1";
export const LOCAL_LAUNCHER_PORT = Number(
  process.env.CODEX_MISSION_CONTROL_LAUNCHER_PORT || 17320,
);
export const LOCAL_LAUNCHER_VERSION = "0.1.0";
export const LOCAL_LAUNCHER_TASK_NAME = "CodexMissionControlLocalLauncher";

const defaultDevOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

export const dpapiProfileCipher = {
  protect: protectStringWithDpapi,
  unprotect: unprotectStringWithDpapi,
};

export function getLauncherPaths(baseDir = getLocalAppData()) {
  const root = path.join(baseDir, "CodexMissionControl");
  const launcherRoot = path.join(root, "launcher");
  const workerRoot = path.join(root, "worker");
  const profileRoot = path.join(launcherRoot, "profiles");
  const logRoot = path.join(root, "logs");

  return {
    root,
    launcherRoot,
    workerRoot,
    profileRoot,
    logRoot,
    configFile: path.join(launcherRoot, "launcher-config.json"),
    launcherLogFile: path.join(logRoot, "local-launcher.log"),
    workerOutLogFile: path.join(logRoot, "local-worker.out.log"),
    workerErrLogFile: path.join(logRoot, "local-worker.err.log"),
  };
}

export async function ensureLauncherDirectories(paths) {
  await Promise.all([
    mkdir(paths.launcherRoot, { recursive: true }),
    mkdir(paths.workerRoot, { recursive: true }),
    mkdir(paths.profileRoot, { recursive: true }),
    mkdir(paths.logRoot, { recursive: true }),
  ]);
}

export async function loadLauncherConfig(paths) {
  try {
    const parsed = JSON.parse(await readFile(paths.configFile, "utf8"));
    return {
      allowedOrigins: normalizeAllowedOrigins(parsed.allowedOrigins),
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "",
    };
  } catch {
    return {
      allowedOrigins: [...defaultDevOrigins],
      installedAt: "",
    };
  }
}

export function normalizeAllowedOrigins(origins) {
  const normalized = [];
  for (const origin of Array.isArray(origins) ? origins : []) {
    const value = normalizeOrigin(origin);
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  }

  return normalized;
}

export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

export function normalizeControlPlaneUrl(value) {
  const origin = normalizeOrigin(value);
  if (!origin) {
    throw new Error("controlPlaneUrl must be an http or https URL.");
  }
  return origin;
}

export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return (
    Boolean(normalizedOrigin) &&
    normalizeAllowedOrigins(allowedOrigins).includes(normalizedOrigin)
  );
}

export function buildCorsHeaders(origin, allowedOrigins) {
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return null;
  }

  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
  }

  return headers;
}

export function normalizeConnectPayload(payload, allowedOrigins = []) {
  const input = payload && typeof payload === "object" ? payload : {};
  const worker = input.worker && typeof input.worker === "object" ? input.worker : {};
  const controlPlaneUrl = normalizeControlPlaneUrl(input.controlPlaneUrl);
  const controlPlaneOrigin = normalizeOrigin(controlPlaneUrl);

  if (!isOriginAllowed(controlPlaneOrigin, allowedOrigins)) {
    throw new Error("controlPlaneUrl is not allowed by this launcher.");
  }

  const workerId = requireString(worker.workerId, "worker.workerId");
  const token = requireString(worker.token, "worker.token");
  const sandboxMode =
    worker.sandboxMode === "danger-full-access"
      ? "danger-full-access"
      : "workspace-write";

  return {
    version: 1,
    controlPlaneUrl,
    controlPlaneOrigin,
    workerId,
    token,
    repoPath: optionalString(worker.repoPath),
    sandboxMode,
    autoCommitAndPr: worker.autoCommitAndPr === true,
    azurePat: optionalString(input.azurePat),
    workerPid: 0,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function buildWorkerEnvironment(profile) {
  return {
    CONTROL_PLANE_URL: profile.controlPlaneUrl,
    WORKER_ID: profile.workerId,
    WORKER_TOKEN: profile.token,
    CODEX_SANDBOX_MODE: profile.sandboxMode,
    ...(profile.repoPath ? { REPO_PATH: profile.repoPath } : {}),
    ...(profile.azurePat ? { AZURE_DEVOPS_PAT: profile.azurePat } : {}),
    ...(profile.autoCommitAndPr ? { CONTROL_PLANE_AUTO_COMMIT_PR: "1" } : {}),
  };
}

export function redactProfile(profile) {
  return {
    version: profile.version,
    controlPlaneUrl: profile.controlPlaneUrl,
    controlPlaneOrigin: profile.controlPlaneOrigin,
    workerId: profile.workerId,
    repoPath: profile.repoPath,
    sandboxMode: profile.sandboxMode,
    autoCommitAndPr: profile.autoCommitAndPr,
    hasAzurePat: Boolean(profile.azurePat),
    workerPid: profile.workerPid || 0,
    connectedAt: profile.connectedAt,
    updatedAt: profile.updatedAt,
  };
}

export function mergeLauncherProfileForConnect(profile, existingProfile) {
  if (profile.autoCommitAndPr && !profile.azurePat && existingProfile?.azurePat) {
    return { ...profile, azurePat: existingProfile.azurePat };
  }

  return profile;
}

export function buildControlPlaneAzureRequestBody(payload, profile) {
  if (!profile?.azurePat) {
    throw new Error("Azure PAT is not saved for this worker.");
  }

  const input = payload && typeof payload === "object" ? payload : {};
  const { workerId, credentials, ...rest } = input;
  void workerId;
  void credentials;

  return {
    ...rest,
    credentials: { pat: profile.azurePat },
  };
}

export async function saveLauncherProfile(
  paths,
  profile,
  cipher = dpapiProfileCipher,
) {
  await ensureLauncherDirectories(paths);
  const protectedData = await cipher.protect(JSON.stringify(profile));
  await writeFile(
    getProfileFile(paths, profile.workerId),
    JSON.stringify(
      {
        version: 1,
        protectedData,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function loadLauncherProfile(
  paths,
  workerId,
  cipher = dpapiProfileCipher,
) {
  const raw = JSON.parse(await readFile(getProfileFile(paths, workerId), "utf8"));
  const json = await cipher.unprotect(String(raw.protectedData || ""));
  return JSON.parse(json);
}

export async function clearLauncherProfilePat(
  paths,
  workerId,
  cipher = dpapiProfileCipher,
) {
  const profile = await loadLauncherProfile(paths, workerId, cipher);
  const updatedProfile = {
    ...profile,
    azurePat: "",
    updatedAt: new Date().toISOString(),
  };
  await saveLauncherProfile(paths, updatedProfile, cipher);
  return updatedProfile;
}

export async function listLauncherProfiles(
  paths,
  cipher = dpapiProfileCipher,
) {
  await ensureLauncherDirectories(paths);
  const files = await readdir(paths.profileRoot).catch(() => []);
  const profiles = [];

  for (const file of files.filter((value) => value.endsWith(".json"))) {
    try {
      const raw = JSON.parse(
        await readFile(path.join(paths.profileRoot, file), "utf8"),
      );
      const json = await cipher.unprotect(String(raw.protectedData || ""));
      profiles.push(JSON.parse(json));
    } catch {
      // Ignore broken profiles; stop/delete can still clean them by worker id.
    }
  }

  return profiles;
}

export async function deleteLauncherProfile(paths, workerId) {
  await rm(getProfileFile(paths, workerId), { force: true });
}

export function getProfileFile(paths, workerId) {
  return path.join(paths.profileRoot, `${encodeWorkerId(workerId)}.json`);
}

export function encodeWorkerId(workerId) {
  return Buffer.from(String(workerId), "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export async function protectStringWithDpapi(value) {
  return runDpapiScript(
    `
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`,
    value,
  );
}

export async function unprotectStringWithDpapi(value) {
  return runDpapiScript(
    `
Add-Type -AssemblyName System.Security
$cipher = [Console]::In.ReadToEnd()
$protected = [Convert]::FromBase64String($cipher)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
`,
    value,
  );
}

function runDpapiScript(script, input) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("DPAPI profile storage requires Windows."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `DPAPI exited ${exitCode}.`));
      }
    });
    child.stdin.end(input);
  });
}

function getLocalAppData() {
  if (process.env.LOCALAPPDATA) {
    return process.env.LOCALAPPDATA;
  }

  if (process.platform === "win32" && process.env.USERPROFILE) {
    return path.join(process.env.USERPROFILE, "AppData", "Local");
  }

  return path.join(process.cwd(), ".codex-artifacts", "local-app-data");
}

function requireString(value, name) {
  const trimmed = optionalString(value);
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}
