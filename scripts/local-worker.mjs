import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_CODEX_LOGIN_COMMAND,
  decodeCommandBuffer,
  diagnoseCodexReadiness,
  parseCommandOutputLines,
} from "./local-worker-utils.mjs";

const controlPlaneUrl = requiredEnv("CONTROL_PLANE_URL").replace(/\/+$/, "");
const workerId = requiredEnv("WORKER_ID");
const workerToken = requiredEnv("WORKER_TOKEN");
const defaultRepoPath = process.env.REPO_PATH || "";
const sandboxMode = normalizeSandboxMode(process.env.CODEX_SANDBOX_MODE);
const commandTemplate =
  process.env.CODEX_COMMAND_TEMPLATE || buildDefaultCodexCommandTemplate();
const readinessCommand =
  process.env.CODEX_READINESS_COMMAND || "codex exec --help";
const codexInstallCommand =
  process.env.CODEX_INSTALL_COMMAND || "npm i -g @openai/codex";
const codexLoginCommand =
  process.env.CODEX_LOGIN_COMMAND || DEFAULT_CODEX_LOGIN_COMMAND;
const autoCommitAndPr = process.env.CONTROL_PLANE_AUTO_COMMIT_PR === "1";
const workerVersion = process.env.CONTROL_PLANE_WORKER_VERSION || "";
const expectedWorkerScriptHash =
  process.env.CONTROL_PLANE_WORKER_SCRIPT_HASH || "";
const launcherVersion = process.env.CONTROL_PLANE_LAUNCHER_VERSION || "";
const workerUpdatedAt = process.env.CONTROL_PLANE_WORKER_UPDATED_AT || "";
const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);
const once = process.argv.includes("--once");
const setupOnly = process.argv.includes("--setup-only");
const skippedRepositoryScanDirs = new Set([
  ".cache",
  ".git",
  ".next",
  ".pnpm-store",
  "AppData",
  "node_modules",
]);
let currentWorkerScriptHash = "";

async function main() {
  currentWorkerScriptHash = await computeCurrentWorkerScriptHash().catch(() => "");
  if (
    expectedWorkerScriptHash &&
    currentWorkerScriptHash &&
    expectedWorkerScriptHash !== currentWorkerScriptHash
  ) {
    throw new Error(
      `Worker script integrity mismatch. Expected ${expectedWorkerScriptHash}, got ${currentWorkerScriptHash}.`,
    );
  }

  console.log(`[worker:${workerId}] polling ${controlPlaneUrl}`);
  if (setupOnly) {
    await setupCodexCli();
    return;
  }

  await reportRepositoryCandidates().catch((error) => {
    console.warn(
      `[worker:${workerId}] repository scan report failed: ${formatError(error)}`,
    );
  });

  do {
    const work = await pollWorker();
    if (work.setupCodex) {
      await setupCodexCli();
    }
    if (work.recheckReadiness) {
      await reportRepositoryCandidates();
    }
    const run = work.run;

    if (!run) {
      if (once) {
        console.log(`[worker:${workerId}] no queued run`);
        return;
      }

      await delay(intervalMs);
      continue;
    }

    await executeRun(run);
  } while (!once);
}

