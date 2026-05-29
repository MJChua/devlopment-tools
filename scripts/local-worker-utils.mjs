const replacementChar = "\uFFFD";

export const DEFAULT_CODEX_LOGIN_COMMAND = "codex login";

export function decodeCommandBuffer(buffer) {
  if (!buffer?.length) {
    return "";
  }

  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes(replacementChar)) {
    return utf8;
  }

  try {
    const big5 = new TextDecoder("big5").decode(buffer);
    return countReplacementChars(big5) < countReplacementChars(utf8)
      ? big5
      : utf8;
  } catch {
    return utf8;
  }
}

export function buildCodexReadinessError({
  output,
  whereOutput = "",
  readinessCommand = "codex exec --help",
  exitCode = 1,
}) {
  return diagnoseCodexReadiness({
    output,
    whereOutput,
    readinessCommand,
    exitCode,
  }).codexError;
}

export function diagnoseCodexReadiness({
  output,
  whereOutput = "",
  readinessCommand = "codex exec --help",
  exitCode = 1,
}) {
  const cleanOutput = normalizeWhitespace(output);
  const codexPaths = parseCommandOutputLines(whereOutput).filter(
    isCodexExecutablePath,
  );
  const codexExecutablePath = codexPaths[0] || "";
  const desktopCodexPath = codexPaths.find(isCodexDesktopWindowsAppsPath) || "";

  if (!codexExecutablePath && isMissingCommandOutput(cleanOutput)) {
    return {
      codexDiagnosticCode: "cli-missing",
      codexExecutablePath: "",
      codexError:
        "找不到可由 terminal 呼叫的 Codex CLI。請先安裝並登入 Codex CLI，再重新檢查。",
    };
  }

  if (desktopCodexPath) {
    return {
      codexDiagnosticCode: "desktop-internal-not-cli",
      codexExecutablePath: desktopCodexPath,
      codexError: [
        "Codex CLI 無法從 Local Worker 執行。",
        `目前找到的是 Codex Desktop 內部執行檔：${desktopCodexPath}`,
        "這不是可由 terminal 直接呼叫的 Codex CLI。",
        `原始錯誤：${cleanOutput || "存取被拒。"}`,
      ].join(" "),
    };
  }

  if (cleanOutput) {
    return {
      codexDiagnosticCode: "cli-command-failed",
      codexExecutablePath,
      codexError: cleanOutput,
    };
  }

  return {
    codexDiagnosticCode: "cli-command-failed",
    codexExecutablePath,
    codexError: `${readinessCommand} exited ${exitCode}.`,
  };
}

export function parseCommandOutputLines(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isCodexDesktopWindowsAppsPath(value) {
  const normalized = value.replaceAll("/", "\\").toLowerCase();
  return (
    normalized.includes("\\windowsapps\\openai.codex_") &&
    normalized.includes("\\app\\resources\\codex")
  );
}

function isCodexExecutablePath(value) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = raw.replaceAll("/", "\\");
  if (
    !(
      /^[a-z]:\\/.test(normalized) ||
      normalized.startsWith("\\\\") ||
      raw.startsWith("/")
    )
  ) {
    return false;
  }

  return /(^|\\)codex(\.cmd|\.exe|\.ps1)?$/.test(normalized);
}

function isMissingCommandOutput(value) {
  return (
    /not recognized|not found|找不到|不是內部或外部命令|不是內部或外部命令|無法辨識|command not found/i.test(
      value,
    ) || !value
  );
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countReplacementChars(value) {
  return [...String(value || "")].filter((char) => char === replacementChar)
    .length;
}
