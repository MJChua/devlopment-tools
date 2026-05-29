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
  if (!rootPath || !existsSync(rootPath)) {
    return null;
  }

  const warnings: string[] = [];
  const apps = scanApps(rootPath, warnings);
  const surfaces = apps.flatMap((app) => scanSurfaces(rootPath, app, warnings));

  return {
    rootPath,
    apps: apps.slice(0, MAX_APPS),
    surfaces: surfaces.slice(0, MAX_SURFACES),
    warnings,
  };
}

function scanApps(rootPath: string, warnings: string[]): RepoCandidateScanEntry[] {
  const appsRoot = path.join(rootPath, "apps");
  if (!existsSync(appsRoot)) {
    warnings.push("No apps/ directory was found during pre-scan.");
    return [];
  }

  try {
    return readdirSync(appsRoot, { withFileTypes: true })
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
  if (!existsSync(srcRoot)) {
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
          readFileSync(absoluteFile, "utf8").slice(0, 12000),
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
    entries = readdirSync(dir, { withFileTypes: true });
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
      if (statSync(absolute).size <= 250_000) {
        files.push(absolute);
      }
    } catch {
      // Ignore files that disappear during scan.
    }
  }
}

function readPackageName(packageJson: string) {
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8"));
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

function formatScanError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
