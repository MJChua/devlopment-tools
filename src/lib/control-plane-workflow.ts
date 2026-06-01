import {
  createRequestId,
  type AzureReferenceType,
  type RequestKind,
  type TaskLevel,
} from "./request-intake.ts";
import {
  analyzeNaturalLanguageRequest,
  normalizeRequestInterpretation,
  type RequestInterpretation,
} from "./request-analysis.ts";
import {
  normalizeRequestInputTemplateId,
  type RequestInputTemplateId,
} from "./request-templates.ts";
import {
  buildTeamPrDeliveryBranch,
  getTeamPrBranchKind,
  TEAM_PR_BASE_BRANCH,
  type TeamPrBranchKind,
} from "./test-write-policy.ts";

export const WORKFLOW_STAGES = [
  "intake",
  "dispatched",
  "source_check",
  "ready_for_implementation",
  "running",
  "review",
  "pr_ready",
  "pr_created",
  "delivered",
  "blocked",
] as const;

export const AGENT_ROLES = ["agent0", "agent1", "agent2", "agent3"] as const;
export const WORKER_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
] as const;
export const WORKER_RUN_DISPATCH_REASONS = [
  "normal",
  "auto_repair",
  "manual_retry",
  "clarification_retry",
] as const;
export const DELIVERY_MODES = ["draft_pr", "no_pr"] as const;
export const REQUEST_EVIDENCE_MODES = ["standard", "ui_only"] as const;
export const REQUEST_ATTACHMENT_PURPOSES = ["intake", "clarification"] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];
export type WorkerRunStatus = (typeof WORKER_RUN_STATUSES)[number];
export type WorkerRunDispatchReason =
  (typeof WORKER_RUN_DISPATCH_REASONS)[number];
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export type RequestEvidenceMode = (typeof REQUEST_EVIDENCE_MODES)[number];
export type RequestAttachmentPurpose =
  (typeof REQUEST_ATTACHMENT_PURPOSES)[number];
export type AzureReferenceEvidenceStatus =
  | "none"
  | "tracking"
  | "verified"
  | "unverified";
export type AzureReferenceEvidence = {
  status: AzureReferenceEvidenceStatus;
  referenceType: AzureReferenceType;
  referenceId: string;
  checkedAt: string;
  title: string;
  workItemType: string;
  workItemState: string;
  assignedTo: string;
  areaPath: string;
  iterationPath: string;
  webUrl: string;
  summary: string;
  error: string;
};
export type StageGateRecoveryKind =
  | "none"
  | "handoff_schema"
  | "agent_failed"
  | "agent_blocked"
  | "worker_runtime_error"
  | "repo_dirty_blocked"
  | "stale_run"
  | "human_decision";
export type ClarificationPromptOption = {
  id: string;
  label: string;
  description: string;
  clarification: string;
};
export type ClarificationPromptQuestion = {
  id: string;
  question: string;
  options: ClarificationPromptOption[];
};
export type ClarificationPrompt = {
  title: string;
  summary: string;
  questions: ClarificationPromptQuestion[];
};
export type RepoCandidateScanEntry = {
  label: string;
  path: string;
  reason: string;
};
export type RepoCandidateScan = {
  rootPath: string;
  apps: RepoCandidateScanEntry[];
  surfaces: RepoCandidateScanEntry[];
  warnings: string[];
};
export type WorkflowResumeSnapshot = {
  updatedAt: string;
  updatedByRunId: string;
  sourceAgentRole: AgentRole | null;
  confirmedRequirements: string[];
  confirmedScope: string[];
  allowedFiles: string[];
  nonScope: string[];
  doNotTouch: string[];
  latestBlocker: string;
  latestClarification: string;
  verificationSummary: string[];
  executionRepoPath: string;
  prDeliveryTrace: PrDeliveryTrace | null;
};
export type PrDiscoveryStatus =
  | "pending"
  | "found"
  | "not_found"
  | "ambiguous"
  | "failed";
export type PrDeliveryTrace = {
  baseBranch: string;
  sourceBranch: string;
  workItemId: string;
  branchKind: TeamPrBranchKind | "";
  discoveryStatus: PrDiscoveryStatus;
  pullRequestId?: number;
  webUrl?: string;
  reason?: string;
};
export type WorkflowAgentPacketContext = {
  repoCandidateScan?: RepoCandidateScan | null;
  resumeSnapshot?: WorkflowResumeSnapshot | null;
};

export type WorkflowRequestInput = {
  kind?: RequestKind;
  title?: string;
  detail: string;
  taskLevel?: TaskLevel;
  owner?: string;
  assignedWorkerId: string;
  repoPath?: string;
  deliveryMode?: DeliveryMode;
  evidenceMode?: RequestEvidenceMode;
  templateId?: RequestInputTemplateId;
  azureReferenceType: AzureReferenceType;
  azureReferenceId: string;
  azureReferenceEvidence?: Partial<AzureReferenceEvidence>;
  interpretation?: RequestInterpretation;
};

export type WorkflowRequest = Required<
  Omit<
    WorkflowRequestInput,
    | "kind"
    | "title"
    | "taskLevel"
    | "owner"
    | "repoPath"
    | "deliveryMode"
    | "evidenceMode"
    | "templateId"
    | "azureReferenceEvidence"
    | "interpretation"
  >
> & {
  kind: RequestKind;
  title: string;
  taskLevel: TaskLevel;
  owner: string;
  repoPath: string;
  deliveryMode: DeliveryMode;
  evidenceMode: RequestEvidenceMode;
  templateId: RequestInputTemplateId;
  azureReferenceEvidence: AzureReferenceEvidence;
  interpretation: RequestInterpretation;
  resumeSnapshot: WorkflowResumeSnapshot | null;
  requestId: string;
  status: WorkflowStage;
  createdAt: string;
  updatedAt: string;
};

