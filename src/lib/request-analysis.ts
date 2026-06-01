import type { AgentRole } from "@/lib/control-plane-workflow";
import type { RequestKind, TaskLevel } from "@/lib/request-intake";

export type RequestInterpretation = {
  source: "provisional" | "worker";
  title: string;
  kind: RequestKind;
  taskLevel: TaskLevel;
  summary: string;
  suggestedNextAgent: AgentRole;
  missingSources: string[];
  sourceWarnings: string[];
  riskFlags: string[];
  guardrails: string[];
  updatedAt: string;
};

type AnalyzeOptions = {
  fallbackTitle?: string;
};

const BUG_TERMS = [
  "bug",
  "error",
  "fail",
  "failed",
  "broken",
  "crash",
  "fix",
  "修",
  "錯",
  "錯誤",
  "異常",
  "失敗",
  "無法",
  "不能",
  "沒反應",
  "沒有反應",
  "壞",
];
const REF_TERMS = ["refactor", "cleanup", "重構", "整理", "抽共用", "共用"];
const DOC_TERMS = ["doc", "docs", "document", "readme", "文件", "規則", "說明"];
const HOTFIX_TERMS = [
  "hotfix",
  "hot fix",
  "production fix",
  "prod fix",
  "urgent fix",
  "emergency fix",
  "緊急修補",
  "緊急修正",
  "急修",
];
const OPS_TERMS = [
  "ci",
  "cd",
  "pipeline",
  "build",
  "deploy",
  "env",
  "pat",
  "permission",
  "azure",
  "權限",
  "環境",
  "部署",
  "管線",
];
const LEVEL_3_TERMS = [
  "auth",
  "permission",
  "router guard",
  "axios",
  "shared",
  "core",
  "ci",
  "cd",
  "pipeline",
  "deploy",
  "env",
  "install",
  "delete",
  "merge",
  "abandon",
  "large refactor",
  "權限",
  "環境",
  "部署",
  "刪除",
  "合併",
  "放棄",
  "大型",
  "重構",
  "共用",
  "核心",
];
const LEVEL_0_TERMS = [
  "typo",
  "copy",
  "label",
  "wording",
  "spacing",
  "文案",
  "錯字",
  "標籤",
  "間距",
];
const UI_TERMS = [
  "ui",
  "ux",
  "figma",
  "screen",
  "page",
  "component",
  "button",
  "modal",
  "form",
  "畫面",
  "頁面",
  "元件",
  "按鈕",
  "表單",
  "彈窗",
];
const API_TERMS = [
  "api",
  "endpoint",
  "swagger",
  "field",
  "response",
  "request",
  "enum",
  "schema",
  "欄位",
  "端點",
  "回傳",
  "請求",
];
const QA_TERMS = ["qa", "testcase", "acceptance", "驗收", "測試案例"];
const API_CONTRACT_TERMS = [
  "api",
  "endpoint",
  "swagger",
  "contract",
  "schema",
  "enum",
  "response",
  "request payload",
  "api field",
  "field mapping",
  "端點",
  "回傳",
  "api 欄位",
  "api欄位",
  "欄位確認",
  "欄位 mapping",
];
const PERMISSION_SOURCE_TERMS = [
  "auth",
  "permission",
  "role",
  "roles",
  "role mapping",
  "acl",
  "權限",
  "角色",
  "授權",
  "身分",
];
const DATA_SOURCE_TERMS = [
  "data model",
  "database",
  "db",
  "table",
  "migration",
  "persist",
  "persistence",
  "sync",
  "資料模型",
  "資料庫",
  "資料表",
  "同步",
  "持久",
  "儲存",
];
const BUSINESS_RULE_TERMS = [
  "business rule",
  "business logic",
  "spec",
  "policy",
  "compliance",
  "規格",
  "商業規則",
  "業務規則",
  "業務邏輯",
  "政策",
  "合規",
];
const CROSS_SCREEN_TERMS = [
  "workflow",
  "flow",
  "cross-screen",
  "multi-page",
  "navigation",
  "router",
  "流程",
  "跨頁",
  "導頁",
  "路由",
];
const EXPECTATION_TERMS = [
  "expected",
  "actual",
  "should",
  "預期",
  "實際",
  "目前",
  "現在",
  "應該",
  "要",
  "無法",
  "錯誤",
  "異常",
];
export const WORKER_INTERPRETATION_START_MARKER =
  "CONTROL_PLANE_INTERPRETATION_START";
export const WORKER_INTERPRETATION_END_MARKER =
  "CONTROL_PLANE_INTERPRETATION_END";

