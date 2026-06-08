const replacementChar = "\uFFFD";

export const DEFAULT_CODEX_LOGIN_COMMAND = "codex login";
export const GIT_REMOTE_DEVELOP_REF = "refs/heads/develop";
export const GIT_REMOTE_CHECK_TIMEOUT_MS = 15000;

export function parseGitRemoteUrl(value) {
  const originUrl = String(value || "").trim();
  const empty = {
    originUrl,
    protocol: "missing",
    host: "",
    port: null,
    targetRef: GIT_REMOTE_DEVELOP_REF,
  };
  if (!originUrl) {
    return empty;
  }

  try {
    const url = new URL(originUrl);
    const urlProtocol = url.protocol.replace(/:$/, "").toLowerCase();
    const protocol =
      urlProtocol === "ssh"
        ? "ssh"
        : urlProtocol === "https"
          ? "https"
          : "other";
    return {
      originUrl,
      protocol,
      host: url.hostname,
      port: url.port
        ? Number(url.port)
        : protocol === "ssh"
          ? 22
          : protocol === "https"
            ? 443
            : null,
      targetRef: GIT_REMOTE_DEVELOP_REF,
    };
  } catch {
    // Fall through to scp-like SSH syntax, e.g. git@ssh.dev.azure.com:v3/org/project/repo.
  }

  const scpLikeMatch = /^[a-zA-Z]:[\\/]/.test(originUrl)
    ? null
    : originUrl.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
  if (scpLikeMatch) {
    return {
      originUrl,
      protocol: "ssh",
      host: scpLikeMatch[1],
      port: 22,
      targetRef: GIT_REMOTE_DEVELOP_REF,
    };
  }

  return {
    originUrl,
    protocol: "other",
    host: "",
    port: null,
    targetRef: GIT_REMOTE_DEVELOP_REF,
  };
}

export function buildGitRemoteCheckEnv(originUrl) {
  const remote = parseGitRemoteUrl(originUrl);
  return {
    GIT_TERMINAL_PROMPT: "0",
    ...(remote.protocol === "ssh"
      ? { GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10" }
      : {}),
  };
}

export function buildGitRemoteDiagnostic({
  originUrl = "",
  output = "",
  exitCode = 1,
  timedOut = false,
  skipped = false,
} = {}) {
  const remote = parseGitRemoteUrl(originUrl);
  if (skipped) {
    return {
      ...remote,
      status: "skipped",
      reason: "",
      error: "",
    };
  }

  if (!remote.originUrl) {
    return {
      ...remote,
      status: "blocked",
      reason: "missing_origin",
      error: normalizeWhitespace(output) || "origin remote is not configured.",
    };
  }

  if (!timedOut && Number(exitCode) === 0) {
    return {
      ...remote,
      status: "ok",
      reason: "",
      error: "",
    };
  }

  return {
    ...remote,
    status: "blocked",
    reason: classifyGitRemoteError(output, { timedOut }),
    error:
      normalizeWhitespace(output) ||
      (timedOut
        ? "git ls-remote origin refs/heads/develop timed out."
        : `git ls-remote origin refs/heads/develop exited ${exitCode}.`),
  };
}

export function classifyGitRemoteError(output, { timedOut = false } = {}) {
  const normalized = normalizeWhitespace(output).toLowerCase();
  if (
    timedOut ||
    /\b(etimedout|timed out|timeout|operation timed out)\b/i.test(normalized)
  ) {
    return "network_timeout";
  }

  if (
    /could not resolve hostname|name or service not known|getaddrinfo|enotfound|eai_again|no such host/i.test(
      normalized,
    )
  ) {
    return "dns_failed";
  }

  if (/connection refused|econnrefused/i.test(normalized)) {
    return "connection_refused";
  }

  if (
    /permission denied|publickey|authentication failed|could not read username|terminal prompts disabled|access denied|repository not found|tf401019|fatal: repository/i.test(
      normalized,
    )
  ) {
    return "auth_failed";
  }

  return "unknown";
}

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

export function parseGitStatusPorcelainEntries(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const status = line.slice(0, 2);
      const detail = line.length > 3 ? line.slice(3).trim() : "";
      const paths = detail.includes(" -> ")
        ? detail.split(" -> ").map(cleanGitStatusPath)
        : [cleanGitStatusPath(detail)];

      return {
        raw: line.trimStart(),
        status,
        paths: paths.filter(Boolean),
      };
    });
}

export function hasUnmergedGitStatus(output) {
  return parseGitStatusPorcelainEntries(output).some((entry) =>
    /^(DD|AU|UD|UA|DU|AA|UU|U | U)/.test(entry.status),
  );
}

export function normalizeAllowedFilePatterns(patterns) {
  return [...new Set(
    (Array.isArray(patterns) ? patterns : [])
      .flatMap((pattern) => extractAllowedPatternCandidates(pattern))
      .map(cleanAllowedFilePattern)
      .filter(Boolean),
  )];
}

export function gitPathMatchesAllowedPattern(gitPath, pattern) {
  const normalizedPath = normalizeGitPath(gitPath);
  const normalizedPattern = cleanAllowedFilePattern(pattern);
  if (!normalizedPath || !normalizedPattern) {
    return false;
  }

  if (normalizedPattern.includes("*")) {
    return wildcardPatternToRegExp(normalizedPattern).test(normalizedPath);
  }

  const prefix = normalizedPattern.endsWith("/")
    ? normalizedPattern
    : `${normalizedPattern}/`;

  return (
    normalizedPath === normalizedPattern ||
    normalizedPath.startsWith(prefix)
  );
}

export function findUnauthorizedGitStatusEntries(output, allowedPatterns) {
  const normalizedPatterns = normalizeAllowedFilePatterns(allowedPatterns);
  const entries = parseGitStatusPorcelainEntries(output);
  if (normalizedPatterns.length === 0) {
    return entries;
  }

  return entries.filter((entry) =>
    entry.paths.some(
      (gitPath) =>
        !normalizedPatterns.some((pattern) =>
          gitPathMatchesAllowedPattern(gitPath, pattern),
        ),
    ),
  );
}

function extractAllowedPatternCandidates(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  const codeSpans = [...raw.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  if (codeSpans.length > 0) {
    return codeSpans;
  }

  return raw.split(/[,;]/);
}

function cleanAllowedFilePattern(value) {
  let pattern = String(value ?? "")
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");

  const annotationIndex = pattern.search(/\s+-\s+|\s+\(|:\s+/);
  if (annotationIndex >= 0) {
    pattern = pattern.slice(0, annotationIndex).trim();
  }

  const firstWhitespace = pattern.search(/\s/);
  if (firstWhitespace >= 0) {
    pattern = pattern.slice(0, firstWhitespace).trim();
  }

  return normalizeGitPath(pattern);
}

function cleanGitStatusPath(value) {
  return normalizeGitPath(String(value ?? "").replace(/^"|"$/g, ""));
}

function normalizeGitPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function wildcardPatternToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += escapeRegExp(char);
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
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