export type WorkerRegistration = {
  workerId: string;
  displayName: string;
  repoPath: string;
  commandTemplate: string;
  autoCommitAndPr: boolean;
  sandboxMode: "workspace-write" | "danger-full-access";
  codexReady: boolean;
  codexStatus: "unknown" | "ready" | "missing-command" | "command-failed";
  codexError: string;
  codexDiagnosticCode:
    | "unknown"
    | "ready"
    | "missing-command"
    | "cli-missing"
    | "desktop-internal-not-cli"
    | "cli-command-failed";
  codexExecutablePath: string;
  codexCheckedAt: string | null;
  workerVersion: string;
  workerScriptHash: string;
  workerExpectedVersion: string;
  workerExpectedScriptHash: string;
  workerVersionStatus: "unknown" | "current" | "mismatch";
  launcherVersion: string;
  workerUpdatedAt: string | null;
  workerVersionCheckedAt: string | null;
  readinessCheckRequestedAt: string | null;
  codexSetupRequestedAt: string | null;
  repositoryCandidates: RepositoryCandidate[];
  repositoryCandidatesUpdatedAt: string | null;
  status: "registered" | "active" | "disabled";
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RepositoryCandidate = {
  name: string;
  path: string;
  source: string;
};

export type WorkerRegistrationWithToken = WorkerRegistration & {
  token: string;
};

export type WorkerRun = {
  runId: string;
  requestId: string;
  agentRole: AgentRole;
  workerId: string;
  repoPath: string;
  status: WorkerRunStatus;
  retryOfRunId: string;
  dispatchReason: WorkerRunDispatchReason;
  packet: string;
  commandOutput: string;
  diffSummary: string;
  artifact: string;
  error: string;
  progressLabel: string;
  progressDetail: string;
  progressUpdatedAt: string | null;
  packetSizeChars: number;
  priorHandoffCount: number;
  usedResumeSnapshot: boolean;
  isRetryContext: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  requestId: string;
  eventType: string;
  message: string;
  actor: string;
  metadata: string;
  createdAt: string;
};

export type AzurePullRequestLink = {
  id: string;
  requestId: string;
  pullRequestId: number;
  webUrl: string;
  createdAt: string;
};

export type RequestAttachment = {
  attachmentId: string;
  requestId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  purpose: RequestAttachmentPurpose;
  recoveryOfRunId: string;
  actor: string;
  createdAt: string;
};

export type WorkflowRequestDetail = {
  request: WorkflowRequest;
  runs: WorkerRun[];
  prLinks: AzurePullRequestLink[];
  auditEvents: AuditEvent[];
  attachments: RequestAttachment[];
};

export type StageGateResult = {
  status: "ready" | "blocked" | "waiting" | "human-decision";
  label: string;
  summary: string;
  blockers: string[];
  nextActions: string[];
  humanDecisions: string[];
  clarificationPrompt: ClarificationPrompt | null;
  blockedRunId: string;
  blockedAgentRole: AgentRole | null;
  recoveryKind: StageGateRecoveryKind;
  canAutoRepair: boolean;
  canManualRetry: boolean;
  needsClarification: boolean;
};

export const RUN_HEARTBEAT_STALE_MS = 10 * 60 * 1000;
export const RUN_SOFT_TIMEOUT_MS = 5 * 60 * 1000;
export const PACKET_SIZE_WARNING_CHARS = 24_000;

const HANDOFF_SECTION_MAX_CHARS = 900;
const HANDOFF_FALLBACK_MAX_CHARS = 1200;
const HANDOFF_TOTAL_MAX_CHARS = 3600;
const CLARIFICATION_PROMPT_START = "CONTROL_PLANE_CLARIFICATION_PROMPT_START";
const CLARIFICATION_PROMPT_END = "CONTROL_PLANE_CLARIFICATION_PROMPT_END";
const HANDOFF_SECTION_HEADINGS = [
  "Confirmed Requirements",
  "Confirmed Scope",
  "Allowed Files",
  "File Scope",
  "Non-Scope",
  "Do Not Touch",
  "Blocking Questions",
  "Can Proceed",
  "Task Package",
  "Implementation Result",
  "Changed Files",
  "Commands Run",
  "Verification Result",
  "Scope Compliance",
  "Review Result",
  "Unapproved Changes",
  "Regression Risk",
  "Human Decisions",
  "Blockers",
] as const;
const REQUIRED_HANDOFF_FIELDS: Partial<Record<AgentRole, string[]>> = {
  agent1: [
    "Confirmed Requirements",
    "Confirmed Scope",
    "Allowed Files",
    "Non-Scope",
    "Do Not Touch",
    "Can Proceed",
    "Task Package",
  ],
  agent2: [
    "Changed Files",
    "Commands Run",
    "Verification Result",
    "Scope Compliance",
    "Human Decisions",
  ],
  agent3: [
    "Review Result",
    "Scope Compliance",
    "Unapproved Changes",
    "Verification Result",
    "Regression Risk",
    "Human Decisions",
  ],
};
const AGENT_REPORT_TITLES: Partial<Record<AgentRole, string[]>> = {
  agent1: ["Source Check Report"],
  agent2: ["Implementation Result"],
  agent3: ["Delivery Report"],
};

export function normalizeWorkflowRequestInput(
  input: Partial<WorkflowRequestInput>,
): WorkflowRequestInput {
  const detail = requireTrimmed(input.detail, "detail");
  const azureReferenceType = normalizeAzureReferenceType(
    input.azureReferenceType,
  );
  const azureReferenceId =
    azureReferenceType === "none" ? "" : (input.azureReferenceId ?? "").trim();
  const interpretation =
    input.interpretation
      ? normalizeRequestInterpretation(input.interpretation, {
          fallbackDetail: detail,
        })
      : analyzeNaturalLanguageRequest(detail, {
          fallbackTitle: input.title,
        });

  return {
    kind: normalizeRequestKind(input.kind ?? interpretation.kind),
    title: requireOptionalTrimmed(input.title) || interpretation.title,
    detail,
    taskLevel: normalizeTaskLevel(input.taskLevel ?? interpretation.taskLevel),
    owner: requireOptionalTrimmed(input.owner) || "local-user",
    assignedWorkerId: (input.assignedWorkerId ?? "").trim(),
    repoPath: requireOptionalTrimmed(input.repoPath),
    deliveryMode: normalizeDeliveryMode(input.deliveryMode),
    evidenceMode: normalizeEvidenceMode(input.evidenceMode),
    templateId: normalizeRequestInputTemplateId(input.templateId),
    azureReferenceType,
    azureReferenceId,
    azureReferenceEvidence: normalizeAzureReferenceEvidence(
      input.azureReferenceEvidence,
      azureReferenceType,
      azureReferenceId,
    ),
    interpretation,
  };
}

export function createWorkflowRequestFromInput(
  input: WorkflowRequestInput,
  createdAt = new Date(),
): WorkflowRequest {
  const now = createdAt.toISOString();
  const interpretation =
    input.interpretation
      ? normalizeRequestInterpretation(input.interpretation, {
          fallbackDetail: input.detail,
        })
      : analyzeNaturalLanguageRequest(input.detail, {
          fallbackTitle: input.title,
        });
  const kind = normalizeRequestKind(input.kind ?? interpretation.kind);
  const title = requireOptionalTrimmed(input.title) || interpretation.title;
  const taskLevel = normalizeTaskLevel(input.taskLevel ?? interpretation.taskLevel);
  const owner = requireOptionalTrimmed(input.owner) || "local-user";
  const repoPath = requireOptionalTrimmed(input.repoPath);
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode);
  const evidenceMode = normalizeEvidenceMode(input.evidenceMode);
  const templateId = normalizeRequestInputTemplateId(input.templateId);
  const azureReferenceType = normalizeAzureReferenceType(input.azureReferenceType);
  const azureReferenceId =
    azureReferenceType === "none" ? "" : (input.azureReferenceId ?? "").trim();
  const azureReferenceEvidence = normalizeAzureReferenceEvidence(
    input.azureReferenceEvidence,
    azureReferenceType,
    azureReferenceId,
  );

  return {
    ...input,
    kind,
    title,
    taskLevel,
    owner,
    repoPath,
    deliveryMode,
    evidenceMode,
    templateId,
    azureReferenceType,
    azureReferenceId,
    azureReferenceEvidence,
    interpretation,
    resumeSnapshot: null,
    requestId: createRequestId(kind, title, createdAt),
    status: "intake",
    createdAt: now,
    updatedAt: now,
  };
}

export function getPrDeliveryTraceForRequest(
  request: Pick<
    WorkflowRequest,
    | "deliveryMode"
    | "azureReferenceType"
    | "azureReferenceId"
    | "azureReferenceEvidence"
    | "kind"
  >,
): PrDeliveryTrace {
  if (request.deliveryMode !== "draft_pr") {
    return emptyPrDeliveryTrace("PR delivery is not required for this request.");
  }

  if (
    request.azureReferenceType !== "work-item" ||
    !/^\d+$/.test(request.azureReferenceId.trim())
  ) {
    return emptyPrDeliveryTrace(
      "Draft PR delivery needs an Azure Work Item number to derive the team branch.",
    );
  }

  const workItemId = request.azureReferenceId.trim();
  if (!isVerifiedWorkItemReference(request, workItemId)) {
    return emptyPrDeliveryTrace(
      "Draft PR delivery needs a verified Azure Work Item before deriving a formal request branch.",
    );
  }

  const branchKind = getTeamPrBranchKind({
    workItemType: request.azureReferenceEvidence.workItemType,
    requestKind: request.kind,
  });
  const sourceBranch = buildTeamPrDeliveryBranch({
    workItemId,
    workItemType: request.azureReferenceEvidence.workItemType,
    requestKind: request.kind,
  });

  return {
    baseBranch: TEAM_PR_BASE_BRANCH,
    sourceBranch,
    workItemId,
    branchKind,
    discoveryStatus: "pending",
    reason:
      "Waiting for the request branch to be pushed and for Azure Repos to expose the active PR.",
  };
}

function isVerifiedWorkItemReference(
  request: Pick<
    WorkflowRequest,
    "azureReferenceType" | "azureReferenceId" | "azureReferenceEvidence"
  >,
  workItemId = request.azureReferenceId.trim(),
) {
  return (
    request.azureReferenceType === "work-item" &&
    /^\d+$/.test(workItemId) &&
    request.azureReferenceEvidence.status === "verified" &&
    request.azureReferenceEvidence.referenceType === "work-item" &&
    request.azureReferenceEvidence.referenceId.trim() === workItemId
  );
}

export function normalizePrDeliveryTrace(value: unknown): PrDeliveryTrace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<PrDeliveryTrace>;
  const baseBranch =
    requireOptionalTrimmed(input.baseBranch) || TEAM_PR_BASE_BRANCH;
  const sourceBranch = requireOptionalTrimmed(input.sourceBranch);
  const workItemId = requireOptionalTrimmed(input.workItemId);
  const branchKind =
    input.branchKind === "feature" ||
    input.branchKind === "bug" ||
    input.branchKind === "hotfix"
      ? input.branchKind
      : "";
  const discoveryStatus = normalizePrDiscoveryStatus(input.discoveryStatus);
  const pullRequestId = Number(input.pullRequestId);
  const trace: PrDeliveryTrace = {
    baseBranch,
    sourceBranch,
    workItemId,
    branchKind,
    discoveryStatus,
    reason: requireOptionalTrimmed(input.reason),
  };

  if (Number.isInteger(pullRequestId) && pullRequestId > 0) {
    trace.pullRequestId = pullRequestId;
  }

  const webUrl = requireOptionalTrimmed(input.webUrl);
  if (webUrl) {
    trace.webUrl = webUrl;
  }

  return isEmptyPrDeliveryTrace(trace) ? null : trace;
}

export function isEmptyPrDeliveryTrace(
  trace: PrDeliveryTrace | null | undefined,
) {
  return (
    !trace ||
    (!trace.sourceBranch &&
      !trace.workItemId &&
      !trace.pullRequestId &&
      !trace.webUrl &&
      !trace.reason)
  );
}

export function getNextAgentRole(
  request: WorkflowRequest,
  runs: WorkerRun[] = [],
): AgentRole | null {
  if (hasOpenRun(runs)) {
    return null;
  }

  switch (request.status) {
    case "intake":
      return "agent0";
    case "dispatched":
    case "source_check":
      return "agent1";
    case "ready_for_implementation":
      return "agent2";
    case "review":
      return "agent3";
    default:
      return null;
  }
}

export function getStageForQueuedAgent(agentRole: AgentRole): WorkflowStage {
  if (agentRole === "agent0") {
    return "dispatched";
  }

  if (agentRole === "agent1") {
    return "source_check";
  }

  if (agentRole === "agent2") {
    return "running";
  }

  return "review";
}