export function analyzeNaturalLanguageRequest(
  detail: string,
  options: AnalyzeOptions = {},
): RequestInterpretation {
  const normalized = detail.trim();
  if (!normalized) {
    throw new Error("Request detail is required.");
  }

  const lower = normalized.toLowerCase();
  const kind = inferKind(lower);
  const taskLevel = inferTaskLevel(lower, kind, normalized.length);
  const title = options.fallbackTitle?.trim() || inferTitle(normalized);
  const missingSources = inferMissingSources(lower, kind, normalized);
  const riskFlags = inferRiskFlags(lower);
  const sourceWarnings = [
    "User text, screenshots, and selected-repo inspection may be sufficient for low-risk bug fixes or scoped branch adjustments.",
  ];

  if (!hasAnyTerm(lower, QA_TERMS)) {
    sourceWarnings.push(
      "No QA TestCase was detected; Agent1 may define a provisional verification checklist from the observed behavior and repo tests.",
    );
  }

  return {
    source: "provisional",
    title,
    kind,
    taskLevel,
    summary: buildSummary(kind, taskLevel, riskFlags),
    suggestedNextAgent: "agent0",
    missingSources,
    sourceWarnings,
    riskFlags,
    guardrails: [
      "Do not invent API fields, permission behavior, data model changes, business rules, or expanded workflows.",
      "Agent1 may confirm low-risk bug or branch-adjustment scope from user text, screenshots, and repository inspection.",
      "Stop for source conflict, scope expansion, Azure write, worker failure, or high-risk operation.",
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeRequestInterpretation(
  value: unknown,
  options: {
    fallbackDetail?: string;
    source?: RequestInterpretation["source"];
    updatedAt?: string;
  } = {},
): RequestInterpretation {
  const record = typeof value === "object" && value !== null ? value : {};
  const partial = record as Partial<RequestInterpretation>;
  const fallback = options.fallbackDetail
    ? analyzeNaturalLanguageRequest(options.fallbackDetail)
    : defaultInterpretation();

  return {
    source:
      options.source ??
      (partial.source === "worker" ? "worker" : fallback.source),
    title: sanitizeText(partial.title) || fallback.title,
    kind: normalizeKind(partial.kind) ?? fallback.kind,
    taskLevel: normalizeTaskLevel(partial.taskLevel) ?? fallback.taskLevel,
    summary: sanitizeText(partial.summary) || fallback.summary,
    suggestedNextAgent:
      partial.suggestedNextAgent === "agent1" ||
      partial.suggestedNextAgent === "agent2" ||
      partial.suggestedNextAgent === "agent3"
        ? partial.suggestedNextAgent
        : "agent0",
    missingSources: sanitizeStringArray(partial.missingSources).length
      ? sanitizeStringArray(partial.missingSources)
      : fallback.missingSources,
    sourceWarnings: sanitizeStringArray(partial.sourceWarnings).length
      ? sanitizeStringArray(partial.sourceWarnings)
      : fallback.sourceWarnings,
    riskFlags: sanitizeStringArray(partial.riskFlags),
    guardrails: sanitizeStringArray(partial.guardrails).length
      ? sanitizeStringArray(partial.guardrails)
      : fallback.guardrails,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
}

export function extractWorkerInterpretationFromText(
  text: string,
  fallbackDetail: string,
): RequestInterpretation | null {
  const candidate =
    extractBetweenMarkers(
      text,
      WORKER_INTERPRETATION_START_MARKER,
      WORKER_INTERPRETATION_END_MARKER,
    ) ?? extractFirstJsonObject(text);

  if (!candidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate);
    const payload =
      parsed && typeof parsed === "object" && "controlPlaneInterpretation" in parsed
        ? (parsed as { controlPlaneInterpretation: unknown })
            .controlPlaneInterpretation
        : parsed;

    return normalizeRequestInterpretation(payload, {
      fallbackDetail,
      source: "worker",
    });
  } catch {
    return null;
  }
}

export function inferTitle(detail: string) {
  const firstLine = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = (firstLine || "New request")
    .replace(/\s+/g, " ")
    .replace(/^[-*#\d.\s]+/, "")
    .slice(0, 64)
    .trim();

  return title || "New request";
}

function inferKind(lower: string): RequestKind {
  if (hasAnyTerm(lower, HOTFIX_TERMS)) {
    return "HOTFIX";
  }

  if (hasAnyTerm(lower, BUG_TERMS)) {
    return "BUG";
  }

  if (hasAnyTerm(lower, REF_TERMS)) {
    return "REF";
  }

  if (hasAnyTerm(lower, DOC_TERMS)) {
    return "DOC";
  }

  if (hasAnyTerm(lower, OPS_TERMS)) {
    return "OPS";
  }

  return "REQ";
}

function normalizeKind(value: unknown): RequestKind | null {
  if (
    value === "REQ" ||
    value === "BUG" ||
    value === "HOTFIX" ||
    value === "REF" ||
    value === "DOC" ||
    value === "OPS"
  ) {
    return value;
  }

  return null;
}

function normalizeTaskLevel(value: unknown): TaskLevel | null {
  if (
    value === "Level 0" ||
    value === "Level 1" ||
    value === "Level 2" ||
    value === "Level 3"
  ) {
    return value;
  }

  return null;
}

function inferTaskLevel(
  lower: string,
  kind: RequestKind,
  detailLength: number,
): TaskLevel {
  if (hasAnyTerm(lower, LEVEL_3_TERMS)) {
    return "Level 3";
  }

  if (detailLength < 120 && hasAnyTerm(lower, LEVEL_0_TERMS)) {
    return "Level 0";
  }

  if (kind === "BUG" || kind === "HOTFIX" || detailLength < 240) {
    return "Level 1";
  }

  return "Level 2";
}

function inferMissingSources(
  lower: string,
  kind: RequestKind,
  detail: string,
) {
  const missing = new Set<string>();

  if (!hasActionableTargetAndExpectation(lower, detail)) {
    missing.add("Target surface and expected behavior");
  }

  if (hasAnyTerm(lower, API_CONTRACT_TERMS)) {
    missing.add("Swagger / API contract source");
  }

  if (hasAnyTerm(lower, PERMISSION_SOURCE_TERMS)) {
    missing.add("Permission / role mapping source");
  }

  if (hasAnyTerm(lower, DATA_SOURCE_TERMS)) {
    missing.add("Data model / persistence source");
  }

  if (hasAnyTerm(lower, BUSINESS_RULE_TERMS)) {
    missing.add("Spec / business rule confirmation");
  }

  if (hasAnyTerm(lower, CROSS_SCREEN_TERMS)) {
    missing.add("Cross-screen workflow source");
  }

  return [...missing];
}

function inferRiskFlags(lower: string) {
  const flags: string[] = [];

  if (hasAnyTerm(lower, ["merge", "abandon", "合併", "放棄"])) {
    flags.push("PR state mutation is high risk and remains human-controlled.");
  }

  if (hasAnyTerm(lower, ["deploy", "deployment", "部署"])) {
    flags.push("Deploy is outside this App's operation scope.");
  }

  if (hasAnyTerm(lower, ["branch policy", "policy", "分支政策"])) {
    flags.push("Branch policy mutation is outside MVP scope.");
  }

  if (
    hasAnyTerm(lower, ["work item", "azure boards"]) &&
    hasAnyTerm(lower, ["update", "change", "edit", "assign", "state", "改", "更新", "指派", "狀態"])
  ) {
    flags.push(
      "Work Item field mutation is blocked; only linking an existing Work Item is allowed.",
    );
  }

  if (hasAnyTerm(lower, ["install", "package", "套件", "安裝"])) {
    flags.push("Package installation requires human approval.");
  }

  return flags;
}

function buildSummary(
  kind: RequestKind,
  taskLevel: TaskLevel,
  riskFlags: string[],
) {
  if (riskFlags.length > 0 || taskLevel === "Level 3") {
    return `${kind} classified as ${taskLevel}; human attention may be required before implementation.`;
  }

  return `${kind} classified as ${taskLevel}; Agent1 should confirm scope from user evidence and repository inspection before implementation.`;
}

function hasAnyTerm(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function hasActionableTargetAndExpectation(lower: string, detail: string) {
  const normalized = detail.replace(/\s+/g, "");
  if (normalized.length < 12) {
    return false;
  }

  const hasTarget =
    hasAnyTerm(lower, UI_TERMS) ||
    hasAnyTerm(lower, API_CONTRACT_TERMS) ||
    hasAnyTerm(lower, ["branch", "file", "component", "page", "repo", "分支", "檔案", "頁面", "元件", "畫面"]);
  const hasExpectation =
    hasAnyTerm(lower, EXPECTATION_TERMS) || normalized.length >= 28;

  return hasTarget && hasExpectation;
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultInterpretation(): RequestInterpretation {
  return {
    source: "provisional",
    title: "New request",
    kind: "REQ",
    taskLevel: "Level 2",
    summary: "Request is waiting for Local Worker/Codex interpretation.",
    suggestedNextAgent: "agent0",
    missingSources: ["Target surface and expected behavior"],
    sourceWarnings: [
      "User text, screenshots, and selected-repo inspection may be sufficient for low-risk bug fixes or scoped branch adjustments.",
    ],
    riskFlags: [],
    guardrails: [
      "Agent1 may confirm low-risk bug or branch-adjustment scope from user text, screenshots, and repository inspection.",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function extractBetweenMarkers(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  return text.slice(startIndex + start.length, endIndex).trim();
}

function extractFirstJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return text.slice(first, last + 1);
}
