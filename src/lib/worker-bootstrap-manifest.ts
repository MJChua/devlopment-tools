import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const WORKER_BOOTSTRAP_VERSION = "2026.05.29.1";
export const WORKER_BOOTSTRAP_SCRIPT_FILES = [
  "local-worker.mjs",
  "local-worker-utils.mjs",
] as const;
export const LAUNCHER_BOOTSTRAP_VERSION = "0.2.1";
export const LAUNCHER_BOOTSTRAP_SCRIPT_FILES = [
  "local-launcher.mjs",
  "local-launcher-utils.mjs",
  "local-launcher-install.ps1",
] as const;

export type WorkerBootstrapFile = {
  name: string;
  sha256: string;
  bytes: number;
};

export type WorkerBootstrapManifest = {
  workerVersion: string;
  launcherVersion: string;
  files: WorkerBootstrapFile[];
  launcherFiles: WorkerBootstrapFile[];
};

export function getWorkerBootstrapManifest(): WorkerBootstrapManifest {
  const scriptRoot = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "scripts",
  );

  return {
    workerVersion: WORKER_BOOTSTRAP_VERSION,
    launcherVersion: LAUNCHER_BOOTSTRAP_VERSION,
    files: [
      getWorkerBootstrapFile(
        "local-worker.mjs",
        path.join(scriptRoot, "local-worker.mjs"),
      ),
      getWorkerBootstrapFile(
        "local-worker-utils.mjs",
        path.join(scriptRoot, "local-worker-utils.mjs"),
      ),
    ],
    launcherFiles: [
      getLauncherBootstrapFile(
        "local-launcher.mjs",
        path.join(scriptRoot, "local-launcher.mjs"),
      ),
      getLauncherBootstrapFile(
        "local-launcher-utils.mjs",
        path.join(scriptRoot, "local-launcher-utils.mjs"),
      ),
      getLauncherBootstrapFile(
        "local-launcher-install.ps1",
        path.join(scriptRoot, "local-launcher-install.ps1"),
      ),
    ],
  };
}

export function getWorkerScriptHash(
  manifest = getWorkerBootstrapManifest(),
  fileName = "local-worker.mjs",
) {
  return manifest.files.find((file) => file.name === fileName)?.sha256 ?? "";
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function getWorkerBootstrapFile(
  name: (typeof WORKER_BOOTSTRAP_SCRIPT_FILES)[number],
  filePath: string,
): WorkerBootstrapFile {
  return getBootstrapFile(name, filePath);
}

function getLauncherBootstrapFile(
  name: (typeof LAUNCHER_BOOTSTRAP_SCRIPT_FILES)[number],
  filePath: string,
): WorkerBootstrapFile {
  return getBootstrapFile(name, filePath);
}

function getBootstrapFile(name: string, filePath: string): WorkerBootstrapFile {
  const content = readFileSync(filePath);
  return {
    name,
    sha256: sha256(content),
    bytes: content.byteLength,
  };
}