async function executeRun(run) {
  let runRepoPath = run.repoPath || defaultRepoPath;
  console.log(
    `[worker:${workerId}] running ${run.agentRole} for ${run.requestId} in ${runRepoPath || "(no repo selected)"}`,
  );

  const tempDir = await mkdtemp(path.join(tmpdir(), "control-plane-worker-"));
  const packetFile = path.join(tempDir, `${run.requestId}-${run.agentRole}.md`);
  let runHeartbeatTimer = null;
  const progress = {
    label: "Preparing Agent run",
    detail: `${run.agentRole} is preparing the packet.`,
    updatedAt: new Date().toISOString(),
    executionRepoPath: runRepoPath,
  };
  const heartbeatBody = () => ({
    progressLabel: progress.label,
    progressDetail: progress.detail,
    progressUpdatedAt: progress.updatedAt,
    executionRepoPath: progress.executionRepoPath,
    runtime: getWorkerRuntimeReport(),
  });
  const setProgress = (label, detail = "") => {
    progress.label = label;
    progress.detail = detail || label;
    progress.updatedAt = new Date().toISOString();
  };

  try {
    if (!runRepoPath) {
      throw new Error("No repository path is selected for this Local Worker run.");
    }

    await writeFile(packetFile, run.packet, "utf8");
    await postJson(`/api/workers/runs/${run.runId}/heartbeat`, heartbeatBody());
    runHeartbeatTimer = setInterval(() => {
      void postJson(
        `/api/workers/runs/${run.runId}/heartbeat`,
        heartbeatBody(),
      ).catch((error) => {
        console.warn(
          `[worker:${workerId}] run heartbeat failed for ${run.runId}: ${formatError(error)}`,
        );
      });
    }, 30000);

    if (!commandTemplate.trim()) {
      throw new Error(
        "CODEX_COMMAND_TEMPLATE is not configured for this Local Worker.",
      );
    }

    const preparedRepo = await prepareExecutionRepository(run, runRepoPath, {
      setProgress,
    });
    runRepoPath = preparedRepo.repoPath;
    progress.executionRepoPath = runRepoPath;
    await postJson(`/api/workers/runs/${run.runId}/heartbeat`, heartbeatBody());

    const command = renderCommand(commandTemplate, {
      packetFile,
      requestId: run.requestId,
      agentRole: run.agentRole,
      repoPath: runRepoPath,
    });
    setProgress("Running Codex", `${run.agentRole} is executing in ${runRepoPath}.`);
    await postJson(`/api/workers/runs/${run.runId}/heartbeat`, heartbeatBody());
    const result = await runCommand(
      command,
      runRepoPath,
      {
        AGENT_PACKET_FILE: packetFile,
      },
      0,
      (chunkText) => {
        const inferred = inferCommandProgress(chunkText);
        if (inferred) {
          setProgress(inferred.label, inferred.detail);
        }
      },
    );
    const deliverySummary =
      result.exitCode === 0
        ? await finalizeTeamPrDelivery(run, runRepoPath, { setProgress })
        : "";
    setProgress("Collecting diff summary", "Codex finished; collecting git diff.");
    await postJson(`/api/workers/runs/${run.runId}/heartbeat`, heartbeatBody());
    const diffSummary = await collectDiffSummary(runRepoPath);
    const artifact = buildArtifact(run, result, diffSummary, deliverySummary);

    await postJson(`/api/workers/runs/${run.runId}/complete`, {
      status: result.exitCode === 0 ? "completed" : "failed",
      commandOutput: result.output,
      diffSummary,
      artifact,
      error: result.exitCode === 0 ? "" : `Command exited ${result.exitCode}.`,
    });

    console.log(`[worker:${workerId}] completed ${run.runId}`);
  } catch (error) {
    const blockedError = formatBlockedWorkerError(error);
    await postJson(`/api/workers/runs/${run.runId}/complete`, {
      status: "blocked",
      error: blockedError,
      artifact: `# Worker Blocked\n\n${blockedError}`,
      diffSummary: await collectDiffSummary(runRepoPath || process.cwd()).catch(
        () => "",
      ),
    });
    console.error(`[worker:${workerId}] blocked ${run.runId}:`, error);
  } finally {
    if (runHeartbeatTimer) {
      clearInterval(runHeartbeatTimer);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function pollWorker() {
  const response = await fetch(`${controlPlaneUrl}/api/workers/poll`, {
    headers: workerHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("Worker connection was stopped")) {
      throw new WorkerStoppedError(
        "connection was stopped from Codex Mission Control; exiting.",
      );
    }

    throw new Error(text);
  }

  const data = await response.json();
  return {
    run: data.run ?? null,
    recheckReadiness: data.recheckReadiness === true,
    setupCodex: data.setupCodex === true,
  };
}

async function postJson(pathname, body) {
  const response = await fetch(`${controlPlaneUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...workerHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function reportRepositoryCandidates() {
  const repositories = await scanRepositoryCandidates();
  const readiness = await checkCodexReadiness();
  await postJson("/api/workers/repositories", {
    repositories,
    ...readiness,
    runtime: getWorkerRuntimeReport(),
  });
  console.log(
    `[worker:${workerId}] reported ${repositories.length} repository candidate(s); Codex ${readiness.codexStatus}`,
  );
}

function getWorkerRuntimeReport() {
  return {
    workerVersion,
    workerScriptHash: currentWorkerScriptHash || "",
    launcherVersion,
    workerUpdatedAt,
  };
}

async function setupCodexCli() {
  console.log(`[worker:${workerId}] starting Codex CLI setup`);
  const before = await checkCodexReadiness();
  if (before.codexReady) {
    await reportRepositoryCandidates();
    return;
  }

  if (
    before.codexDiagnosticCode === "cli-missing" ||
    before.codexDiagnosticCode === "desktop-internal-not-cli"
  ) {
    console.log(`[worker:${workerId}] installing Codex CLI: ${codexInstallCommand}`);
    const install = await runCommand(
      codexInstallCommand,
      getCommandCwd(),
      {},
      120000,
    );
    if (install.exitCode !== 0) {
      await reportCodexReadinessFailure({
        message: `Codex CLI install failed: ${install.output.trim()}`,
        diagnosticCode: "cli-command-failed",
      });
      return;
    }
  }

  console.log(
    `[worker:${workerId}] opening Codex login in this terminal: ${codexLoginCommand}`,
  );
  const login = await runInteractiveCommand(codexLoginCommand, getCommandCwd());
  if (login.exitCode !== 0) {
    await reportCodexReadinessFailure({
      message: `Codex login exited ${login.exitCode}. Run ${codexLoginCommand} manually if the login window was closed.`,
      diagnosticCode: "cli-command-failed",
    });
    return;
  }

  await reportRepositoryCandidates();
}

async function reportCodexReadinessFailure({
  message,
  diagnosticCode = "cli-command-failed",
  executablePath = "",
}) {
  const repositories = await scanRepositoryCandidates().catch(() => []);
  await postJson("/api/workers/repositories", {
    repositories,
    codexReady: false,
    codexStatus:
      diagnosticCode === "cli-missing" ? "missing-command" : "command-failed",
    codexError: message,
    codexDiagnosticCode: diagnosticCode,
    codexExecutablePath: executablePath,
    codexCheckedAt: new Date().toISOString(),
  });
}

async function checkCodexReadiness() {
  const codexCheckedAt = new Date().toISOString();
  if (!commandTemplate.trim()) {
    return {
      codexReady: false,
      codexStatus: "missing-command",
      codexError: "CODEX_COMMAND_TEMPLATE is not configured.",
      codexDiagnosticCode: "missing-command",
      codexExecutablePath: "",
      codexCheckedAt,
    };
  }

  const codexLocation = await locateCodexCommand().catch(() => ({
    output: "",
  }));
  const codexExecutablePath = parseCommandOutputLines(codexLocation.output)[0] || "";
  const result = await runCommand(readinessCommand, getCommandCwd(), {}, 15000);
  if (result.exitCode === 0) {
    return {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath,
      codexCheckedAt,
    };
  }

  const diagnostic = diagnoseCodexReadiness({
    output: result.output,
    whereOutput: codexLocation.output,
    readinessCommand,
    exitCode: result.exitCode,
  });

  return {
    codexReady: false,
    codexStatus:
      diagnostic.codexDiagnosticCode === "cli-missing"
        ? "missing-command"
        : "command-failed",
    codexError: diagnostic.codexError,
    codexDiagnosticCode: diagnostic.codexDiagnosticCode,
    codexExecutablePath: diagnostic.codexExecutablePath,
    codexCheckedAt,
  };
}

async function locateCodexCommand() {
  if (process.platform !== "win32") {
    return runCommand("command -v codex", getCommandCwd(), {}, 5000);
  }

  const whereResult = await runCommand("where codex", getCommandCwd(), {}, 5000);
  const powerShellResult = await runCommand(
    'powershell -NoProfile -Command "Get-Command codex -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source"',
    getCommandCwd(),
    {},
    5000,
  );

  return {
    exitCode:
      whereResult.exitCode === 0 || powerShellResult.exitCode === 0 ? 0 : 1,
    output: [whereResult.output, powerShellResult.output]
      .filter(Boolean)
      .join("\n"),
  };
}

async function scanRepositoryCandidates() {
  const roots = uniqueStrings([
    defaultRepoPath,
    process.cwd(),
    path.dirname(process.cwd()),
    path.join(homedir(), "Documents"),
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Downloads"),
  ]);
  const repositories = (
    await Promise.all(roots.map((root) => findRepositories(root, 4)))
  ).flat();

  return uniqueRepositories(repositories).slice(0, 50);
}

function getCommandCwd() {
  return defaultRepoPath || process.cwd();
}

async function findRepositories(root, maxDepth) {
  const repositories = [];
  let visited = 0;

  async function walk(directory, depth) {
    if (depth > maxDepth || visited > 1000) {
      return;
    }

    visited += 1;
    if (!(await isDirectory(directory))) {
      return;
    }

    if (await isDirectory(path.join(directory, ".git"))) {
      repositories.push({
        name: path.basename(directory),
        path: directory,
        source: root,
      });
      return;
    }

    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        skippedRepositoryScanDirs.has(entry.name) ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      await walk(path.join(directory, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return repositories;
}

async function safeReadDir(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function workerHeaders() {
  return {
    authorization: `Bearer ${workerToken}`,
    "x-worker-id": workerId,
  };
}

function renderCommand(template, values) {
  return template
    .replaceAll("{packetFile}", quote(values.packetFile))
    .replaceAll("{requestId}", values.requestId)
    .replaceAll("{agentRole}", values.agentRole)
    .replaceAll("{repoPath}", quote(values.repoPath));
}

async function prepareExecutionRepository(run, repoPath, progress) {
  if (run.agentRole !== "agent2" || !isDraftPrRun(run)) {
    return { repoPath };
  }

  progress.setProgress(
    "Preparing request worktree",
    "Creating or reusing an isolated request-scoped worktree before Agent2.",
  );

  const gitCheck = await runCommand("git rev-parse --show-toplevel", repoPath, {}, 15000);
  if (gitCheck.exitCode !== 0) {
    throw new Error(
      `Cannot prepare request-scoped worktree because the selected repo is not a Git repository: ${gitCheck.output.trim()}`,
    );
  }

  await ensureCleanGitWorktree(
    repoPath,
    "Cannot prepare the request branch because the selected repo has uncommitted changes. Commit, stash, or discard unrelated changes before rerunning Agent2.",
  );
  await runGitOrThrow("git fetch origin", repoPath, 120000);

  const trace = getRunPrDeliveryTrace(run);
  const branchName =
    trace.sourceBranch || `codex/${sanitizeBranchSegment(run.requestId)}`;
  if (autoCommitAndPr && !trace.sourceBranch) {
    throw new Error(
      "Cannot prepare the team PR branch because this draft PR request has no verified Azure Work Item. Verify an Azure Work Item so the worker can use feature/{id}, bug/{id}, or hotfix/{id}.",
    );
  }
  const baseRef = await resolveWorktreeBaseRef(repoPath, Boolean(trace.sourceBranch));
  const worktreeRoot = path.join(path.dirname(repoPath), ".codex-request-worktrees");
  const worktreePath = path.join(worktreeRoot, sanitizePathSegment(run.requestId));
  await mkdir(worktreeRoot, { recursive: true });

  const existingWorktree = await findExistingWorktree(repoPath, worktreePath);
  if (existingWorktree) {
    await ensureCleanGitWorktree(
      existingWorktree,
      "Cannot reuse the request worktree because it has uncommitted changes from an earlier run.",
    );
    return { repoPath: existingWorktree };
  }

  const branchExists = await gitRefExists(repoPath, `refs/heads/${branchName}`);
  const addCommand = branchExists
    ? `git worktree add ${quote(worktreePath)} ${quote(branchName)}`
    : `git worktree add -b ${quote(branchName)} ${quote(worktreePath)} ${quote(baseRef)}`;
  const addResult = await runCommand(addCommand, repoPath, {}, 120000);
  if (addResult.exitCode !== 0) {
    throw new Error(
      `Cannot prepare request-scoped worktree for ${run.requestId}: ${addResult.output.trim()}`,
    );
  }

  return { repoPath: worktreePath };
}

async function resolveWorktreeBaseRef(repoPath, requireDevelop = false) {
  if (requireDevelop) {
    const result = await runCommand(
      "git rev-parse --verify origin/develop",
      repoPath,
      {},
      15000,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        "Cannot prepare the formal PR branch because origin/develop was not found.",
      );
    }
    return "origin/develop";
  }

  for (const ref of ["origin/develop", "develop", "origin/main", "main", "HEAD"]) {
    const result = await runCommand(`git rev-parse --verify ${quote(ref)}`, repoPath, {}, 15000);
    if (result.exitCode === 0) {
      return ref;
    }
  }

  return "HEAD";
}

async function gitRefExists(repoPath, ref) {
  const result = await runCommand(
    `git show-ref --verify --quiet ${quote(ref)}`,
    repoPath,
    {},
    15000,
  );
  return result.exitCode === 0;
}

async function findExistingWorktree(repoPath, worktreePath) {
  const result = await runCommand("git worktree list --porcelain", repoPath, {}, 15000);
  if (result.exitCode !== 0) {
    return "";
  }

  const normalizedTarget = path.resolve(worktreePath).toLowerCase();
  const existing = parseCommandOutputLines(result.output)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .find((candidate) => path.resolve(candidate).toLowerCase() === normalizedTarget);
  return existing || "";
}

async function runGitOrThrow(command, cwd, timeoutMs = 120000) {
  const result = await runCommand(command, cwd, {}, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed: ${result.output.trim()}`);
  }

  return result;
}

async function ensureCleanGitWorktree(cwd, message) {
  const status = await gitStatusPorcelain(cwd);
  if (status.trim()) {
    throw new Error(`${message}\n\nCurrent git status:\n${status.trim()}`);
  }
}

async function gitStatusPorcelain(cwd) {
  const result = await runCommand("git status --porcelain", cwd, {}, 30000);
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.output.trim()}`);
  }

  return result.output;
}

function hasUnmergedStatus(status) {
  return parseCommandOutputLines(status).some((line) =>
    /^(DD|AU|UD|UA|DU|AA|UU|U | U)/.test(line),
  );
}

function getRunPrDeliveryTrace(run) {
  return {
    baseBranch: getPacketHeaderValue(run.packet, "PR Delivery Base Branch") || "develop",
    sourceBranch: normalizeOptionalPacketValue(
      getPacketHeaderValue(run.packet, "PR Delivery Source Branch"),
    ),
    workItemId: normalizeOptionalPacketValue(
      getPacketHeaderValue(run.packet, "PR Delivery Work Item"),
    ),
    branchKind: normalizeOptionalPacketValue(
      getPacketHeaderValue(run.packet, "PR Delivery Branch Kind"),
    ),
  };
}

function getPacketHeaderValue(packet, label) {
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im");
  return packet?.match(pattern)?.[1]?.trim() || "";
}

function normalizeOptionalPacketValue(value) {
  const trimmed = String(value || "").trim();
  return trimmed.startsWith("(") ? "" : trimmed;
}

function buildTeamPrCommitMessage(run, trace) {
  const requestKind = getPacketHeaderValue(run.packet, "Request kind").toUpperCase();
  const summary =
    getPacketHeaderValue(run.packet, "Interpretation Summary") ||
    getPacketHeaderValue(run.packet, "Request ID") ||
    "本次需求調整";
  const verb = trace.branchKind === "bug" || requestKind === "BUG" ? "修正" : "調整";
  const normalizedSummary = summary.replace(/\s+/g, " ").trim();
  return `#${trace.workItemId} ${
    trace.branchKind === "hotfix" || requestKind === "HOTFIX" ? "fix" : verb
  } ${normalizedSummary}`.slice(0, 120);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDraftPrRun(run) {
  return /Delivery Mode:\s*Draft PR required/i.test(run.packet || "");
}

function sanitizeBranchSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, 80);
}

function sanitizePathSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function inferCommandProgress(chunkText) {
  const text = chunkText.trim();
  if (!text) {
    return null;
  }

  const shellCommand = text.match(/-Command ['"]([^'"]+)['"]/);
  if (shellCommand?.[1]) {
    return {
      label: "Running shell command",
      detail: shellCommand[1],
    };
  }

  const pnpmScript = text.match(/>\s+(pnpm\s+[^\r\n]+)/i);
  if (pnpmScript?.[1]) {
    return {
      label: "Running pnpm command",
      detail: pnpmScript[1],
    };
  }

  if (/pnpm verify:/i.test(text)) {
    return { label: "Running full verification", detail: clipProgressText(text) };
  }

  if (/pnpm .*test/i.test(text)) {
    return { label: "Running tests", detail: clipProgressText(text) };
  }

  if (/git diff|git status/i.test(text)) {
    return { label: "Checking git diff", detail: clipProgressText(text) };
  }

  return null;
}

function clipProgressText(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function runCommand(command, cwd, extraEnv = {}, timeoutMs = 0, onOutput = null) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    const chunks = [];
    let settled = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;
            child.kill();
            const decodedOutput = decodeCommandBuffer(Buffer.concat(chunks));
            resolve({
              exitCode: 124,
              output: `${decodedOutput}\nCommand timed out after ${timeoutMs}ms.`,
            });
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      chunks.push(buffer);
      const decoded = decodeCommandBuffer(buffer);
      onOutput?.(decoded);
      process.stdout.write(decoded);
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      chunks.push(buffer);
      const decoded = decodeCommandBuffer(buffer);
      onOutput?.(decoded);
      process.stderr.write(decoded);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        exitCode: exitCode ?? 1,
        output: decodeCommandBuffer(Buffer.concat(chunks)).slice(-20000),
      });
    });
  });
}

function runInteractiveCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "inherit",
      windowsHide: false,
      env: process.env,
    });

    child.on("error", () => {
      resolve({ exitCode: 1 });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1 });
    });
  });
}

async function collectDiffSummary(cwd) {
  const status = await runCommand("git status --branch --short", cwd);
  const stat = await runCommand("git diff --stat", cwd);
  const branchStat = await runCommand("git diff --stat origin/develop...HEAD", cwd);
  const lastCommit = await runCommand("git log -1 --oneline --decorate", cwd);

  return [
    "## git status --branch --short",
    status.output.trim() || "clean",
    "",
    "## git diff --stat",
    stat.output.trim() || "no diff",
    "",
    "## git diff --stat origin/develop...HEAD",
    branchStat.exitCode === 0 ? branchStat.output.trim() || "no branch diff" : branchStat.output.trim(),
    "",
    "## latest commit",
    lastCommit.output.trim() || "not available",
  ].join("\n");
}

async function finalizeTeamPrDelivery(run, repoPath, progress) {
  if (!autoCommitAndPr || run.agentRole !== "agent2" || !isDraftPrRun(run)) {
    return "";
  }

  const trace = getRunPrDeliveryTrace(run);
  if (!trace.sourceBranch) {
    throw new Error(
      "Cannot commit and push the PR branch because the Agent packet does not contain a feature/{id}, bug/{id}, or hotfix/{id} source branch.",
    );
  }

  progress.setProgress(
    "Preparing PR branch commit",
    `Checking changes for ${trace.sourceBranch} before commit and push.`,
  );
  const status = await gitStatusPorcelain(repoPath);
  if (!status.trim()) {
    return `No local changes found to commit for ${trace.sourceBranch}.`;
  }
  if (hasUnmergedStatus(status)) {
    throw new Error(
      "Cannot commit and push because the request worktree has unresolved merge conflicts.",
    );
  }

  await runGitOrThrow("git add -A", repoPath, 120000);
  const staged = await runCommand("git diff --cached --quiet", repoPath, {}, 120000);
  if (staged.exitCode === 0) {
    return `No staged changes found to commit for ${trace.sourceBranch}.`;
  }

  const commitMessage = buildTeamPrCommitMessage(run, trace);
  progress.setProgress(
    "Committing PR branch",
    `Creating commit on ${trace.sourceBranch}: ${commitMessage}`,
  );
  await runGitOrThrow(`git commit -m ${quote(commitMessage)}`, repoPath, 120000);

  progress.setProgress(
    "Pushing PR branch",
    `Pushing ${trace.sourceBranch} to origin before merging origin/develop.`,
  );
  await runGitOrThrow(`git push -u origin ${quote(trace.sourceBranch)}`, repoPath, 120000);
  await ensureCleanGitWorktree(
    repoPath,
    "Cannot merge origin/develop because the request branch is not clean after commit.",
  );

  progress.setProgress(
    "Merging develop into request branch",
    `Merging origin/develop into ${trace.sourceBranch}.`,
  );
  await runGitOrThrow("git fetch origin", repoPath, 120000);
  await runGitOrThrow("git merge --no-edit origin/develop", repoPath, 120000);
  await ensureCleanGitWorktree(
    repoPath,
    "Cannot finish PR branch preparation because the merge from origin/develop left local changes.",
  );

  progress.setProgress(
    "Pushing updated PR branch",
    `Pushing ${trace.sourceBranch} after merging origin/develop.`,
  );
  await runGitOrThrow(`git push origin ${quote(trace.sourceBranch)}`, repoPath, 120000);

  return [
    `Committed and pushed ${trace.sourceBranch}.`,
    `Commit message: ${commitMessage}`,
    "Merged origin/develop into the request branch and pushed again.",
  ].join("\n");
}

function buildArtifact(run, result, diffSummary, deliverySummary = "") {
  const writePreference = autoCommitAndPr
    ? "Auto commit / draft PR preference is enabled for this worker. Azure and Git writes still must obey the control-plane guarded write policy."
    : "Auto commit / draft PR preference is disabled for this worker.";

  return [
    `# ${run.agentRole} Worker Result`,
    "",
    `Request ID: ${run.requestId}`,
    `Run ID: ${run.runId}`,
    `Exit Code: ${result.exitCode}`,
    "",
    "## Diff Summary",
    "",
    diffSummary || "No diff summary returned.",
    "",
    "## Notes",
    "",
    writePreference,
    deliverySummary ? `\n## Team PR Delivery\n\n${deliverySummary}` : "",
    "",
    "Review the command output and diff before approving any Azure PR write.",
  ].filter(Boolean).join("\n");
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function buildDefaultCodexCommandTemplate() {
  return `codex exec --skip-git-repo-check --sandbox ${sandboxMode} - < {packetFile}`;
}