export function getStageAfterCompletedAgent(
  agentRole: AgentRole,
  deliveryMode: DeliveryMode = "draft_pr",
): WorkflowStage {
  if (agentRole === "agent0") {
    return "source_check";
  }

  if (agentRole === "agent1") {
    return "ready_for_implementation";
  }

  if (agentRole === "agent2") {
    return "review";
  }

  return deliveryMode === "no_pr" ? "delivered" : "pr_ready";
}

export function buildWorkflowAgentPacket(
  request: WorkflowRequest,
  agentRole: AgentRole,
  runs: WorkerRun[] = [],
  attachments: RequestAttachment[] = [],
  context: WorkflowAgentPacketContext = {},
) {
  const effectiveContext: WorkflowAgentPacketContext = {
    ...context,
    resumeSnapshot: context.resumeSnapshot ?? request.resumeSnapshot,
  };
  const sections = [
    `# ${formatAgentRole(agentRole)} Packet`,
    "",
    ...buildPacketHeader(request, agentRole),
    "",
    "## Startup Prompt",
    "",
    "```text",
    `You are operating on Request ID: ${request.requestId}.`,
    `You are ${formatAgentRole(agentRole)}.`,
    "Use only this packet, prior handoff artifacts, and confirmed sources.",
    "Do not use unrelated previous request context.",
    getAgentResponsibility(agentRole),
    "If information is missing, conflicting, or out of scope, stop and report it.",
    "```",
    "",
    ...buildResumeSnapshotSection(effectiveContext.resumeSnapshot),
    "",
    ...buildPacketBody(request, agentRole, runs, attachments, effectiveContext),
  ];

  return sections.join("\n");
}

function buildPacketHeader(request: WorkflowRequest, agentRole: AgentRole) {
  const lines = [
    `Request ID: ${request.requestId}`,
    `Request kind: ${request.kind}`,
    `Task Level: ${request.taskLevel}`,
    `Recommended Agent: ${formatAgentRole(agentRole)}`,
    `Delivery Mode: ${formatDeliveryMode(request.deliveryMode)}`,
    `Evidence Mode: ${formatEvidenceMode(request.evidenceMode)}`,
    `Input Template: ${request.templateId}`,
    `Azure Reference: ${formatWorkflowAzureReference(request)}`,
    `Execution Repo: ${request.repoPath || "(not selected)"}`,
  ];

  if (agentRole === "agent0" || agentRole === "agent1") {
    lines.push(`Interpretation Source: ${request.interpretation.source}`);
    lines.push(`Interpretation Summary: ${request.interpretation.summary}`);
  }

  if (agentRole === "agent1") {
    lines.push("Source strictness: contextual");
  }

  if (request.deliveryMode === "draft_pr") {
    const trace = getPrDeliveryTraceForRequest(request);
    lines.push(`PR Delivery Base Branch: ${trace.baseBranch}`);
    lines.push(`PR Delivery Source Branch: ${trace.sourceBranch || "(pending work item)"}`);
    lines.push(`PR Delivery Work Item: ${trace.workItemId || "(not available)"}`);
    lines.push(`PR Delivery Branch Kind: ${trace.branchKind || "(not available)"}`);
    lines.push(`PR Discovery Status: ${trace.discoveryStatus}`);
  }

  return lines;
}

function buildPacketBody(
  request: WorkflowRequest,
  agentRole: AgentRole,
  runs: WorkerRun[],
  attachments: RequestAttachment[],
  context: WorkflowAgentPacketContext,
) {
  if (agentRole === "agent0") {
    return buildAgent0PacketBody(request, attachments);
  }

  if (agentRole === "agent1") {
    return buildAgent1PacketBody(request, runs, attachments, context);
  }

  if (agentRole === "agent2") {
    return buildAgent2PacketBody(request, runs);
  }

  return buildAgent3PacketBody(request, runs);
}

function buildAgent0PacketBody(
  request: WorkflowRequest,
  attachments: RequestAttachment[],
) {
  return [
    "## User Request",
    "",
    request.detail,
    "",
    ...buildUserAttachmentsSection(attachments, request.evidenceMode),
    "",
    ...buildAzureReferenceEvidenceSection(request),
    "",
    ...buildVisualEvidenceModeSection(request),
    "",
    "## Output",
    "",
    "Return the next Agent startup prompt and the machine-readable interpretation block below.",
    "",
    WORKER_INTERPRETATION_OUTPUT_TEMPLATE,
    "",
    "## Rules",
    "",
    request.evidenceMode === "ui_only"
      ? "- User text and screenshots are limited visual evidence only; do not expand them into API, permission, data-model, persistence, or business-rule requirements."
      : "- User request text and screenshots are intake evidence for Agent1 to validate with repository inspection.",
    "- Do not confirm Spec, API, Figma, QA, or implementation scope.",
    "- Do not write Azure or local repository state.",
  ];
}

function buildAgent1PacketBody(
  request: WorkflowRequest,
  runs: WorkerRun[],
  attachments: RequestAttachment[],
  context: WorkflowAgentPacketContext,
) {
  return [
    ...buildPriorArtifactsSection(runs, ["agent0"]),
    "",
    "## User Request",
    "",
    request.detail,
    "",
    ...buildUserAttachmentsSection(attachments, request.evidenceMode),
    "",
    ...buildAzureReferenceEvidenceSection(request),
    "",
    ...buildVisualEvidenceModeSection(request),
    "",
    "## Source Signals To Confirm",
    "",
    ...formatListOrNone(request.interpretation.missingSources),
    "",
    "## Intake Warnings",
    "",
    ...formatListOrNone(request.interpretation.sourceWarnings),
    "",
    ...buildRepoCandidateScanSection(context.repoCandidateScan),
    "",
    "## Output",
    "",
    "Return a Source Check Report using this exact compact schema:",
    "",
    "```markdown",
    "# Source Check Report",
    "## Confirmed Requirements",
    "- List requirements verified from user text, screenshots, repository inspection, or confirmed external sources.",
    "## Confirmed Scope",
    "- List the behavior or code areas that are in scope.",
    "## Allowed Files",
    "- List file paths or path patterns Agent2 may add, delete, or modify.",
    "## Non-Scope",
    "- List related work that must not be included.",
    "## Do Not Touch",
    "- List protected files, shared modules, env/config, generated files, or unknown areas.",
    "## Blocking Questions",
    "- List missing or conflicting source evidence; do not list missing Figma/spec/Swagger/QA as blockers unless the risk rules below require external confirmation.",
    "## Can Proceed",
    "yes/no",
    "## Task Package For Agent2",
    "- If Can Proceed is yes, provide the minimum implementation steps, verification commands, and file boundaries.",
    "- If Can Proceed is no, write 'blocked' and explain the blocker.",
    "```",
    "",
    "When Can Proceed is no only because multiple concrete repo candidates or placement choices are plausible, append this exact machine-readable block after the report:",
    "",
    CLARIFICATION_PROMPT_START,
    "{",
    '  "title": "短標題，例如：選擇目標子專案",',
    '  "summary": "白話說明為什麼需要使用者選擇。",',
    '  "questions": [',
    "    {",
    '      "id": "target_surface",',
    '      "question": "要改哪個子專案、頁面或元件？",',
    '      "options": [',
    '        { "id": "admin-agent", "label": "admin-agent", "description": "apps/admin-agent-web / AgentTopBar", "clarification": "目標子專案：apps/admin-agent-web；目標元件：AgentTopBar。" },',
    '        { "id": "admin-hq", "label": "admin-hq", "description": "apps/admin-hq-web / HqTopBar", "clarification": "目標子專案：apps/admin-hq-web；目標元件：HqTopBar。" }',
    "      ]",
    "    }",
    "  ]",
    "}",
    CLARIFICATION_PROMPT_END,
    "",
    "## Rules",
    "",
    "- User text, screenshots, and selected-repo inspection can be sufficient evidence for low-risk bug fixes, UI corrections, and scoped branch adjustments when they define the target surface, observed problem or current state, expected result, and allowed scope.",
    "- Do not block solely because there is no new Figma, formal spec, Swagger, or QA TestCase.",
    "- Before blocking for an unclear target, inspect selected-repo project docs, app folders, routes, pages, and likely components to find concrete candidates.",
    "- Use repository inspection to confirm existing code ownership, affected files, and current behavior before defining Agent2's allowed file scope.",
    "- If repository inspection finds exactly one reasonable low-risk target, fill Confirmed Requirements, Confirmed Scope, Allowed Files, Non-Scope, and Do Not Touch instead of blocking.",
    "- If repository inspection finds multiple plausible targets, do not say only 'target unclear'. Name each candidate, explain why it is plausible, and provide the structured clarification block above.",
    "- If placement is ambiguous, state the concrete choices in Blocking Questions, such as whether new text should appear after the logout button or before it while logout remains the final control.",
    "- Require external confirmed source only for new or changed API fields/contracts, permission or role mapping, data model or persistence, business rules, analytics, cross-screen workflow, package installation, Azure writes, merge, deploy, or scope expansion.",
    ...(request.evidenceMode === "ui_only"
      ? [
          "- This legacy UI-only marker narrows scope further to copy, color, spacing, placement, and simple visual state changes.",
        ]
      : []),
    "- Stop on unclear target or expected result, missing critical external source under the risk rules above, source conflict, or scope expansion.",
    "- Do not invent requirements, API fields, UI behavior, QA criteria, or implementation scope.",
  ];
}

