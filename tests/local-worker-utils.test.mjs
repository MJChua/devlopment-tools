import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_CODEX_LOGIN_COMMAND,
  buildCodexReadinessError,
  decodeCommandBuffer,
  diagnoseCodexReadiness,
  findUnauthorizedGitStatusEntries,
  gitPathMatchesAllowedPattern,
  hasUnmergedGitStatus,
  normalizeAllowedFilePatterns,
  parseGitStatusPorcelainEntries,
} = await import("../scripts/local-worker-utils.mjs");

test("git porcelain parser extracts modified, untracked, and renamed paths", () => {
  const entries = parseGitStatusPorcelainEntries(
    [
      " M docs/ai/tasks/ADO-876.md",
      "?? docs/ai/tasks/raw/ADO-876-work-item.json",
      "R  old/path.ts -> src/new/path.ts",
    ].join("\n"),
  );

  assert.deepEqual(entries, [
    {
      raw: "M docs/ai/tasks/ADO-876.md",
      status: " M",
      paths: ["docs/ai/tasks/ADO-876.md"],
    },
    {
      raw: "?? docs/ai/tasks/raw/ADO-876-work-item.json",
      status: "??",
      paths: ["docs/ai/tasks/raw/ADO-876-work-item.json"],
    },
    {
      raw: "R  old/path.ts -> src/new/path.ts",
      status: "R ",
      paths: ["old/path.ts", "src/new/path.ts"],
    },
  ]);
});

test("allowed file pattern matching supports exact paths, directories, and wildcards", () => {
  const patterns = normalizeAllowedFilePatterns([
    "`docs/ai/tasks/ADO-876.md`",
    "docs/ai/tasks/raw/",
    "apps/admin-hq-web/src/**/*.vue",
  ]);

  assert.deepEqual(patterns, [
    "docs/ai/tasks/ADO-876.md",
    "docs/ai/tasks/raw/",
    "apps/admin-hq-web/src/**/*.vue",
  ]);
  assert.equal(
    gitPathMatchesAllowedPattern(
      "docs/ai/tasks/ADO-876.md",
      "docs/ai/tasks/ADO-876.md",
    ),
    true,
  );
  assert.equal(
    gitPathMatchesAllowedPattern(
      "docs/ai/tasks/raw/source.json",
      "docs/ai/tasks/raw/",
    ),
    true,
  );
  assert.equal(
    gitPathMatchesAllowedPattern(
      "apps/admin-hq-web/src/views/ContractView.vue",
      "apps/admin-hq-web/src/**/*.vue",
    ),
    true,
  );
  assert.equal(
    gitPathMatchesAllowedPattern(
      "apps/admin-agent-web/src/views/ContractView.vue",
      "apps/admin-hq-web/src/**/*.vue",
    ),
    false,
  );
});

test("scoped dirty helper rejects conflicts and unmatched files", () => {
  assert.equal(hasUnmergedGitStatus("UU src/conflict.ts"), true);
  assert.equal(hasUnmergedGitStatus(" M src/clean.ts"), false);

  const unauthorized = findUnauthorizedGitStatusEntries(
    [
      " M docs/ai/tasks/ADO-876.md",
      "?? docs/ai/tasks/raw/source.json",
      " M src/unrelated.ts",
    ].join("\n"),
    ["docs/ai/tasks/ADO-876.md", "docs/ai/tasks/raw/"],
  );

  assert.deepEqual(
    unauthorized.map((entry) => entry.raw),
    ["M src/unrelated.ts"],
  );
});

test("default Codex login command uses the supported login subcommand", () => {
  assert.equal(DEFAULT_CODEX_LOGIN_COMMAND, "codex login");
  assert.doesNotMatch(DEFAULT_CODEX_LOGIN_COMMAND, /--login/);
});

test("worker command output falls back to Big5 for Windows shell errors", () => {
  const accessDeniedBig5 = Buffer.from("a673a8fab351a9daa1430d0a", "hex");

  assert.equal(decodeCommandBuffer(accessDeniedBig5), "存取被拒。\r\n");
  assert.equal(decodeCommandBuffer(accessDeniedBig5).includes("�"), false);
});

test("missing Codex CLI is classified for user guidance", () => {
  const diagnostic = diagnoseCodexReadiness({
    output: "'codex' 不是內部或外部命令、可執行的程式或批次檔。",
    whereOutput: "",
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });

  assert.equal(diagnostic.codexDiagnosticCode, "cli-missing");
  assert.equal(diagnostic.codexExecutablePath, "");
  assert.match(diagnostic.codexError, /找不到可由 terminal 呼叫的 Codex CLI/);
});

test("where.exe not-found output is not treated as an executable path", () => {
  const diagnostic = diagnoseCodexReadiness({
    output: "'codex' 不是內部或外部命令、可執行的程式或批次檔。",
    whereOutput: "資訊: 找不到提供模式的檔案。",
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });

  assert.equal(diagnostic.codexDiagnosticCode, "cli-missing");
  assert.equal(diagnostic.codexExecutablePath, "");
  assert.match(diagnostic.codexError, /找不到可由 terminal 呼叫的 Codex CLI/);
});

test("garbled where.exe not-found output is not treated as an executable path", () => {
  const diagnostic = diagnoseCodexReadiness({
    output: "'codex' 不是內部或外部命令、可執行的程式或批次檔。",
    whereOutput: "��T: �䤣�촣�ѼҦ����ɮסC",
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });

  assert.equal(diagnostic.codexDiagnosticCode, "cli-missing");
  assert.equal(diagnostic.codexExecutablePath, "");
});

test("failed Codex CLI command preserves executable path", () => {
  const diagnostic = diagnoseCodexReadiness({
    output: "not logged in",
    whereOutput: "C:\\Users\\MichaelChao\\AppData\\Roaming\\npm\\codex.cmd",
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });

  assert.equal(diagnostic.codexDiagnosticCode, "cli-command-failed");
  assert.equal(
    diagnostic.codexExecutablePath,
    "C:\\Users\\MichaelChao\\AppData\\Roaming\\npm\\codex.cmd",
  );
  assert.match(diagnostic.codexError, /not logged in/);
});

test("Codex Desktop WindowsApps command is diagnosed clearly", () => {
  const diagnostic = diagnoseCodexReadiness({
    output: "存取被拒。",
    whereOutput: [
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.519.5221.0_x64__2p2nqsd0c76g0\\app\\resources\\codex",
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.519.5221.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe",
    ].join("\r\n"),
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });
  const error = buildCodexReadinessError({
    output: "存取被拒。",
    whereOutput: diagnostic.codexExecutablePath,
    readinessCommand: "codex exec --help",
    exitCode: 1,
  });

  assert.equal(diagnostic.codexDiagnosticCode, "desktop-internal-not-cli");
  assert.match(diagnostic.codexExecutablePath, /WindowsApps/);
  assert.match(error, /Codex CLI 無法從 Local Worker 執行/);
  assert.match(error, /Codex Desktop 內部執行檔/);
  assert.match(error, /存取被拒/);
  assert.equal(error.includes("�"), false);
});