function normalizeSandboxMode(value) {
  return value === "danger-full-access" ? value : "workspace-write";
}

function uniqueRepositories(repositories) {
  const seen = new Set();
  const result = [];

  for (const repository of repositories) {
    const key = repository.path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(repository);
  }

  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function computeCurrentWorkerScriptHash() {
  const content = await readFile(fileURLToPath(import.meta.url));
  return createHash("sha256").update(content).digest("hex");
}

function formatBlockedWorkerError(error) {
  const message = formatError(error);
  if (isWorkerRuntimeError(error, message)) {
    return `worker_runtime_error: 本機背景 Worker 版本不同步或執行環境異常，請重新下載並重啟 Worker。原始錯誤：${message}`;
  }

  if (isRepoDirtyError(message)) {
    return `repo_dirty_blocked: 本機 repo 目前有未提交異動或分支衝突。${message}`;
  }

  return message;
}

function isWorkerRuntimeError(error, message) {
  return (
    error instanceof ReferenceError ||
    /is not defined|worker script integrity mismatch|worker version/i.test(message)
  );
}

function isRepoDirtyError(message) {
  return /working tree is not clean|repo is not clean|uncommitted changes|unresolved merge conflict|merge conflict/i.test(
    message,
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  if (error instanceof WorkerStoppedError) {
    console.log(`[worker:${workerId}] ${error.message}`);
    return;
  }

  console.error(error);
  process.exitCode = 1;
});

class WorkerStoppedError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkerStoppedError";
  }
}