function buildUserAttachmentsSection(
  attachments: RequestAttachment[],
  evidenceMode: RequestEvidenceMode,
) {
  const intakeAttachments = attachments.filter(
    (attachment) => attachment.purpose === "intake",
  );

  if (intakeAttachments.length === 0) {
    return [
      "## User Attachments",
      "",
      "- none",
    ];
  }

  return [
    "## User Attachments",
    "",
    evidenceMode === "ui_only"
      ? "- These files are limited visual evidence for UI-only copy, color, spacing, placement, and simple visual states. They do not confirm API, permissions, data model, persistence, or business rules."
      : "- These files are user-provided intake evidence. Agent1 may use screenshots to confirm observed UI state and expected result for low-risk scoped fixes, but they do not confirm API, permissions, data model, persistence, or business rules.",
    ...intakeAttachments.map(
      (attachment) =>
        `- ${attachment.filename} (${attachment.contentType}, ${attachment.sizeBytes} bytes): ${attachment.storagePath}`,
    ),
  ];
}

function buildAzureReferenceEvidenceSection(request: WorkflowRequest) {
  if (
    request.azureReferenceType === "none" ||
    !request.azureReferenceId.trim()
  ) {
    return [
      "## Azure Reference Status",
      "",
      "- none",
    ];
  }

  const evidence = normalizeAzureReferenceEvidence(
    request.azureReferenceEvidence,
    request.azureReferenceType,
    request.azureReferenceId,
  );

  if (
    request.azureReferenceType === "work-item" &&
    evidence.status === "verified"
  ) {
    return [
      "## Verified Azure Work Item Evidence",
      "",
      "- Status: verified from Azure Work Item read before dispatch.",
      `- Work Item: #${evidence.referenceId}`,
      evidence.title ? `- Title: ${evidence.title}` : "- Title: not provided",
      evidence.workItemType
        ? `- Type: ${evidence.workItemType}`
        : "- Type: not provided",
      evidence.workItemState
        ? `- State: ${evidence.workItemState}`
        : "- State: not provided",
      evidence.assignedTo
        ? `- Assigned To: ${evidence.assignedTo}`
        : "- Assigned To: not provided",
      evidence.iterationPath
        ? `- Iteration Path: ${evidence.iterationPath}`
        : "- Iteration Path: not provided",
      evidence.webUrl ? `- URL: ${evidence.webUrl}` : "- URL: not provided",
      evidence.checkedAt
        ? `- Checked At: ${evidence.checkedAt}`
        : "- Checked At: not provided",
      "",
      "Evidence rule: use this snapshot only for fields explicitly present above; it does not confirm unstated UI, API, permission, or business-rule behavior.",
    ];
  }

  const statusLabel =
    evidence.status === "unverified"
      ? "Unverified reference"
      : "Tracking reference only";

  return [
    "## Azure Reference Status",
    "",
    `- Status: ${statusLabel}.`,
    `- Reference: ${formatWorkflowAzureReference(request)}`,
    evidence.error ? `- Read error: ${evidence.error}` : "",
    "- Rule: do not treat this ID as a confirmed source until the App provides Verified Azure Work Item Evidence.",
  ].filter(Boolean);
}

function buildVisualEvidenceModeSection(request: WorkflowRequest) {
  if (request.evidenceMode !== "ui_only") {
    return [];
  }

  return [
    "## UI-only Visual Evidence Mode",
    "",
    "- This request is marked as a small UI / visual correction.",
    "- User text and screenshots may confirm copy, color, spacing, placement, and simple visual state expectations.",
    "- This mode does not confirm API behavior, permissions, data model, persistence, business rules, analytics, or cross-screen workflow changes.",
    "- Keep Agent2 scope limited to UI files and focused tests unless verified sources explicitly expand it.",
  ];
}

function buildRepoCandidateScanSection(scan: RepoCandidateScan | null | undefined) {
  if (!scan) {
    return [
      "## Pre-Scanned Repo Candidates",
      "",
      "- Not available. Agent1 must inspect the selected repository before blocking on target ambiguity.",
    ];
  }

  return [
    "## Pre-Scanned Repo Candidates",
    "",
    "- These candidates were produced by deterministic repo scanning before Agent1 started.",
    "- Treat them as navigation hints only; they are not confirmed requirements and do not replace source/scope checks.",
    `- Repo root: ${scan.rootPath}`,
    "",
    "### App Candidates",
    ...formatRepoCandidateEntries(scan.apps),
    "",
    "### Header / Topbar / Route Candidates",
    ...formatRepoCandidateEntries(scan.surfaces),
    ...(scan.warnings.length > 0
      ? ["", "### Scan Warnings", ...formatListOrNone(scan.warnings)]
      : []),
  ];
}

function formatRepoCandidateEntries(entries: RepoCandidateScanEntry[]) {
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map(
    (entry) => `- ${entry.label}: ${entry.path} (${entry.reason})`,
  );
}

function buildAgent2PacketBody(
  request: WorkflowRequest,
  runs: WorkerRun[],
) {
  const hasSourceCheck = hasCompletedArtifact(runs, "agent1");

  return [
    ...buildPriorArtifactsSection(runs, ["agent1"]),
    "",
    ...(hasSourceCheck
      ? []
      : [
          "## Fallback User Request",
          "",
          request.detail,
          "",
          "User request is intake evidence only; stop if Source Check Report is missing or incomplete.",
          "",
    ]),
    "## Output",
    "",
    "Return an Implementation Result using this exact compact schema:",
    "",
    "```markdown",
    "# Implementation Result",
    "## Changed Files",
    "- List each changed file and why it was in the allowed scope.",
    "## Commands Run",
    "- List verification commands and outcomes.",
    "## Verification Result",
    "- pass/fail/not-run with reason.",
    "## Scope Compliance",
    "- Confirm no file was added, deleted, or modified outside Agent1's allowed files; otherwise mark blocked.",
    "## Human Decisions",
    "- List any required human approval or '- none'.",
    "```",
    "",
    "## Delivery Mode",
    "",
    formatDeliveryModeGuidance(request.deliveryMode),
    "",
    "## Verification Strategy",
    "",
    ...buildAgent2VerificationStrategy(request),
    "",
    "## Rules",
    "",
    "- Implement only confirmed scope from Source Check Report / Task Package; do not add, delete, or modify files outside that scope.",
    "- Stop before env changes, package installation, deployment, file deletion, large refactor, or shared core module modification.",
    "- When draft PR delivery is enabled, leave Azure PR creation/tracking to the App and Local Worker branch flow; do not call Azure PR create APIs yourself.",
    "- Azure writes require human approval in the control plane.",
  ];
}

function buildAgent3PacketBody(
  request: WorkflowRequest,
  runs: WorkerRun[],
) {
  const hasReviewInputs =
    hasCompletedArtifact(runs, "agent1") && hasCompletedArtifact(runs, "agent2");

  return [
    ...buildPriorArtifactsSection(runs, ["agent1", "agent2"]),
    "",
    ...(hasReviewInputs
      ? []
      : [
          "## Fallback User Request",
          "",
          request.detail,
          "",
          "User request is intake evidence only; stop if Source Check Report or Implementation Result is missing.",
          "",
    ]),
    "## Output",
    "",
    "Return a Delivery Report using this exact compact schema:",
    "",
    "```markdown",
    "# Delivery Report",
    "## Review Result",
    "- pass/fail/block with reason.",
    "## Scope Compliance",
    "- Confirm Agent2 stayed within Agent1's allowed files and non-scope.",
    "## Unapproved Changes",
    "- List unapproved file creation, deletion, unrelated modification, or '- none'.",
    "## Verification Result",
    "- Commands reviewed and outcome.",
    "## Regression Risk",
    "- Risk summary and missing tests.",
    "## Human Decisions",
    "- Required approvals or '- none'.",
    "```",
    "",
    "## Delivery Mode",
    "",
    formatDeliveryModeGuidance(request.deliveryMode),
    "",
    "## Review Strategy",
    "",
    ...buildAgent3ReviewStrategy(request),
    "",
    "## Rules",
    "",
    "- Review against confirmed sources, scope, implementation result, diff, and verification evidence.",
    "- Flag unapproved file creation, file deletion, unrelated modification, or scope expansion as blockers.",
    "- Do not justify out-of-scope changes or mark provisional checks as QA-confirmed.",
    "- Confirm the request branch is clean and scoped; Azure PR creation/tracking is handled by the App after PR Ready.",
    "- Merge PR, abandon PR, branch policy, build trigger, deploy, and Work Item field mutation are out of MVP scope.",
  ];
}

function buildAgent2VerificationStrategy(request: WorkflowRequest) {
  if (isLowRiskLevelOneRequest(request)) {
    return [
      "- This is a Level 1 request with no risk flags. For low-risk UI/copy/localized visual changes, prefer scoped verification over full app verification.",
      "- Run the most specific changed-file or component test available, plus formatting checks for touched hand-written files.",
      "- Run i18n parity checks only when locale files change.",
      "- Do not run broad `pnpm verify:*` by default for app-local UI/copy changes.",
      "- Escalate to the relevant full `pnpm verify:*` only if the diff touches shared packages, package/env/config files, API clients/contracts, permission/auth/data/business-rule code, generated outputs, or cross-page workflow behavior.",
    ];
  }

  return [
    "- Use the verification commands required by Agent1's Task Package and the repo rules.",
    "- For API, permissions, data model, shared packages, env/config, package manifests, generated files, or high-risk workflow changes, run the relevant full `pnpm verify:*` gate before handoff.",
  ];
}

