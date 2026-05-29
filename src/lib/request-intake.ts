export const REQUEST_INTAKE_STORAGE_KEY =
  "azure-ai-control-plane.requestIntake";
export const MAX_REQUEST_INTAKE_RECORDS = 20;

export const REQUEST_KINDS = ["REQ", "BUG", "REF", "DOC", "OPS"] as const;
export const TASK_LEVELS = [
  "Level 0",
  "Level 1",
  "Level 2",
  "Level 3",
] as const;
export const AZURE_REFERENCE_TYPES = ["none", "pr", "work-item"] as const;

export type RequestKind = (typeof REQUEST_KINDS)[number];
export type TaskLevel = (typeof TASK_LEVELS)[number];
export type AzureReferenceType = (typeof AZURE_REFERENCE_TYPES)[number];

export type RequestIntakeForm = {
  kind: RequestKind;
  title: string;
  detail: string;
  taskLevel: TaskLevel;
  azureReferenceType: AzureReferenceType;
  azureReferenceId: string;
};

export type RequestIntakeRecord = RequestIntakeForm & {
  requestId: string;
  createdAt: string;
};

export function emptyRequestIntakeForm(): RequestIntakeForm {
  return {
    kind: "REQ",
    title: "",
    detail: "",
    taskLevel: "Level 2",
    azureReferenceType: "none",
    azureReferenceId: "",
  };
}

export function createRequestIntakeRecord(
  input: RequestIntakeForm,
  createdAt = new Date(),
): RequestIntakeRecord {
  const normalized = normalizeRequestIntakeForm(input);

  return {
    ...normalized,
    requestId: createRequestId(normalized.kind, normalized.title, createdAt),
    createdAt: createdAt.toISOString(),
  };
}

export function createRequestId(
  kind: RequestKind,
  title: string,
  createdAt = new Date(),
) {
  return `${kind}-${formatRequestTimestamp(createdAt)}-${slugifyRequestTitle(title)}`;
}

export function slugifyRequestTitle(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "request";
}

export function parseRequestIntakeRecords(
  serialized: string | null,
): RequestIntakeRecord[] {
  if (!serialized) {
    return [];
  }

  try {
    const raw = JSON.parse(serialized);
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(parseRequestIntakeRecord)
      .filter((record): record is RequestIntakeRecord => Boolean(record))
      .slice(0, MAX_REQUEST_INTAKE_RECORDS);
  } catch {
    return [];
  }
}

export function serializeRequestIntakeRecords(
  records: RequestIntakeRecord[],
) {
  return JSON.stringify(
    records
      .map((record) => parseRequestIntakeRecord(record))
      .filter((record): record is RequestIntakeRecord => Boolean(record))
      .slice(0, MAX_REQUEST_INTAKE_RECORDS),
  );
}

export function buildAgent0DispatchPrompt(record: RequestIntakeRecord) {
  const azureReference = formatAzureReference(record);
  const lines = [
    "# Agent0 Dispatch Packet",
    "",
    `Request ID: ${record.requestId}`,
    `Request kind: ${record.kind}`,
    `Task Level: ${record.taskLevel}`,
    `Title: ${record.title}`,
    `Created At: ${record.createdAt}`,
    `Optional Azure Reference: ${azureReference}`,
    "",
    "## User Request",
    "",
    record.detail,
    "",
    "## Agent 0 Startup Prompt",
    "",
    "```text",
    `You are operating on Request ID: ${record.requestId}.`,
    "You are Agent 0: Thread Dispatcher.",
    "Only use the provided handoff artifacts and confirmed sources.",
    "Do not use unrelated previous request context.",
    "The User Request is an intake source only. It is not confirmed Spec, Figma, Swagger/API, QA, or implementation scope.",
    "Do not invent missing requirements, API fields, UI behavior, QA criteria, or implementation scope.",
    "If information is missing, conflicting, or out of scope, stop and report it.",
    "Determine the next Agent thread and generate a clean startup prompt for that Agent.",
    "```",
    "",
    "## Guardrails",
    "",
    "- Treat request detail as unconfirmed intake evidence.",
    "- Do not write Azure DevOps state from this packet.",
    "- Do not create, abandon, merge, or approve Azure PRs.",
    "- Do not update Work Items, reviewers, branch policies, pipelines, or deployments.",
    "- Stop for human decision when sources conflict, scope expands, or high-risk operations are required.",
  ];

  return lines.join("\n");
}

export function formatAzureReference(record: RequestIntakeRecord) {
  if (record.azureReferenceType === "pr" && record.azureReferenceId) {
    return `Azure PR #${record.azureReferenceId}`;
  }

  if (record.azureReferenceType === "work-item" && record.azureReferenceId) {
    return `Azure 單號: ${record.azureReferenceId}`;
  }

  return "none";
}

function normalizeRequestIntakeForm(
  input: RequestIntakeForm,
): RequestIntakeForm {
  const azureReferenceType = isAzureReferenceType(input.azureReferenceType)
    ? input.azureReferenceType
    : "none";

  return {
    kind: isRequestKind(input.kind) ? input.kind : "REQ",
    title: input.title.trim(),
    detail: input.detail.trim(),
    taskLevel: isTaskLevel(input.taskLevel) ? input.taskLevel : "Level 2",
    azureReferenceType,
    azureReferenceId:
      azureReferenceType === "none" ? "" : input.azureReferenceId.trim(),
  };
}

function parseRequestIntakeRecord(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Partial<RequestIntakeRecord>;
  if (
    typeof record.requestId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.detail !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  const normalized = normalizeRequestIntakeForm({
    kind: isRequestKind(record.kind) ? record.kind : "REQ",
    title: record.title,
    detail: record.detail,
    taskLevel: isTaskLevel(record.taskLevel) ? record.taskLevel : "Level 2",
    azureReferenceType: isAzureReferenceType(record.azureReferenceType)
      ? record.azureReferenceType
      : "none",
    azureReferenceId:
      typeof record.azureReferenceId === "string"
        ? record.azureReferenceId
        : "",
  });

  if (!normalized.title || !normalized.detail) {
    return null;
  }

  return {
    ...normalized,
    requestId: record.requestId.trim(),
    createdAt: record.createdAt,
  };
}

function formatRequestTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

function isRequestKind(value: unknown): value is RequestKind {
  return REQUEST_KINDS.includes(value as RequestKind);
}

function isTaskLevel(value: unknown): value is TaskLevel {
  return TASK_LEVELS.includes(value as TaskLevel);
}

function isAzureReferenceType(value: unknown): value is AzureReferenceType {
  return AZURE_REFERENCE_TYPES.includes(value as AzureReferenceType);
}
