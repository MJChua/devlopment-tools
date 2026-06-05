import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type {
  RepoCandidateScan,
  RepoCandidateScanEntry,
  WorkflowRequest,
} from "./control-plane-workflow.ts";

const MAX_APPS = 12;
const MAX_SURFACES = 24;
const MAX_FILES_PER_APP = 350;
const scanCache = new Map<
  string,
  { revision: string; scan: RepoCandidateScan | null }
>();
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);
const SURFACE_FILE_PATTERN = /(topbar|top-bar|header|shell|layout|navbar|nav-bar|menu|toolbar)/i;
const SURFACE_TEXT_PATTERN = /(topbar|top-bar|header|logout|sign out|menu|navigation|toolbar)/i;

export function scanRepoCandidatesForAgent1(
  request: WorkflowRequest,
): RepoCandidateScan | null {
  const rootPath = request.repoPath.trim();
  if (!rootPath || !existsSync(/*turbopackIgnore: true*/ rootPath)) {
    return null;
  }

  const cacheKey = path
    .resolve(/*turbopackIgnore: true*/ rootPath)
    .toLowerCase();
  const revision = getRepoScanRevision(rootPath);
  const cached = scanCache.get(cacheKey);
  if (cached?.revision === revision) {
    return cloneScan(cached.scan);
  }

  const warnings: string[] = [];
  const apps = scanApps(rootPath, warnings);
  const surfaces = apps.flatMap((app) => scanSurfaces(rootPath, app, warnings));

  const scan = {
    rootPath,
    apps: apps.slice(0, MAX_APPS),
    surfaces: surfaces.slice(0, MAX_SURFACES),
    warnings,
  };
  scanCache.set(cacheKey, { revision, scan });
  return cloneScan(scan);
}

function getRepoScanRevision(rootPath: string) {
  const gitRevision = readGitRevision(rootPath);
  const appsMtime = readMtime(path.join(rootPath, "apps"));
  return `${gitRevision || "no-git"}|apps:${appsMtime}`;
}

function readGitRevision(rootPath: string) {
  const gitPath = path.join(rootPath, ".git");
  const gitDir = resolveGitDir(rootPath, gitPath);
  if (!gitDir) {
    return "";
  }

  try {
    const headPath = path.join(gitDir, "HEAD");
    const head = readFileSync(/*turbopackIgnore: true*/ headPath, "utf8").trim();
    if (!head.startsWith("ref:")) {
      return `${head}|${readMtime(headPath)}`;
    }

    const refPath = path.join(gitDir, head.slice("ref:".length).trim());
    return `${head}|${readFileSync(/*turbopackIgnore: true*/ refPath, "utf8").trim()}|${readMtime(refPath)}`;
  } catch {
    return `git-dir:${readMtime(gitDir)}`;
  }
}

function resolveGitDir(rootPath: string, gitPath: string) {
  if (!existsSync(/*turbopackIgnore: true*/ gitPath)) {
    return "";
  }

  try {
    const stat = statSync(/*turbopackIgnore: true*/ gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }

    const content = readFileSync(/*turbopackIgnore: true*/ gitPath, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/i);
    if (!match) {
      return "";
    }

    const gitDir = match[1].trim();
    return path.isAbsolute(gitDir)
      ? gitDir
      : path.resolve(rootPath, gitDir);
  } catch {
    return "";
  }
}

function readMtime(targetPath: string) {
  try {
    return String(Math.round(statSync(/*turbopackIgnore: true*/ targetPath).mtimeMs));
  } catch {
    return "0";
  }
}

function cloneScan(scan: RepoCandidateScan | null) {
  return scan
    ? {
        rootPath: scan.rootPath,
        apps: scan.apps.map((entry) => ({ ...entry })),
        surfaces: scan.surfaces.map((entry) => ({ ...entry })),
        warnings: [...scan.warnings],
      }
    : null;
}

function scanApps(rootPath: string, warnings: string[]): RepoCandidateScanEntry[] {
  const appsRoot = path.join(rootPath, "apps");
  if (!existsSync(/*turbopackIgnore: true*/ appsRoot)) {
    warnings.push("No apps/ directory was found during pre-scan.");
    return [];
  }

  try {
    return readdirSync(/*turbopackIgnore: true*/ appsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const appPath = path.join("apps", entry.name);
        const packageJson = path.join(rootPath, appPath, "package.json");
        const packageName = readPackageName(packageJson);
        return {
          label: packageName || entry.name,
          path: appPath.replaceAll("\\", "/"),
          reason: packageName
            ? `workspace app package ${packageName}`
            : "workspace app directory",
        };
      });
  } catch (error) {
    warnings.push(`App scan failed: ${formatScanError(error)}`);
    return [];
  }
}

function scanSurfaces(
  rootPath: string,
  app: RepoCandidateScanEntry,
  warnings: string[],
): RepoCandidateScanEntry[] {
  const srcRoot = path.join(rootPath, app.path, "src");
  if (!existsSync(/*turbopackIgnore: true*/ srcRoot)) {
    return [];
  }

  const files: string[] = [];
  collectFiles(srcRoot, files, MAX_FILES_PER_APP);
  const candidates: RepoCandidateScanEntry[] = [];

  for (const absoluteFile of files) {
    const relative = path.relative(rootPath, absoluteFile).replaceAll("\\", "/");
    const basename = path.basename(relative);
    const nameMatch = SURFACE_FILE_PATTERN.test(basename);
    let contentMatch = false;

    if (!nameMatch) {
      try {
        contentMatch = SURFACE_TEXT_PATTERN.test(
          readFileSync(/*turbopackIgnore: true*/ absoluteFile, "utf8").slice(
            0,
            12000,
          ),
        );
      } catch {
        contentMatch = false;
      }
    }

    if (!nameMatch && !contentMatch) {
      continue;
    }

    candidates.push({
      label: `${app.label} / ${basename}`,
      path: relative,
      reason: nameMatch
        ? "filename suggests header/topbar/navigation ownership"
        : "content mentions header/topbar/logout/menu terms",
    });
  }

  if (files.length >= MAX_FILES_PER_APP) {
    warnings.push(`${app.path} scan stopped after ${MAX_FILES_PER_APP} files.`);
  }

  return candidates;
}

function collectFiles(dir: string, files: string[], maxFiles: number) {
  if (files.length >= maxFiles) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(/*turbopackIgnore: true*/ dir, {
      withFileTypes: true,
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= maxFiles) {
      return;
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectFiles(absolute, files, maxFiles);
      }
      continue;
    }

    if (!entry.isFile() || !/\.(vue|tsx?|jsx?|svelte|mdx?)$/i.test(entry.name)) {
      continue;
    }

    try {
      if (statSync(/*turbopackIgnore: true*/ absolute).size <= 250_000) {
        files.push(absolute);
      }
    } catch {
      // Ignore files that disappear during scan.
    }
  }
}

function readPackageName(packageJson: string) {
  try {
    const parsed = JSON.parse(
      readFileSync(/*turbopackIgnore: true*/ packageJson, "utf8"),
    );
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

function formatScanError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