function buildAgent3ReviewStrategy(request: WorkflowRequest) {
  if (isLowRiskLevelOneRequest(request)) {
    return [
      "- Prefer trusting Agent2's `Commands Run` and `Verification Result` when they are present, passing, and match the changed files.",
      "- Do not rerun full `pnpm verify:*` by default for low-risk UI/copy changes.",
      "- Review diff scope, Agent1 Allowed Files / Non-Scope / Do Not Touch, unrelated dirty changes, and PR branch cleanliness.",
      "- Rerun scoped verification only when Agent2 evidence is missing, failed, mismatched with the diff, or the diff expands into shared/package/env/API/permission/data/business-rule/high-risk areas.",
    ];
  }

  return [
    "- Review Agent2's verification evidence first, then rerun targeted or full verification only when the evidence is missing, failed, or insufficient for the risk level.",
    "- For high-risk changes, require the relevant full verification gate or block delivery with a clear reason.",
  ];
}

function isLowRiskLevelOneRequest(request: WorkflowRequest) {
  return request.taskLevel === "Level 1" && request.interpretation.riskFlags.length === 0;
}

function buildPriorArtifactsSection(
  runs: WorkerRun[],
  agentRoles: AgentRole[],
) {
  const artifacts = getEffectivePriorHandoffRuns(runs, agentRoles).map(
    buildPriorHandoffSummary,
  );

  return [
    "## Prior Handoff Summary",
    "",
    artifacts.join("\n\n") || "No relevant prior handoff summary.",
  ];
}

export function getPriorHandoffRunsForAgent(
  agentRole: AgentRole,
  runs: WorkerRun[],
) {
  if (agentRole === "agent1") {
    return getEffectivePriorHandoffRuns(runs, ["agent0"]);
  }

  if (agentRole === "agent2") {
    return getEffectivePriorHandoffRuns(runs, ["agent1"]);
  }

  if (agentRole === "agent3") {
    return getEffectivePriorHandoffRuns(runs, ["agent1", "agent2"]);
  }

  return [];
}

function getEffectivePriorHandoffRuns(
  runs: WorkerRun[],
  agentRoles: AgentRole[],
) {
  const supersededRunIds = new Set(
    runs
      .map((run) => run.retryOfRunId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  const selected = new Map<AgentRole, WorkerRun>();

  for (const run of [...runs].reverse()) {
    if (!agentRoles.includes(run.agentRole)) {
      continue;
    }

    if (selected.has(run.agentRole)) {
      continue;
    }

    if (
      run.status === "completed" &&
      run.artifact.trim() &&
      !supersededRunIds.has(run.runId)
    ) {
      selected.set(run.agentRole, run);
    }
  }

  return agentRoles
    .map((agentRole) => selected.get(agentRole))
    .filter((run): run is WorkerRun => Boolean(run));
}

function buildResumeSnapshotSection(
  snapshot: WorkflowResumeSnapshot | null | undefined,
) {
  if (!snapshot || isEmptyResumeSnapshot(snapshot)) {
    return [];
  }

  return [
    "## Request Resume Snapshot",
    "",
    "- Server-maintained compact continuation state for this request.",
    "- Use it as orientation only; it does not replace required Agent handoff contracts below.",
    `- Updated At: ${snapshot.updatedAt || "unknown"}`,
    snapshot.updatedByRunId
      ? `- Updated By Run: ${snapshot.updatedByRunId}`
      : "- Updated By Run: unknown",
    snapshot.sourceAgentRole
      ? `- Source Agent: ${formatAgentRole(snapshot.sourceAgentRole)}`
      : "- Source Agent: none",
    snapshot.executionRepoPath
      ? `- Execution Repo / Worktree: ${snapshot.executionRepoPath}`
      : "- Execution Repo / Worktree: not recorded",
    snapshot.prDeliveryTrace
      ? `- PR Delivery: ${formatPrDeliveryTrace(snapshot.prDeliveryTrace)}`
      : "- PR Delivery: not recorded",
    "",
    "### Confirmed Requirements",
    ...formatListOrNone(snapshot.confirmedRequirements),
    "",
    "### Confirmed Scope",
    ...formatListOrNone(snapshot.confirmedScope),
    "",
    "### Allowed Files",
    ...formatListOrNone(snapshot.allowedFiles),
    "",
    "### Non-Scope",
    ...formatListOrNone(snapshot.nonScope),
    "",
    "### Do Not Touch",
    ...formatListOrNone(snapshot.doNotTouch),
    "",
    "### Verification Summary",
    ...formatListOrNone(snapshot.verificationSummary),
    "",
    "### Latest Blocker",
    snapshot.latestBlocker ? `- ${snapshot.latestBlocker}` : "- none",
    "",
    "### Latest Clarification",
    snapshot.latestClarification ? `- ${snapshot.latestClarification}` : "- none",
  ];
}

function buildPriorHandoffSummary(run: WorkerRun) {
  const artifact = run.artifact.trim();
  const title = extractArtifactTitle(artifact);
  const sections = extractHandoffSections(artifact);
  const missingRequiredFields = getMissingRequiredHandoffFieldsForSections(
    run.agentRole,
    sections,
  );
  const lines = [
    `### ${formatAgentRole(run.agentRole)} Handoff Summary (${run.completedAt ?? run.updatedAt})`,
    `Source run: ${run.runId}`,
    `Artifact size: ${artifact.length} chars; package includes compact handoff fields only.`,
  ];

  if (title) {
    lines.push(`Artifact title: ${title}`);
  }

  if (sections.length > 0) {
    if (missingRequiredFields.length > 0) {
      lines.push(
        "",
        `Missing required handoff fields: ${missingRequiredFields.join(", ")}. Treat this handoff as incomplete and stop before implementation or delivery if those fields are needed.`,
      );
    }
    lines.push("", ...formatHandoffSections(sections));
  } else {
    lines.push(
      "",
      "Structured handoff fields were not found; treat this as incomplete and stop if required scope evidence is missing.",
      "",
      clipHandoffText(artifact, HANDOFF_FALLBACK_MAX_CHARS),
    );
  }

  return clipHandoffText(lines.join("\n"), HANDOFF_TOTAL_MAX_CHARS);
}

export function getMissingRequiredAgentHandoffFields(
  agentRole: AgentRole,
  artifact: string,
) {
  const requiredFields = REQUIRED_HANDOFF_FIELDS[agentRole] ?? [];
  if (requiredFields.length === 0) {
    return [];
  }

  return getMissingRequiredHandoffFieldsForSections(
    agentRole,
    extractHandoffSections(artifact.trim()),
  );
}

export function getAgentHandoffBlocker(
  agentRole: AgentRole,
  artifact: string,
) {
  const sections = extractHandoffSections(artifact.trim());

  if (agentRole === "agent3") {
    return getAgent3DeliveryBlocker(sections);
  }

  if (agentRole !== "agent1") {
    return "";
  }

  const canProceed = getHandoffSectionContent(sections, "Can Proceed");
  if (!canProceed || /^yes\b/i.test(canProceed.trim())) {
    return "";
  }

  const summary = [
    getHandoffSectionContent(sections, "Blocking Questions"),
    getHandoffSectionContent(sections, "Task Package"),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  return `Agent1 source check cannot proceed: ${clipHandoffText(summary || canProceed, 900)}`;
}

function getAgent3DeliveryBlocker(
  sections: Array<{ heading: string; content: string }>,
) {
  const reviewResult = getHandoffSectionContent(sections, "Review Result");
  const normalized = reviewResult
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s+/, "");
  if (!normalized || /^pass\b/.test(normalized)) {
    return "";
  }

  if (/^(block|blocked|fail|failed)\b/.test(normalized)) {
    const summary = [
      reviewResult,
      getHandoffSectionContent(sections, "Unapproved Changes"),
      getHandoffSectionContent(sections, "Human Decisions"),
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
    return `Agent3 delivery review blocked PR readiness: ${clipHandoffText(summary, 900)}`;
  }

  return "";
}

export function normalizeWorkflowResumeSnapshot(
  value: unknown,
): WorkflowResumeSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<WorkflowResumeSnapshot>;
  const snapshot: WorkflowResumeSnapshot = {
    updatedAt: requireOptionalTrimmed(input.updatedAt),
    updatedByRunId: requireOptionalTrimmed(input.updatedByRunId),
    sourceAgentRole: isAgentRole(input.sourceAgentRole)
      ? input.sourceAgentRole
      : null,
    confirmedRequirements: normalizeSnapshotList(input.confirmedRequirements),
    confirmedScope: normalizeSnapshotList(input.confirmedScope),
    allowedFiles: normalizeSnapshotList(input.allowedFiles),
    nonScope: normalizeSnapshotList(input.nonScope),
    doNotTouch: normalizeSnapshotList(input.doNotTouch),
    latestBlocker: requireOptionalTrimmed(input.latestBlocker),
    latestClarification: requireOptionalTrimmed(input.latestClarification),
    verificationSummary: normalizeSnapshotList(input.verificationSummary),
    executionRepoPath: requireOptionalTrimmed(input.executionRepoPath),
    prDeliveryTrace: normalizePrDeliveryTrace(input.prDeliveryTrace),
  };

  return isEmptyResumeSnapshot(snapshot) ? null : snapshot;
}

export function isEmptyResumeSnapshot(
  snapshot: WorkflowResumeSnapshot | null | undefined,
) {
  if (!snapshot) {
    return true;
  }

  return (
    snapshot.confirmedRequirements.length === 0 &&
    snapshot.confirmedScope.length === 0 &&
    snapshot.allowedFiles.length === 0 &&
    snapshot.nonScope.length === 0 &&
    snapshot.doNotTouch.length === 0 &&
    snapshot.verificationSummary.length === 0 &&
    !snapshot.latestBlocker &&
    !snapshot.latestClarification &&
    !snapshot.executionRepoPath &&
    isEmptyPrDeliveryTrace(snapshot.prDeliveryTrace)
  );
}

export function buildResumeSnapshotAfterRun(input: {
  current: WorkflowResumeSnapshot | null | undefined;
  run: Pick<WorkerRun, "runId" | "agentRole" | "repoPath">;
  status: Exclude<WorkerRunStatus, "queued" | "running">;
  artifact: string;
  error: string;
  updatedAt: string;
}) {
  const sections = extractHandoffSections(input.artifact);
  const next = normalizeWorkflowResumeSnapshot(input.current) ?? emptyResumeSnapshot();

  next.updatedAt = input.updatedAt;
  next.updatedByRunId = input.run.runId;
  next.sourceAgentRole = input.run.agentRole;
  next.executionRepoPath = input.run.repoPath || next.executionRepoPath;
  next.latestBlocker =
    input.status === "completed"
      ? ""
      : input.error || summarizeBlockingSections(sections);

  if (input.run.agentRole === "agent1") {
    next.confirmedRequirements = snapshotSectionList(
      sections,
      "Confirmed Requirements",
    );
    next.confirmedScope = snapshotSectionList(sections, "Confirmed Scope");
    next.allowedFiles = snapshotSectionList(sections, "Allowed Files");
    next.nonScope = snapshotSectionList(sections, "Non-Scope");
    next.doNotTouch = snapshotSectionList(sections, "Do Not Touch");
  }

  if (input.run.agentRole === "agent2" || input.run.agentRole === "agent3") {
    next.verificationSummary = normalizeSnapshotList([
      ...snapshotSectionList(sections, "Commands Run"),
      ...snapshotSectionList(sections, "Verification Result"),
      ...snapshotSectionList(sections, "Review Result"),
    ]);
  }

  return isEmptyResumeSnapshot(next) ? null : next;
}

function emptyResumeSnapshot(): WorkflowResumeSnapshot {
  return {
    updatedAt: "",
    updatedByRunId: "",
    sourceAgentRole: null,
    confirmedRequirements: [],
    confirmedScope: [],
    allowedFiles: [],
    nonScope: [],
    doNotTouch: [],
    latestBlocker: "",
    latestClarification: "",
    verificationSummary: [],
    executionRepoPath: "",
    prDeliveryTrace: null,
  };
}

function emptyPrDeliveryTrace(reason: string): PrDeliveryTrace {
  return {
    baseBranch: TEAM_PR_BASE_BRANCH,
    sourceBranch: "",
    workItemId: "",
    branchKind: "",
    discoveryStatus: "pending",
    reason,
  };
}

function normalizePrDiscoveryStatus(value: unknown): PrDiscoveryStatus {
  return value === "found" ||
    value === "not_found" ||
    value === "ambiguous" ||
    value === "failed"
    ? value
    : "pending";
}

function formatPrDeliveryTrace(trace: PrDeliveryTrace) {
  const branchPair = trace.sourceBranch
    ? `${trace.sourceBranch} -> ${trace.baseBranch || TEAM_PR_BASE_BRANCH}`
    : `source pending -> ${trace.baseBranch || TEAM_PR_BASE_BRANCH}`;
  const pr = trace.pullRequestId ? `, PR #${trace.pullRequestId}` : "";
  const reason = trace.reason ? ` (${trace.reason})` : "";
  return `${trace.discoveryStatus}: ${branchPair}${pr}${reason}`;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && AGENT_ROLES.includes(value as AgentRole);
}

function normalizeSnapshotList(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? "").split(/\r?\n/))
    .map((item) => item.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .filter((item) => !/^none\.?$/i.test(item))
    .slice(0, 24);
}

function snapshotSectionList(
  sections: Array<{ heading: string; content: string }>,
  heading: string,
) {
  return normalizeSnapshotList(getHandoffSectionContent(sections, heading));
}

function summarizeBlockingSections(
  sections: Array<{ heading: string; content: string }>,
) {
  return (
    getHandoffSectionContent(sections, "Blocking Questions") ||
    getHandoffSectionContent(sections, "Review Result") ||
    getHandoffSectionContent(sections, "Blockers")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export function extractClarificationPromptFromArtifact(
  artifact: string,
): ClarificationPrompt | null {
  const match = artifact.match(
    new RegExp(
      `${CLARIFICATION_PROMPT_START}\\s*([\\s\\S]*?)\\s*${CLARIFICATION_PROMPT_END}`,
      "i",
    ),
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    return normalizeClarificationPrompt(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

function normalizeClarificationPrompt(value: unknown): ClarificationPrompt | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawQuestions = Array.isArray(value.questions)
    ? value.questions
    : value.question && Array.isArray(value.options)
      ? [value]
      : [];
  const questions = rawQuestions
    .map(normalizeClarificationQuestion)
    .filter((question): question is ClarificationPromptQuestion =>
      Boolean(question),
    )
    .slice(0, 3);

  if (questions.length === 0) {
    return null;
  }

  return {
    title: normalizePromptString(value.title, 80) || "需要快速確認",
    summary: normalizePromptText(value.summary, 240),
    questions,
  };
}

function normalizeClarificationQuestion(
  value: unknown,
  questionIndex: number,
): ClarificationPromptQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const question = normalizePromptString(value.question, 160);
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const options = rawOptions
    .map((option, optionIndex) =>
      normalizeClarificationOption(option, question, optionIndex),
    )
    .filter((option): option is ClarificationPromptOption => Boolean(option))
    .slice(0, 6);

  if (!question || options.length < 2) {
    return null;
  }

  const fallbackId = `question-${questionIndex + 1}`;
  return {
    id:
      normalizePromptId(value.id) ||
      normalizePromptId(question) ||
      fallbackId,
    question,
    options,
  };
}

function normalizeClarificationOption(
  value: unknown,
  question: string,
  optionIndex: number,
): ClarificationPromptOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = normalizePromptString(value.label, 80);
  if (!label) {
    return null;
  }

  const description = normalizePromptText(value.description, 180);
  const clarification =
    normalizePromptText(value.clarification, 260) ||
    `${question}: ${label}${description ? ` (${description})` : ""}`;

  return {
    id:
      normalizePromptId(value.id) ||
      normalizePromptId(label) ||
      `option-${optionIndex + 1}`,
    label,
    description,
    clarification,
  };
}

function normalizePromptString(value: unknown, maxChars: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxChars).trim();
}

function normalizePromptText(value: unknown, maxChars: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n/g, "\n").trim().slice(0, maxChars).trim();
}

function normalizePromptId(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeStructuredAgentReport(
  agentRole: AgentRole,
  artifact: string,
  commandOutput: string,
) {
  const normalizedArtifact = artifact.trim();
  const report = extractStructuredAgentReport(agentRole, commandOutput);
  if (!report) {
    return normalizedArtifact;
  }

  if (normalizedArtifact.includes(report)) {
    return normalizedArtifact;
  }

  if (!normalizedArtifact) {
    return report;
  }

  return [
    report,
    "",
    "## Worker Execution Summary",
    "",
    normalizedArtifact,
  ].join("\n");
}

export function extractStructuredAgentReport(
  agentRole: AgentRole,
  text: string,
) {
  const titles = AGENT_REPORT_TITLES[agentRole] ?? [];
  if (titles.length === 0 || !text.trim()) {
    return "";
  }

  const titleSet = new Set(titles.map(normalizeHandoffHeading));
  const matches = [...text.matchAll(/^#\s+(.+?)\s*$/gm)].filter((match) =>
    titleSet.has(normalizeHandoffHeading(match[1] ?? "")),
  );
  const match = matches.at(-1);
  if (!match || match.index === undefined) {
    return "";
  }

  const nextTopLevelHeading = text
    .slice(match.index + match[0].length)
    .search(/^#\s+.+?\s*$/m);
  const end =
    nextTopLevelHeading >= 0
      ? match.index + match[0].length + nextTopLevelHeading
      : text.length;

  return text.slice(match.index, end).trim();
}

function extractArtifactTitle(artifact: string) {
  const match = artifact.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() ?? "";
}

function extractHandoffSections(artifact: string) {
  const headingMatches = [...artifact.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)];
  const sections: Array<{ heading: string; content: string }> = [];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index];
    const heading = match[1]?.trim() ?? "";
    if (!isHandoffHeading(heading)) {
      continue;
    }

    const contentStart = (match.index ?? 0) + match[0].length;
    const nextMatch = headingMatches[index + 1];
    const contentEnd = nextMatch?.index ?? artifact.length;
    const content = artifact.slice(contentStart, contentEnd).trim();
    sections.push({ heading, content });
  }

  return sections;
}

function formatHandoffSections(
  sections: Array<{ heading: string; content: string }>,
) {
  return sections.map((section) =>
    [
      `## ${section.heading}`,
      clipHandoffText(section.content || "- none", HANDOFF_SECTION_MAX_CHARS),
    ].join("\n"),
  );
}

function getMissingRequiredHandoffFieldsForSections(
  agentRole: AgentRole,
  sections: Array<{ heading: string }>,
) {
  const requiredFields = REQUIRED_HANDOFF_FIELDS[agentRole] ?? [];
  return requiredFields.filter((field) => !hasHandoffSection(sections, field));
}

function getHandoffSectionContent(
  sections: Array<{ heading: string; content: string }>,
  requiredField: string,
) {
  const normalizedRequired = normalizeHandoffHeading(requiredField);
  return (
    sections.find((section) =>
      normalizeHandoffHeading(section.heading).includes(normalizedRequired),
    )?.content ?? ""
  );
}

function hasHandoffSection(
  sections: Array<{ heading: string }>,
  requiredField: string,
) {
  const normalizedRequired = normalizeHandoffHeading(requiredField);
  return sections.some((section) =>
    normalizeHandoffHeading(section.heading).includes(normalizedRequired),
  );
}

function isHandoffHeading(heading: string) {
  const normalizedHeading = normalizeHandoffHeading(heading);
  return HANDOFF_SECTION_HEADINGS.some((candidate) =>
    normalizedHeading.includes(normalizeHandoffHeading(candidate)),
  );
}

function normalizeHandoffHeading(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clipHandoffText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}\n[truncated ${value.length - maxChars} chars]`;
}

function hasCompletedArtifact(runs: WorkerRun[], agentRole: AgentRole) {
  return runs.some(
    (run) =>
      run.agentRole === agentRole &&
      run.status === "completed" &&
      run.artifact.trim(),
  );
}

function formatListOrNone(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function stageGateResult(
  result: Omit<
    StageGateResult,
    | "blockedRunId"
    | "blockedAgentRole"
    | "recoveryKind"
    | "canAutoRepair"
    | "canManualRetry"
    | "needsClarification"
    | "clarificationPrompt"
  > &
    Partial<
      Pick<
        StageGateResult,
        | "blockedRunId"
        | "blockedAgentRole"
        | "recoveryKind"
        | "canAutoRepair"
        | "canManualRetry"
        | "needsClarification"
        | "clarificationPrompt"
      >
    >,
): StageGateResult {
  return {
    blockedRunId: "",
    blockedAgentRole: null,
    recoveryKind: "none",
    canAutoRepair: false,
    canManualRetry: false,
    needsClarification: false,
    clarificationPrompt: null,
    ...result,
  };
}

export function isOpenWorkerRun(run: WorkerRun) {
  return run.status === "queued" || run.status === "running";
}

export function isHandoffSchemaRun(run: Pick<WorkerRun, "error">) {
  return run.error.startsWith("Agent handoff is incomplete.");
}

export function isWorkerRuntimeErrorRun(run: Pick<WorkerRun, "error" | "artifact">) {
  const text = `${run.error}\n${run.artifact}`.toLowerCase();
  return (
    text.includes("worker_runtime_error") ||
    text.includes("referenceerror") ||
    text.includes("is not defined") ||
    text.includes("本機背景 worker 版本不同步") ||
    text.includes("worker version")
  );
}

export function isRepoDirtyBlockedRun(run: Pick<WorkerRun, "error" | "artifact">) {
  const text = `${run.error}\n${run.artifact}`.toLowerCase();
  return (
    text.includes("repo_dirty_blocked") ||
    text.includes("working tree is not clean") ||
    text.includes("repo is not clean") ||
    text.includes("uncommitted changes") ||
    text.includes("本機 repo 目前有未提交異動") ||
    text.includes("merge conflict")
  );
}

export function isRunHeartbeatStale(
  run: Pick<WorkerRun, "updatedAt">,
  now = Date.now(),
) {
  const updatedAt = Date.parse(run.updatedAt);
  return (
    Number.isFinite(updatedAt) && now - updatedAt > RUN_HEARTBEAT_STALE_MS
  );
}

export function getEffectiveBlockingRun(runs: WorkerRun[]) {
  const supersededRunIds = new Set(
    runs
      .map((run) => run.retryOfRunId)
      .filter((runId): runId is string => Boolean(runId)),
  );

  return [...runs]
    .reverse()
    .find(
      (run) =>
        (run.status === "failed" || run.status === "blocked") &&
        !supersededRunIds.has(run.runId),
    );
}

export function evaluateWorkflowStageGate(
  detail: WorkflowRequestDetail,
): StageGateResult {
  const { request, runs } = detail;
  const blockers: string[] = [];
  const nextActions: string[] = [];
  const humanDecisions: string[] = [];
  const openRun = [...runs].reverse().find(isOpenWorkerRun);
  const failedRun = getEffectiveBlockingRun(runs);

  if (!request.assignedWorkerId) {
    blockers.push("No Local Worker is assigned to this request.");
  }

  if (failedRun) {
    if (isWorkerRuntimeErrorRun(failedRun)) {
      blockers.push(
        "本機背景 Worker 版本不同步或執行環境異常，請重新下載並重啟 Worker。",
      );
    } else if (isRepoDirtyBlockedRun(failedRun)) {
      blockers.push(
        `本機 repo 目前有未提交異動或分支衝突：${failedRun.error || "請先處理工作區狀態。"}`,
      );
    } else {
      blockers.push(
        `${formatAgentRole(failedRun.agentRole)} reported ${failedRun.status}: ${failedRun.error || "no error detail returned"}`,
      );
    }
  }

  if (openRun) {
    const stale = isRunHeartbeatStale(openRun);
    return stageGateResult({
      status: "waiting",
      label: stale ? "Run may be stuck" : "Worker running",
      summary: stale
        ? `${formatAgentRole(openRun.agentRole)} is ${openRun.status}, but its run heartbeat is stale.`
        : `${formatAgentRole(openRun.agentRole)} is ${openRun.status}.`,
      blockers,
      nextActions: [
        stale
          ? "Synchronize worker status before retrying this Agent."
          : "Wait for the assigned Local Worker to return artifacts.",
      ],
      humanDecisions,
      blockedRunId: stale ? openRun.runId : "",
      blockedAgentRole: stale ? openRun.agentRole : null,
      recoveryKind: stale ? "stale_run" : "none",
    });
  }

  if (request.interpretation.riskFlags.length > 0) {
    const interpretationRun = [...runs]
      .reverse()
      .find(
        (run) => run.agentRole === "agent0" && run.status === "completed",
      );
    return stageGateResult({
      status: "human-decision",
      label: "Human review required",
      summary:
        request.interpretation.source === "worker"
          ? "Local Worker/Codex flagged high-risk operations. The App will not continue automatically."
          : "The provisional preview flagged high-risk operations. Assign a Local Worker/Codex run or clarify scope before continuing.",
      blockers,
      nextActions: [
        request.interpretation.source === "worker"
          ? "Clarify scope or remove the high-risk operation before dispatch."
          : "Run Local Worker/Codex interpretation before implementation.",
      ],
      humanDecisions: request.interpretation.riskFlags,
      blockedRunId: interpretationRun?.runId ?? "",
      blockedAgentRole: interpretationRun?.agentRole ?? null,
      recoveryKind: "human_decision",
      canManualRetry: Boolean(interpretationRun),
      needsClarification: true,
    });
  }

  const nextAgent = getNextAgentRole(request, runs);
  if (nextAgent === "agent2" && request.deliveryMode === "draft_pr") {
    const prTrace = getPrDeliveryTraceForRequest(request);
    if (!prTrace.sourceBranch) {
      blockers.push(
        "Draft PR branch preparation requires a verified Azure Work Item.",
      );
      return stageGateResult({
        status: "human-decision",
        label: "Verified Azure Work Item required",
        summary:
          "The workflow needs a verified Azure Work Item before preparing the formal PR branch.",
        blockers,
        nextActions: [
          "Select or verify an Azure Work Item, then rerun the same workflow step.",
        ],
        humanDecisions: [
          prTrace.reason ||
            "Draft PR delivery needs a verified Azure Work Item before deriving a formal request branch.",
        ],
        recoveryKind: "human_decision",
        needsClarification: true,
      });
    }
  }

  if (request.status === "pr_ready") {
    humanDecisions.push(
      "Review Agent3 delivery artifact and track the Azure PR that appears for the pushed request branch.",
    );
    return stageGateResult({
      status: "human-decision",
      label: "Azure PR tracking required",
      summary:
        "The workflow is ready to discover and track the active Azure PR for the pushed request branch.",
      blockers,
      nextActions: [
        "Run Azure PR discovery or use the manual fallback if Azure Repos does not expose the PR yet.",
      ],
      humanDecisions,
      recoveryKind: "human_decision",
    });
  }

  if (nextAgent) {
    nextActions.push(`Dispatch ${formatAgentRole(nextAgent)} to the assigned Local Worker.`);
  }

  if (blockers.length > 0) {
    const canAutoRepair =
      failedRun && isHandoffSchemaRun(failedRun)
        ? !runs.some(
            (run) =>
              run.retryOfRunId === failedRun.runId &&
              run.dispatchReason === "auto_repair",
          ) && failedRun.dispatchReason !== "auto_repair"
        : false;
    const workerRuntimeError = failedRun
      ? isWorkerRuntimeErrorRun(failedRun)
      : false;
    const repoDirtyBlocked = failedRun ? isRepoDirtyBlockedRun(failedRun) : false;
    const clarificationPrompt = failedRun
      ? extractClarificationPromptFromArtifact(failedRun.artifact)
      : null;
    return stageGateResult({
      status: "blocked",
      label: "Blocked",
      summary: "The request cannot continue until blockers are resolved.",
      blockers,
      nextActions,
      humanDecisions,
      blockedRunId: failedRun?.runId ?? "",
      blockedAgentRole: failedRun?.agentRole ?? null,
      recoveryKind: failedRun
        ? isHandoffSchemaRun(failedRun)
          ? "handoff_schema"
          : workerRuntimeError
            ? "worker_runtime_error"
            : repoDirtyBlocked
              ? "repo_dirty_blocked"
              : failedRun.status === "failed"
                ? "agent_failed"
                : "agent_blocked"
        : "none",
      canAutoRepair,
      canManualRetry: Boolean(failedRun),
      needsClarification: Boolean(
        failedRun &&
          !isHandoffSchemaRun(failedRun) &&
          !workerRuntimeError &&
          !repoDirtyBlocked,
      ),
      clarificationPrompt,
    });
  }

  if (request.status === "delivered" || request.status === "pr_created") {
    const isNoPrDelivery =
      request.status === "delivered" && request.deliveryMode === "no_pr";
    return stageGateResult({
      status: "ready",
      label: isNoPrDelivery ? "Delivered" : "Tracked",
      summary: isNoPrDelivery
        ? "Request was completed without PR after Agent3 review."
        : `Request is ${request.status}.`,
      blockers,
      nextActions,
      humanDecisions,
    });
  }

  return stageGateResult({
    status: nextAgent ? "ready" : "blocked",
    label: nextAgent ? "Ready" : "No automatic next step",
    summary: nextAgent
      ? `Ready to dispatch ${formatAgentRole(nextAgent)}.`
      : "No automatic workflow transition is available for this state.",
    blockers,
    nextActions,
    humanDecisions,
  });
}

export function formatAgentRole(agentRole: AgentRole) {
  const labels: Record<AgentRole, string> = {
    agent0: "Agent 0: Thread Dispatcher",
    agent1: "Agent 1: Source & Scope",
    agent2: "Agent 2: Controlled Implementation",
    agent3: "Agent 3: Review & Delivery",
  };

  return labels[agentRole];
}

export function formatWorkflowStage(stage: WorkflowStage) {
  const labels: Record<WorkflowStage, string> = {
    intake: "Intake",
    dispatched: "Dispatched",
    source_check: "Source Check",
    ready_for_implementation: "Ready for Implementation",
    running: "Implementation Running",
    review: "Review",
    pr_ready: "PR Ready",
    pr_created: "PR Created",
    delivered: "Delivered",
    blocked: "Blocked",
  };

  return labels[stage];
}

export function formatDeliveryMode(deliveryMode: DeliveryMode) {
  return deliveryMode === "no_pr"
    ? "No PR - complete local changes"
    : "Draft PR required";
}

export function formatEvidenceMode(evidenceMode: RequestEvidenceMode) {
  return evidenceMode === "ui_only"
    ? "UI-only visual evidence"
    : "Standard source confirmation";
}

function getAgentResponsibility(agentRole: AgentRole) {
  if (agentRole === "agent0") {
    return "Decide the next agent thread and produce a clean startup prompt without reading full source context.";
  }

  if (agentRole === "agent1") {
    return "Check confirmed sources, detect missing/conflicting sources, define scope/non-scope, and produce a Source Check Report.";
  }

  if (agentRole === "agent2") {
    return "Create a Task Package, run implementability checks, implement only confirmed scope, and produce an Implementation Result.";
  }

  return "Review Agent2 output against confirmed sources and scope, verify evidence, and produce a Delivery Report.";
}

const WORKER_INTERPRETATION_OUTPUT_TEMPLATE = [
  "```text",
  "CONTROL_PLANE_INTERPRETATION_START",
  "{",
  '  "title": "short human-readable title",',
  '  "kind": "REQ | BUG | REF | DOC | OPS",',
  '  "taskLevel": "Level 0 | Level 1 | Level 2 | Level 3",',
  '  "summary": "classification summary; do not claim sources are confirmed",',
  '  "suggestedNextAgent": "agent1",',
  '  "missingSources": ["only list true external-source gaps, such as API contract or permission mapping"],',
  '  "sourceWarnings": ["User text, screenshots, and repo inspection may be sufficient for low-risk scoped fixes"],',
  '  "riskFlags": [],',
  '  "guardrails": ["Do not invent API fields, permissions, data models, business rules, or expanded workflows."]',
  "}",
  "CONTROL_PLANE_INTERPRETATION_END",
  "```",
].join("\n");

function formatWorkflowAzureReference(request: WorkflowRequest) {
  if (request.azureReferenceType === "pr" && request.azureReferenceId) {
    return `Azure PR #${request.azureReferenceId}`;
  }

  if (
    request.azureReferenceType === "work-item" &&
    request.azureReferenceId
  ) {
    const evidence = normalizeAzureReferenceEvidence(
      request.azureReferenceEvidence,
      request.azureReferenceType,
      request.azureReferenceId,
    );
    const suffix =
      evidence.status === "verified"
        ? "verified"
        : evidence.status === "unverified"
          ? "unverified"
          : "tracking reference only";
    return `Azure 單號: ${request.azureReferenceId} (${suffix})`;
  }

  return "none";
}

function formatDeliveryModeGuidance(deliveryMode: DeliveryMode) {
  if (deliveryMode === "no_pr") {
    return [
      "- This request does not require an Azure draft PR.",
      "- Complete the local project changes, run appropriate verification, and report final delivery evidence.",
      "- Do not prepare Azure PR metadata unless the control plane changes the delivery mode.",
    ].join("\n");
  }

  return [
    "- This request is expected to end at PR Ready after Agent3 review.",
    `- Team PR flow uses ${TEAM_PR_BASE_BRANCH} as the base branch and a source branch derived from a verified Azure Work Item, such as feature/{id}, bug/{id}, or hotfix/{id}.`,
    "- Do not create, merge, abandon, approve, deploy, or update an Azure PR from the Agent.",
    "- After the request branch is committed and pushed, the App will discover and track the active Azure PR automatically.",
  ].join("\n");
}

function hasOpenRun(runs: WorkerRun[]) {
  return runs.some(isOpenWorkerRun);
}

function requireTrimmed(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
}

function requireOptionalTrimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequestKind(value: unknown): RequestKind {
  if (
    value === "REQ" ||
    value === "BUG" ||
    value === "REF" ||
    value === "DOC" ||
    value === "OPS"
  ) {
    return value;
  }

  return "REQ";
}

function normalizeTaskLevel(value: unknown): TaskLevel {
  if (
    value === "Level 0" ||
    value === "Level 1" ||
    value === "Level 2" ||
    value === "Level 3"
  ) {
    return value;
  }

  return "Level 2";
}

function normalizeAzureReferenceType(value: unknown): AzureReferenceType {
  if (value === "pr" || value === "work-item") {
    return value;
  }

  return "none";
}

function normalizeDeliveryMode(value: unknown): DeliveryMode {
  return value === "no_pr" ? "no_pr" : "draft_pr";
}

function normalizeEvidenceMode(value: unknown): RequestEvidenceMode {
  return value === "ui_only" ? "ui_only" : "standard";
}

export function normalizeAzureReferenceEvidence(
  value: unknown,
  referenceType: AzureReferenceType,
  referenceId: string,
): AzureReferenceEvidence {
  const base: AzureReferenceEvidence = {
    status: referenceType === "none" || !referenceId ? "none" : "tracking",
    referenceType,
    referenceId,
    checkedAt: "",
    title: "",
    workItemType: "",
    workItemState: "",
    assignedTo: "",
    areaPath: "",
    iterationPath: "",
    webUrl: "",
    summary: "",
    error: "",
  };

  if (referenceType === "none" || !referenceId) {
    return base;
  }

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const evidenceReferenceId =
    requireOptionalTrimmed(record.referenceId) || referenceId;
  const status = normalizeAzureReferenceEvidenceStatus(
    record.status,
    evidenceReferenceId,
    referenceId,
  );
  return {
    ...base,
    status,
    referenceId: evidenceReferenceId,
    referenceType,
    checkedAt: requireOptionalTrimmed(record.checkedAt),
    title: requireOptionalTrimmed(record.title),
    workItemType: requireOptionalTrimmed(record.workItemType),
    workItemState: requireOptionalTrimmed(record.workItemState),
    assignedTo: requireOptionalTrimmed(record.assignedTo),
    areaPath: requireOptionalTrimmed(record.areaPath),
    iterationPath: requireOptionalTrimmed(record.iterationPath),
    webUrl: requireOptionalTrimmed(record.webUrl),
    summary: requireOptionalTrimmed(record.summary),
    error: requireOptionalTrimmed(record.error),
  };
}

function normalizeAzureReferenceEvidenceStatus(
  value: unknown,
  evidenceReferenceId = "",
  referenceId = "",
): AzureReferenceEvidenceStatus {
  if (value === "verified" || value === "unverified") {
    if (
      value === "verified" &&
      evidenceReferenceId &&
      referenceId &&
      evidenceReferenceId !== referenceId
    ) {
      return "unverified";
    }

    return value;
  }

  return "tracking";
}
