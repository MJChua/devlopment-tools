import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  buildWorkflowAgentPacket,
  createWorkflowRequestFromInput,
  evaluateWorkflowStageGate,
  getAgentHandoffBlocker,
  getEffectiveBlockingRun,
  getMissingRequiredAgentHandoffFields,
  getNextAgentRole,
  getStageAfterCompletedAgent,
  getStageForQueuedAgent,
  isHandoffSchemaRun,
  isOpenWorkerRun,
  mergeStructuredAgentReport,
  normalizeAzureReferenceEvidence,
  type AgentRole,
  type AuditEvent,
  type AzurePullRequestLink,
  type DeliveryMode,
  type RequestAttachment,
  type RequestAttachmentPurpose,
  type RepositoryCandidate,
  type StageGateResult,
  type WorkerRegistration,
  type WorkerRegistrationWithToken,
  type WorkerRun,
  type WorkerRunDispatchReason,
  type WorkerRunStatus,
  type WorkflowRequest,
  type WorkflowRequestDetail,
  type WorkflowRequestInput,
  type WorkflowStage,
} from "./control-plane-workflow.ts";
import {
  extractWorkerInterpretationFromText,
  normalizeRequestInterpretation,
  type RequestInterpretation,
} from "./request-analysis.ts";
import { normalizeRequestInputTemplateId } from "./request-templates.ts";

const DATA_DIR = path.join(process.cwd(), ".control-plane");
const DB_PATH =
  process.env.CONTROL_PLANE_DB_PATH ??
  path.join(DATA_DIR, "control-plane.sqlite");
const ATTACHMENT_DIR =
  process.env.CONTROL_PLANE_ATTACHMENT_DIR ??
  path.join(DATA_DIR, "request-attachments");

let database: DatabaseSync | null = null;

export type CompleteWorkerRunInput = {
  status: Exclude<WorkerRunStatus, "queued" | "running">;
  commandOutput?: string;
  diffSummary?: string;
  artifact?: string;
  error?: string;
  interpretation?: Partial<RequestInterpretation>;
};

export type RecoverWorkflowRequestInput = {
  requestId: string;
  action:
    | "retry_same_agent"
    | "clarify_and_retry"
    | "auto_repair"
    | "sync_output";
  runId?: string;
  clarification?: string;
  clarificationAttachmentIds?: string[];
  actor?: string;
};

export type CreateRequestAttachmentInput = {
  requestId: string;
  filename: string;
  contentType: string;
  data: Buffer | ArrayBuffer | Uint8Array;
  purpose?: RequestAttachmentPurpose;
  recoveryOfRunId?: string;
  actor?: string;
};

export type WorkerRepositoryCandidateInput = {
  name?: unknown;
  path?: unknown;
  source?: unknown;
};

export type WorkerCodexReadinessInput = {
  codexReady?: unknown;
  codexStatus?: unknown;
  codexError?: unknown;
  codexDiagnosticCode?: unknown;
  codexExecutablePath?: unknown;
  codexCheckedAt?: unknown;
};

export type RealtimeDigest = {
  digest: string;
  checkedAt: string;
  requestsUpdatedAt: string;
  workersUpdatedAt: string;
  runsUpdatedAt: string;
  requestCount: number;
  workerCount: number;
  runCount: number;
};

const DEFAULT_SANDBOX_MODE = "workspace-write";
const MAX_REQUEST_ATTACHMENTS = 10;
const MAX_REQUEST_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

export function createRequest(input: WorkflowRequestInput) {
  const request = createWorkflowRequestFromInput(input);
  const db = getDatabase();

  db.prepare(
    `INSERT INTO workflow_requests (
      request_id,
      kind,
      title,
      detail,
      task_level,
      owner,
      assigned_worker_id,
      repo_path,
      delivery_mode,
      evidence_mode,
      input_template_id,
      status,
      azure_reference_type,
      azure_reference_id,
      azure_reference_json,
      analysis_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    request.requestId,
    request.kind,
    request.title,
    request.detail,
    request.taskLevel,
    request.owner,
    request.assignedWorkerId,
    request.repoPath,
    request.deliveryMode,
    request.evidenceMode,
    request.templateId,
    request.status,
    request.azureReferenceType,
    request.azureReferenceId,
    JSON.stringify(request.azureReferenceEvidence),
    JSON.stringify(request.interpretation),
    request.createdAt,
    request.updatedAt,
  );
  appendAuditEvent(request.requestId, "request.created", "Request created.", {
    actor: request.owner,
  });

  return request;
}

export function listRequests(): WorkflowRequest[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM workflow_requests ORDER BY updated_at DESC, created_at DESC`,
    )
    .all()
    .map(mapRequestRow);
}

export function getRequest(requestId: string): WorkflowRequest | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM workflow_requests WHERE request_id = ?`)
    .get(requestId);

  return row ? mapRequestRow(row) : null;
}

export function getRequestDetail(
  requestId: string,
): WorkflowRequestDetail | null {
  const request = getRequest(requestId);
  if (!request) {
    return null;
  }

  return {
    request,
    runs: listRunsForRequest(requestId),
    prLinks: listPullRequestLinks(requestId),
    auditEvents: listAuditEvents(requestId),
    attachments: listRequestAttachments(requestId),
  };
}

export function getStageGate(requestId: string): StageGateResult | null {
  const detail = getRequestDetail(requestId);
  if (!detail) {
    return null;
  }

  return evaluateWorkflowStageGate(detail);
}

export function createRequestAttachment(
  input: CreateRequestAttachmentInput,
): RequestAttachment {
  const request = getRequest(input.requestId);
  if (!request) {
    throw new Error("Request not found.");
  }

  const contentType = input.contentType.trim().toLowerCase();
  const extension = SUPPORTED_IMAGE_CONTENT_TYPES.get(contentType);
  if (!extension) {
    throw new Error("Only PNG, JPEG, WebP, and GIF images can be attached.");
  }

  const data =
    input.data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(input.data))
      : Buffer.from(input.data);
  if (data.length === 0) {
    throw new Error("Attachment file is empty.");
  }

  if (data.length > MAX_REQUEST_ATTACHMENT_BYTES) {
    throw new Error("Attachment file must be 10MB or smaller.");
  }

  const currentCount = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM request_attachments
       WHERE request_id = ?`,
    )
    .get(input.requestId) as { count?: number } | undefined;
  if (Number(currentCount?.count ?? 0) >= MAX_REQUEST_ATTACHMENTS) {
    throw new Error("Each request can have at most 10 image attachments.");
  }

  const now = new Date().toISOString();
  const attachmentId = randomUUID();
  const purpose = normalizeAttachmentPurpose(input.purpose);
  const recoveryOfRunId = input.recoveryOfRunId?.trim() ?? "";
  const actor = input.actor?.trim() || request.owner;
  const requestAttachmentDir = path.join(ATTACHMENT_DIR, input.requestId);
  mkdirSync(requestAttachmentDir, { recursive: true });
  const storagePath = path.join(requestAttachmentDir, `${attachmentId}${extension}`);
  writeFileSync(storagePath, data);

  const attachment: RequestAttachment = {
    attachmentId,
    requestId: input.requestId,
    filename: sanitizeAttachmentFilename(input.filename),
    contentType,
    sizeBytes: data.length,
    storagePath,
    purpose,
    recoveryOfRunId,
    actor,
    createdAt: now,
  };

  getDatabase()
    .prepare(
      `INSERT INTO request_attachments (
        attachment_id,
        request_id,
        filename,
        content_type,
        size_bytes,
        storage_path,
        purpose,
        recovery_of_run_id,
        actor,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      attachment.attachmentId,
      attachment.requestId,
      attachment.filename,
      attachment.contentType,
      attachment.sizeBytes,
      attachment.storagePath,
      attachment.purpose,
      attachment.recoveryOfRunId,
      attachment.actor,
      attachment.createdAt,
    );

  updateRequestUpdatedAt(input.requestId, now);
  appendAuditEvent(input.requestId, "request.attachment.created", "Image attachment added.", {
    actor: request.owner,
    metadata: {
      attachmentId,
      filename: attachment.filename,
      contentType,
      sizeBytes: attachment.sizeBytes,
      purpose: attachment.purpose,
      recoveryOfRunId: attachment.recoveryOfRunId,
    },
  });

  return attachment;
}

export function getRequestAttachment(
  requestId: string,
  attachmentId: string,
): RequestAttachment | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM request_attachments
       WHERE request_id = ? AND attachment_id = ?`,
    )
    .get(requestId, attachmentId);

  return row ? mapAttachmentRow(row) : null;
}

export function getRealtimeDigest(now = new Date()): RealtimeDigest {
  const db = getDatabase();
  const requestRows = db
    .prepare(
      `SELECT request_id, status, assigned_worker_id, repo_path, delivery_mode, updated_at
       FROM workflow_requests
       ORDER BY request_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const workerRows = db
    .prepare(
      `SELECT worker_id,
              display_name,
              status,
              repo_path,
              auto_commit_pr,
              sandbox_mode,
              codex_ready,
              codex_status,
              codex_diagnostic_code,
              readiness_check_requested_at,
              codex_setup_requested_at,
              repository_candidates_json,
              repository_candidates_updated_at,
              last_seen_at,
              updated_at
       FROM workers
       ORDER BY worker_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const runRows = db
    .prepare(
      `SELECT run_id,
              request_id,
              agent_role,
              worker_id,
              repo_path,
              status,
              retry_of_run_id,
              dispatch_reason,
              started_at,
              completed_at,
              updated_at
       FROM worker_runs
       ORDER BY run_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const attachmentRows = db
    .prepare(
      `SELECT attachment_id,
              request_id,
              filename,
              content_type,
              size_bytes,
              created_at
       FROM request_attachments
       ORDER BY attachment_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const requests = requestRows;
  const workers = workerRows.map(({ last_seen_at, updated_at, ...worker }) => worker);
  const runs = runRows.map(({ updated_at, ...run }) => run);
  const source = {
    requests,
    workers,
    runs,
    attachments: attachmentRows,
  };

  return {
    digest: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
    checkedAt: now.toISOString(),
    requestsUpdatedAt: getLatestUpdatedAt(requestRows),
    workersUpdatedAt: getLatestUpdatedAt(workerRows),
    runsUpdatedAt: getLatestUpdatedAt(runRows),
    requestCount: requests.length,
    workerCount: workers.length,
    runCount: runs.length,
  };
}

export function registerWorker(input: {
  workerId: string;
  displayName?: string;
  repoPath?: string;
  commandTemplate?: string;
  autoCommitAndPr?: boolean;
  sandboxMode?: string;
}): WorkerRegistrationWithToken {
  const workerId = requireTrimmed(input.workerId, "workerId");
  const token = createWorkerToken();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const displayName = input.displayName?.trim() || workerId;
  const repoPath = input.repoPath?.trim() || "";
  const sandboxMode = normalizeSandboxMode(input.sandboxMode);
  const commandTemplate =
    input.commandTemplate?.trim() || buildDefaultCodexCommandTemplate(sandboxMode);
  const autoCommitAndPr = input.autoCommitAndPr ? 1 : 0;

  getDatabase()
    .prepare(
      `INSERT INTO workers (
        worker_id,
        display_name,
        repo_path,
        command_template,
        auto_commit_pr,
        sandbox_mode,
        token_hash,
        codex_ready,
        codex_status,
        codex_error,
        codex_diagnostic_code,
        codex_executable_path,
        codex_checked_at,
        readiness_check_requested_at,
        codex_setup_requested_at,
        status,
        last_seen_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unknown', '', 'unknown', '', NULL, NULL, NULL, 'registered', NULL, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        display_name = excluded.display_name,
        repo_path = excluded.repo_path,
        command_template = excluded.command_template,
        auto_commit_pr = excluded.auto_commit_pr,
        sandbox_mode = excluded.sandbox_mode,
        token_hash = excluded.token_hash,
        codex_ready = 0,
        codex_status = 'unknown',
        codex_error = '',
        codex_diagnostic_code = 'unknown',
        codex_executable_path = '',
        codex_checked_at = NULL,
        readiness_check_requested_at = NULL,
        codex_setup_requested_at = NULL,
        status = 'registered',
        updated_at = excluded.updated_at`,
    )
    .run(
      workerId,
      displayName,
      repoPath,
      commandTemplate,
      autoCommitAndPr,
      sandboxMode,
      tokenHash,
      now,
      now,
    );

  return {
    ...requireWorker(workerId),
    token,
  };
}

export function listWorkers(): WorkerRegistration[] {
  return getDatabase()
    .prepare(`SELECT * FROM workers ORDER BY updated_at DESC`)
    .all()
    .map(mapWorkerRow);
}

export function assertWorkerHasNoActiveRuns(
  workerId: string,
  action = "update worker",
): WorkerRegistration {
  const worker = requireWorker(workerId);
  const activeRun = getDatabase()
    .prepare(
      `SELECT run_id FROM worker_runs
       WHERE worker_id = ? AND status IN ('queued', 'running')
       LIMIT 1`,
    )
    .get(worker.workerId);

  if (activeRun) {
    throw new Error(
      `Cannot ${action} while an Agent task is queued or running.`,
    );
  }

  return worker;
}

export function stopWorker(workerId: string): WorkerRegistration {
  const worker = assertWorkerHasNoActiveRuns(workerId, "stop worker");
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workers
       SET status = 'disabled',
           token_hash = ?,
           repository_candidates_json = '[]',
           repository_candidates_updated_at = NULL,
           codex_ready = 0,
           codex_status = 'unknown',
           codex_error = '',
           codex_diagnostic_code = 'unknown',
           codex_executable_path = '',
           codex_checked_at = NULL,
           readiness_check_requested_at = NULL,
           codex_setup_requested_at = NULL,
           last_seen_at = NULL,
           updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(hashToken(createWorkerToken()), now, worker.workerId);

  return requireWorker(worker.workerId);
}

export function updateWorkerRepositoryCandidates(input: {
  workerId: string;
  token: string;
  repositories: WorkerRepositoryCandidateInput[];
  readiness?: WorkerCodexReadinessInput;
}) {
  validateWorkerToken(input.workerId, input.token);
  const repositories = normalizeRepositoryCandidates(input.repositories);
  const readiness = normalizeWorkerCodexReadiness(input.readiness);
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `UPDATE workers
       SET repository_candidates_json = ?,
           repository_candidates_updated_at = ?,
           codex_ready = ?,
           codex_status = ?,
           codex_error = ?,
           codex_diagnostic_code = ?,
           codex_executable_path = ?,
           codex_checked_at = ?,
           readiness_check_requested_at = NULL,
           status = 'active',
           last_seen_at = ?,
           updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(
      JSON.stringify(repositories),
      now,
      readiness.codexReady ? 1 : 0,
      readiness.codexStatus,
      readiness.codexError,
      readiness.codexDiagnosticCode,
      readiness.codexExecutablePath,
      readiness.codexCheckedAt,
      now,
      now,
      input.workerId,
    );

  return requireWorker(input.workerId);
}

export function listWorkerRepositoryCandidates(
  workerId?: string,
): RepositoryCandidate[] {
  const rows = workerId
    ? getDatabase()
        .prepare(`SELECT * FROM workers WHERE worker_id = ?`)
        .all(workerId)
    : getDatabase().prepare(`SELECT * FROM workers ORDER BY updated_at DESC`).all();

  return uniqueRepositoryCandidates(rows.flatMap((row) => mapWorkerRow(row).repositoryCandidates));
}

export function validateWorkerToken(workerId: string, token: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM workers WHERE worker_id = ?`)
    .get(workerId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error("Worker authentication failed.");
  }

  if (row.status === "disabled") {
    throw new Error("Worker connection was stopped.");
  }

  if (row.token_hash !== hashToken(token)) {
    throw new Error("Worker authentication failed.");
  }

  return mapWorkerRow(row);
}

export function dispatchNextAgent(input: {
  requestId: string;
  workerId?: string;
  agentRole?: AgentRole;
  retryOfRunId?: string;
  dispatchReason?: WorkerRunDispatchReason;
  recoveryNote?: string;
  recoveryAttachments?: RequestAttachment[];
  actor?: string;
}) {
  const detail = getRequestDetail(input.requestId);
  if (!detail) {
    throw new Error("Request not found.");
  }

  const request = detail.request;
  const workerId = (input.workerId ?? request.assignedWorkerId).trim();
  if (!workerId) {
    throw new Error("A Local Worker must be assigned before dispatch.");
  }

  const worker = requireWorker(workerId);
  if (!worker.codexReady) {
    throw new Error(
      worker.codexError ||
        "Local Codex execution is not ready for this worker.",
    );
  }
  const agentRole = input.agentRole ?? getNextAgentRole(request, detail.runs);
  if (!agentRole) {
    throw new Error("No automatic next agent is available for this request.");
  }
  const repoPath = ensureRequestRepoPathSnapshot(request, worker);
  const retryOfRunId = input.retryOfRunId?.trim() ?? "";
  const dispatchReason = normalizeDispatchReason(input.dispatchReason);
  const priorRun = retryOfRunId
    ? detail.runs.find((run) => run.runId === retryOfRunId) ?? null
    : null;

  const runId = randomUUID();
  const now = new Date().toISOString();
  const requestSnapshot = { ...request, repoPath };
  const packet = appendRecoveryContextToPacket(
    buildWorkflowAgentPacket(
      requestSnapshot,
      agentRole,
      detail.runs,
      detail.attachments,
    ),
    {
      dispatchReason,
      retryOfRunId,
      recoveryNote: input.recoveryNote,
      recoveryAttachments: input.recoveryAttachments ?? [],
      priorRun,
    },
  );
  const nextStage = getStageForQueuedAgent(agentRole);

  getDatabase()
    .prepare(
      `INSERT INTO worker_runs (
        run_id,
        request_id,
        agent_role,
        worker_id,
        repo_path,
        status,
        retry_of_run_id,
        dispatch_reason,
        packet,
        command_output,
        diff_summary,
        artifact,
        error,
        created_at,
        started_at,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, '', '', '', '', ?, NULL, NULL, ?)`,
    )
    .run(
      runId,
      request.requestId,
      agentRole,
      worker.workerId,
      repoPath,
      retryOfRunId,
      dispatchReason,
      packet,
      now,
      now,
    );

  updateRequestStage(request.requestId, nextStage);
  appendAuditEvent(
    request.requestId,
    "agent.dispatched",
    `${agentRole} queued for ${worker.workerId}.`,
    {
      actor: input.actor ?? "control-plane",
      metadata: { runId, retryOfRunId, dispatchReason },
    },
  );

  return requireRun(runId);
}

export function recoverWorkflowRequest(input: RecoverWorkflowRequestInput) {
  const detail = getRequestDetail(input.requestId);
  if (!detail) {
    throw new Error("Request not found.");
  }

  if (input.action === "sync_output") {
    return reconcileWorkerRunOutput({
      detail,
      runId: input.runId,
      actor: input.actor,
    });
  }

  if (detail.runs.some(isOpenWorkerRun)) {
    throw new Error(
      "Cannot start recovery while an Agent run is queued or running.",
    );
  }

  const stageGate = evaluateWorkflowStageGate(detail);
  const fallbackRun = getEffectiveBlockingRun(detail.runs);
  const runId = input.runId?.trim() || stageGate.blockedRunId || fallbackRun?.runId || "";
  const blockedRun = runId
    ? detail.runs.find((run) => run.runId === runId)
    : null;

  if (!blockedRun) {
    throw new Error("No blocked Agent run is available for recovery.");
  }

  const canRetryCompletedInterpretation =
    input.action === "clarify_and_retry" &&
    blockedRun.agentRole === "agent0" &&
    blockedRun.status === "completed";
  if (
    blockedRun.status !== "failed" &&
    blockedRun.status !== "blocked" &&
    !canRetryCompletedInterpretation
  ) {
    throw new Error("Only blocked or failed Agent runs can be recovered.");
  }

  let dispatchReason: WorkerRunDispatchReason = "manual_retry";
  let recoveryNote = "";
  let recoveryAttachments: RequestAttachment[] = [];

  if (input.action === "auto_repair") {
    if (!isAutoRepairableRun(blockedRun, detail.runs)) {
      throw new Error("This run is not eligible for automatic repair.");
    }
    dispatchReason = "auto_repair";
    recoveryNote =
      "Server detected an incomplete structured handoff. Rerun the same Agent and return every required handoff section.";
  } else if (input.action === "clarify_and_retry") {
    recoveryNote = input.clarification?.trim() ?? "";
    recoveryAttachments = getRecoveryClarificationAttachments(
      detail.attachments,
      input.clarificationAttachmentIds,
      blockedRun.runId,
    );
    if (!recoveryNote && recoveryAttachments.length === 0) {
      throw new Error(
        "Clarification text or attachment is required before retrying this Agent.",
      );
    }
    dispatchReason = "clarification_retry";
  }

  const run = dispatchNextAgent({
    requestId: detail.request.requestId,
    workerId: blockedRun.workerId,
    agentRole: blockedRun.agentRole,
    retryOfRunId: blockedRun.runId,
    dispatchReason,
    recoveryNote,
    recoveryAttachments,
    actor: input.actor ?? "control-plane",
  });

  appendAuditEvent(
    detail.request.requestId,
    "agent.recovery_dispatched",
    `${blockedRun.agentRole} recovery queued with ${dispatchReason}.`,
    {
      actor: input.actor ?? "control-plane",
      metadata: {
        runId: run.runId,
        retryOfRunId: blockedRun.runId,
        dispatchReason,
      },
    },
  );

  return run;
}

function reconcileWorkerRunOutput(input: {
  detail: WorkflowRequestDetail;
  runId?: string;
  actor?: string;
}) {
  if (input.detail.runs.some(isOpenWorkerRun)) {
    throw new Error(
      "Cannot synchronize output while an Agent run is queued or running.",
    );
  }

  const stageGate = evaluateWorkflowStageGate(input.detail);
  const fallbackRun = getEffectiveBlockingRun(input.detail.runs);
  const runId = input.runId?.trim() || stageGate.blockedRunId || fallbackRun?.runId || "";
  const run = runId
    ? input.detail.runs.find((candidate) => candidate.runId === runId)
    : null;

  if (!run) {
    throw new Error("No blocked Agent run is available for output synchronization.");
  }

  if (run.requestId !== input.detail.request.requestId) {
    throw new Error("Run does not belong to this request.");
  }

  if (run.status !== "blocked" || !isHandoffSchemaRun(run)) {
    throw new Error("Only schema-blocked Agent runs can be synchronized.");
  }

  const mergedArtifact = mergeStructuredAgentReport(
    run.agentRole,
    run.artifact,
    run.commandOutput,
  );
  const missingRequiredHandoffFields = getMissingRequiredAgentHandoffFields(
    run.agentRole,
    mergedArtifact,
  );
  if (missingRequiredHandoffFields.length > 0) {
    throw new Error(
      `No complete structured handoff was found in this run output. Missing required fields: ${missingRequiredHandoffFields.join(", ")}.`,
    );
  }

  const handoffBlocker = getAgentHandoffBlocker(run.agentRole, mergedArtifact);
  const nextStatus: WorkerRunStatus = handoffBlocker ? "blocked" : "completed";
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `UPDATE worker_runs
       SET status = ?,
           artifact = ?,
           error = ?,
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE run_id = ?`,
    )
    .run(nextStatus, mergedArtifact, handoffBlocker, now, now, run.runId);

  const nextStage =
    nextStatus === "completed"
      ? getStageAfterCompletedAgent(
          run.agentRole,
          input.detail.request.deliveryMode,
        )
      : "blocked";
  updateRequestStage(input.detail.request.requestId, nextStage);
  appendAuditEvent(
    input.detail.request.requestId,
    "agent.output_synchronized",
    handoffBlocker
      ? `${run.agentRole} output synchronized but still blocked by source check.`
      : `${run.agentRole} output synchronized from command output.`,
    {
      actor: input.actor ?? "control-plane",
      metadata: {
        runId: run.runId,
        status: nextStatus,
        handoffBlocker,
      },
    },
  );

  if (nextStatus === "completed") {
    dispatchNextAgentIfReady(input.detail.request.requestId);
  }

  return requireRun(run.runId);
}

function isAutoRepairableRun(run: WorkerRun, runs: WorkerRun[]) {
  return (
    (run.status === "blocked" || run.status === "failed") &&
    isHandoffSchemaRun(run) &&
    run.dispatchReason !== "auto_repair" &&
    !runs.some(
      (candidate) =>
        candidate.retryOfRunId === run.runId &&
        candidate.dispatchReason === "auto_repair",
    )
  );
}

function appendRecoveryContextToPacket(
  packet: string,
  input: {
    dispatchReason: WorkerRunDispatchReason;
    retryOfRunId: string;
    recoveryNote?: string;
    recoveryAttachments: RequestAttachment[];
    priorRun: WorkerRun | null;
  },
) {
  const note = input.recoveryNote?.trim() ?? "";
  if (
    input.dispatchReason === "normal" &&
    !input.retryOfRunId &&
    !note &&
    input.recoveryAttachments.length === 0
  ) {
    return packet;
  }

  const lines = [
    "",
    "## Recovery Context",
    "",
    `Dispatch reason: ${input.dispatchReason}`,
    input.retryOfRunId ? `Retry of run: ${input.retryOfRunId}` : "",
    input.priorRun
      ? `Previous status: ${input.priorRun.status}`
      : "Previous status: unknown",
  ].filter(Boolean);

  if (input.priorRun?.error.trim()) {
    lines.push("", "Previous blocker:", input.priorRun.error.trim());
  }

  if (note) {
    lines.push("", "Operator clarification:", note);
  }

  if (input.recoveryAttachments.length > 0) {
    lines.push(
      "",
      "Operator clarification attachments:",
      ...input.recoveryAttachments.map(
        (attachment) =>
          `- ${attachment.filename} (${attachment.contentType}, ${attachment.sizeBytes} bytes): ${attachment.storagePath}`,
      ),
    );
  }

  lines.push(
    "",
    "Recovery rule: rerun the same Agent. Do not skip to the next Agent until this Agent returns a valid handoff.",
    "For schema repair, return every required handoff section exactly as requested in the Output section.",
  );

  return `${packet}\n${lines.join("\n")}`;
}

function getRecoveryClarificationAttachments(
  attachments: RequestAttachment[],
  attachmentIds: string[] | undefined,
  blockedRunId: string,
) {
  const ids = Array.from(
    new Set(
      (attachmentIds ?? [])
        .filter((attachmentId): attachmentId is string => typeof attachmentId === "string")
        .map((attachmentId) => attachmentId.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) {
    return [];
  }

  const attachmentById = new Map(
    attachments.map((attachment) => [attachment.attachmentId, attachment]),
  );

  return ids.map((attachmentId) => {
    const attachment = attachmentById.get(attachmentId);
    if (!attachment) {
      throw new Error("Clarification attachment does not belong to this request.");
    }
    if (attachment.purpose !== "clarification") {
      throw new Error("Clarification attachment must be uploaded as clarification evidence.");
    }
    if (
      attachment.recoveryOfRunId &&
      attachment.recoveryOfRunId !== blockedRunId
    ) {
      throw new Error("Clarification attachment belongs to a different blocked run.");
    }

    return attachment;
  });
}

export function pollWorkerRun(workerId: string, token: string) {
  return pollWorker(workerId, token).run;
}

function ensureRequestRepoPathSnapshot(
  request: WorkflowRequest,
  worker: WorkerRegistration,
) {
  const repoPath = request.repoPath.trim() || worker.repoPath.trim();
  if (!repoPath) {
    throw new Error("A repository must be selected before dispatch.");
  }

  if (!request.repoPath.trim()) {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `UPDATE workflow_requests
         SET repo_path = ?,
             updated_at = ?
         WHERE request_id = ?`,
      )
      .run(repoPath, now, request.requestId);
  }

  return repoPath;
}

export function pollWorker(workerId: string, token: string) {
  validateWorkerToken(workerId, token);
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM worker_runs
       WHERE worker_id = ? AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get(workerId);

  markWorkerSeen(workerId);
  if (!row) {
    const worker = requireWorker(workerId);
    const setupCodex = Boolean(worker.codexSetupRequestedAt);
    const recheckReadiness =
      !setupCodex && Boolean(worker.readinessCheckRequestedAt);
    if (setupCodex || recheckReadiness) {
      db.prepare(
        `UPDATE workers
         SET readiness_check_requested_at = NULL,
             codex_setup_requested_at = NULL,
             updated_at = ?
         WHERE worker_id = ?`,
      ).run(new Date().toISOString(), workerId);
    }

    return { run: null, recheckReadiness, setupCodex };
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE worker_runs
     SET status = 'running', started_at = ?, updated_at = ?
     WHERE run_id = ?`,
  ).run(now, now, row.run_id);

  return {
    run: requireRun(String(row.run_id)),
    recheckReadiness: false,
    setupCodex: false,
  };
}

export function requestWorkerReadinessCheck(workerId: string) {
  const worker = requireWorker(workerId);
  if (worker.status === "disabled") {
    throw new Error("Worker connection was stopped.");
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workers
       SET readiness_check_requested_at = ?,
           codex_setup_requested_at = NULL,
           codex_ready = 0,
           codex_status = 'unknown',
           codex_error = '等待本機 worker 重新檢查 Codex CLI。',
           codex_diagnostic_code = 'unknown',
           codex_checked_at = NULL,
           updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(now, now, worker.workerId);

  return requireWorker(worker.workerId);
}

export function requestWorkerCodexSetup(workerId: string) {
  const worker = requireWorker(workerId);
  if (worker.status === "disabled") {
    throw new Error("Worker connection was stopped.");
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workers
       SET codex_setup_requested_at = ?,
           readiness_check_requested_at = NULL,
           codex_ready = 0,
           codex_status = 'unknown',
           codex_error = '等待本機 worker 安裝或登入 Codex CLI。',
           codex_diagnostic_code = 'unknown',
           codex_checked_at = NULL,
           updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(now, now, worker.workerId);

  return requireWorker(worker.workerId);
}

export function updateWorkerSelectedRepository(input: {
  workerId: string;
  repoPath: string;
}) {
  const worker = requireWorker(input.workerId);
  if (worker.status === "disabled") {
    throw new Error("Worker connection was stopped.");
  }

  const repoPath = input.repoPath.trim();
  if (
    repoPath &&
    !worker.repositoryCandidates.some((candidate) => candidate.path === repoPath)
  ) {
    throw new Error("Selected repository was not reported by this worker.");
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workers
       SET repo_path = ?,
           updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(repoPath, now, worker.workerId);

  return requireWorker(worker.workerId);
}

export function heartbeatWorkerRun(
  workerId: string,
  token: string,
  runId: string,
) {
  validateWorkerToken(workerId, token);
  const run = requireRun(runId);
  if (run.workerId !== workerId) {
    throw new Error("Run is not assigned to this worker.");
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(`UPDATE worker_runs SET updated_at = ? WHERE run_id = ?`)
    .run(now, runId);
  markWorkerSeen(workerId);

  return requireRun(runId);
}

export function appendWorkerRunArtifact(input: {
  workerId: string;
  token: string;
  runId: string;
  artifact: string;
}) {
  validateWorkerToken(input.workerId, input.token);
  const run = requireRun(input.runId);
  if (run.workerId !== input.workerId) {
    throw new Error("Run is not assigned to this worker.");
  }

  const artifact = input.artifact.trim();
  const nextArtifact = [run.artifact, artifact].filter(Boolean).join("\n\n");
  const now = new Date().toISOString();

  getDatabase()
    .prepare(`UPDATE worker_runs SET artifact = ?, updated_at = ? WHERE run_id = ?`)
    .run(nextArtifact, now, input.runId);
  markWorkerSeen(input.workerId);

  return requireRun(input.runId);
}

export function completeWorkerRun(
  workerId: string,
  token: string,
  runId: string,
  input: CompleteWorkerRunInput,
) {
  validateWorkerToken(workerId, token);
  const run = requireRun(runId);
  if (run.workerId !== workerId) {
    throw new Error("Run is not assigned to this worker.");
  }

  const now = new Date().toISOString();
  const requestedStatus = normalizeCompleteStatus(input.status);
  const rawArtifact = input.artifact?.trim() || run.artifact;
  const commandOutput = input.commandOutput?.trim() ?? run.commandOutput;
  const artifact =
    requestedStatus === "completed"
      ? mergeStructuredAgentReport(run.agentRole, rawArtifact, commandOutput)
      : rawArtifact;
  const missingRequiredHandoffFields =
    requestedStatus === "completed"
      ? getMissingRequiredAgentHandoffFields(run.agentRole, artifact)
      : [];
  const handoffError = missingRequiredHandoffFields.length
    ? `Agent handoff is incomplete. Missing required fields: ${missingRequiredHandoffFields.join(", ")}.`
    : "";
  const handoffBlocker =
    requestedStatus === "completed" && !handoffError
      ? getAgentHandoffBlocker(run.agentRole, artifact)
      : "";
  const status = handoffError || handoffBlocker ? "blocked" : requestedStatus;
  const request = getRequest(run.requestId);
  const workerInterpretation =
    requestedStatus === "completed" && run.agentRole === "agent0" && request
      ? getWorkerInterpretationFromCompletion(input, artifact, request.detail)
      : null;
  const error = input.error?.trim() || handoffError || handoffBlocker;

  getDatabase()
    .prepare(
      `UPDATE worker_runs
       SET status = ?,
           command_output = ?,
           diff_summary = ?,
           artifact = ?,
           error = ?,
           completed_at = ?,
           updated_at = ?
       WHERE run_id = ?`,
    )
    .run(
      status,
      commandOutput,
      input.diffSummary?.trim() ?? run.diffSummary,
      artifact,
      error,
      now,
      now,
      runId,
    );

  if (workerInterpretation) {
    updateRequestInterpretation(run.requestId, workerInterpretation);
  }

  const nextStage =
    status === "completed"
      ? workerInterpretation?.riskFlags.length
        ? "blocked"
        : getStageAfterCompletedAgent(
            run.agentRole,
            request?.deliveryMode ?? "draft_pr",
          )
      : "blocked";
  updateRequestStage(run.requestId, nextStage);
  markWorkerSeen(workerId);
  appendAuditEvent(
    run.requestId,
    "agent.completed",
    `${run.agentRole} ${status}.`,
    {
      actor: workerId,
      metadata: {
        runId,
        status,
        missingRequiredHandoffFields,
        handoffBlocker,
      },
    },
  );
  if (workerInterpretation) {
    appendAuditEvent(
      run.requestId,
      "request.interpreted",
      "Local Worker/Codex interpretation updated request metadata.",
      {
        actor: workerId,
        metadata: {
          kind: workerInterpretation.kind,
          taskLevel: workerInterpretation.taskLevel,
          riskFlagCount: workerInterpretation.riskFlags.length,
        },
      },
    );
  }

  if (handoffError) {
    try {
      recoverWorkflowRequest({
        requestId: run.requestId,
        action: "auto_repair",
        runId,
        actor: "control-plane:auto",
      });
    } catch (error) {
      appendAuditEvent(
        run.requestId,
        "agent.auto_repair_skipped",
        error instanceof Error
          ? error.message
          : "Automatic recovery dispatch failed.",
        {
          actor: "control-plane:auto",
          metadata: { runId, missingRequiredHandoffFields },
        },
      );
    }
  }

  if (status === "completed" && !workerInterpretation?.riskFlags.length) {
    dispatchNextAgentIfReady(run.requestId);
  }

  return requireRun(runId);
}

function dispatchNextAgentIfReady(requestId: string) {
  const detail = getRequestDetail(requestId);
  if (!detail) {
    return null;
  }

  const stageGate = evaluateWorkflowStageGate(detail);
  if (stageGate.status !== "ready") {
    return null;
  }

  const nextAgent = getNextAgentRole(detail.request, detail.runs);
  if (!nextAgent) {
    return null;
  }

  try {
    return dispatchNextAgent({
      requestId,
      agentRole: nextAgent,
      actor: "control-plane:auto",
    });
  } catch (error) {
    appendAuditEvent(
      requestId,
      "agent.auto_dispatch_skipped",
      error instanceof Error ? error.message : "Automatic dispatch failed.",
      {
        actor: "control-plane:auto",
        metadata: { nextAgent },
      },
    );
    return null;
  }
}

export function updateRequestStage(
  requestId: string,
  status: WorkflowStage,
) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workflow_requests SET status = ?, updated_at = ? WHERE request_id = ?`,
    )
    .run(status, now, requestId);
}

export function linkPullRequestToWorkflow(input: {
  requestId: string;
  pullRequestId: number;
  webUrl: string;
  actor?: string;
}) {
  const request = getRequest(input.requestId);
  if (!request) {
    throw new Error("Request not found.");
  }

  if (!Number.isInteger(input.pullRequestId) || input.pullRequestId <= 0) {
    throw new Error("pullRequestId must be a positive integer.");
  }

  if (!input.webUrl.trim()) {
    throw new Error("webUrl is required after Azure PR verification.");
  }

  validatePullRequestLinkTarget(request);

  const existingLink = getPullRequestLink(input.requestId, input.pullRequestId);
  if (existingLink) {
    if (request.status === "pr_ready") {
      updateRequestStage(input.requestId, "pr_created");
    }
    return existingLink;
  }

  const now = new Date().toISOString();
  const link: AzurePullRequestLink = {
    id: randomUUID(),
    requestId: input.requestId,
    pullRequestId: input.pullRequestId,
    webUrl: input.webUrl.trim(),
    createdAt: now,
  };

  getDatabase()
    .prepare(
      `INSERT INTO azure_pr_links (
        id,
        request_id,
        pull_request_id,
        web_url,
        created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      link.id,
      link.requestId,
      link.pullRequestId,
      link.webUrl,
      link.createdAt,
    );
  if (request.status === "pr_ready") {
    updateRequestStage(input.requestId, "pr_created");
  }
  appendAuditEvent(
    input.requestId,
    "azure.pr.linked",
    `Azure PR #${input.pullRequestId} linked to workflow request.`,
    {
      actor: input.actor ?? "control-plane",
      metadata: { pullRequestId: input.pullRequestId, webUrl: link.webUrl },
    },
  );

  return link;
}

function validatePullRequestLinkTarget(request: WorkflowRequest) {
  if (request.deliveryMode !== "draft_pr") {
    throw new Error("Only draft PR delivery requests can link Azure PRs.");
  }

  if (request.status !== "pr_ready" && request.status !== "pr_created") {
    throw new Error(
      "Azure PR links can only be recorded after the request reaches PR Ready.",
    );
  }
}

function listRunsForRequest(requestId: string): WorkerRun[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM worker_runs
       WHERE request_id = ?
       ORDER BY created_at ASC`,
    )
    .all(requestId)
    .map(mapRunRow);
}

function updateRequestInterpretation(
  requestId: string,
  interpretation: RequestInterpretation,
) {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `UPDATE workflow_requests
       SET kind = ?,
           title = ?,
           task_level = ?,
           analysis_json = ?,
           updated_at = ?
       WHERE request_id = ?`,
    )
    .run(
      interpretation.kind,
      interpretation.title,
      interpretation.taskLevel,
      JSON.stringify(interpretation),
      now,
      requestId,
    );
}

function listAuditEvents(requestId: string): AuditEvent[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM audit_events
       WHERE request_id = ?
       ORDER BY created_at DESC`,
    )
    .all(requestId)
    .map(mapAuditRow);
}

function listPullRequestLinks(requestId: string): AzurePullRequestLink[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM azure_pr_links
       WHERE request_id = ?
       ORDER BY created_at DESC`,
    )
    .all(requestId)
    .map(mapPullRequestLinkRow);
}

function listRequestAttachments(requestId: string): RequestAttachment[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM request_attachments
       WHERE request_id = ?
       ORDER BY created_at ASC`,
    )
    .all(requestId)
    .map(mapAttachmentRow);
}

function getPullRequestLink(
  requestId: string,
  pullRequestId: number,
): AzurePullRequestLink | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM azure_pr_links
       WHERE request_id = ? AND pull_request_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(requestId, pullRequestId);

  return row ? mapPullRequestLinkRow(row) : null;
}

function appendAuditEvent(
  requestId: string,
  eventType: string,
  message: string,
  options: { actor?: string; metadata?: unknown } = {},
) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO audit_events (
        id,
        request_id,
        event_type,
        message,
        actor,
        metadata,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      requestId,
      eventType,
      message,
      options.actor ?? "control-plane",
      JSON.stringify(options.metadata ?? {}),
      now,
    );
}

function updateRequestUpdatedAt(requestId: string, updatedAt = new Date().toISOString()) {
  getDatabase()
    .prepare(`UPDATE workflow_requests SET updated_at = ? WHERE request_id = ?`)
    .run(updatedAt, requestId);
}

function requireWorker(workerId: string): WorkerRegistration {
  const row = getDatabase()
    .prepare(`SELECT * FROM workers WHERE worker_id = ?`)
    .get(workerId);

  if (!row) {
    throw new Error(`Worker "${workerId}" is not registered.`);
  }

  return mapWorkerRow(row);
}

function requireRun(runId: string): WorkerRun {
  const row = getDatabase()
    .prepare(`SELECT * FROM worker_runs WHERE run_id = ?`)
    .get(runId);

  if (!row) {
    throw new Error("Worker run not found.");
  }

  return mapRunRow(row);
}

function markWorkerSeen(workerId: string) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE workers
       SET status = 'active', last_seen_at = ?, updated_at = ?
       WHERE worker_id = ?`,
    )
    .run(now, now, workerId);
}

function getDatabase() {
  if (database) {
    return database;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workflow_requests (
      request_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      task_level TEXT NOT NULL,
      owner TEXT NOT NULL,
      assigned_worker_id TEXT NOT NULL,
      repo_path TEXT NOT NULL DEFAULT '',
      delivery_mode TEXT NOT NULL DEFAULT 'draft_pr',
      evidence_mode TEXT NOT NULL DEFAULT 'standard',
      input_template_id TEXT NOT NULL DEFAULT 'freeform',
      status TEXT NOT NULL,
      azure_reference_type TEXT NOT NULL,
      azure_reference_id TEXT NOT NULL,
      azure_reference_json TEXT NOT NULL DEFAULT '{}',
      analysis_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      command_template TEXT NOT NULL,
      auto_commit_pr INTEGER NOT NULL DEFAULT 0,
      sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
      codex_ready INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'unknown',
      codex_error TEXT NOT NULL DEFAULT '',
      codex_diagnostic_code TEXT NOT NULL DEFAULT 'unknown',
      codex_executable_path TEXT NOT NULL DEFAULT '',
      codex_checked_at TEXT,
      readiness_check_requested_at TEXT,
      codex_setup_requested_at TEXT,
      repository_candidates_json TEXT NOT NULL DEFAULT '[]',
      repository_candidates_updated_at TEXT,
      token_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker_runs (
      run_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      repo_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      retry_of_run_id TEXT NOT NULL DEFAULT '',
      dispatch_reason TEXT NOT NULL DEFAULT 'normal',
      packet TEXT NOT NULL,
      command_output TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      artifact TEXT NOT NULL,
      error TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      actor TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS azure_pr_links (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      pull_request_id INTEGER NOT NULL,
      web_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_attachments (
      attachment_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'intake',
      recovery_of_run_id TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(
    database,
    "workflow_requests",
    "analysis_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    database,
    "workflow_requests",
    "repo_path",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    database,
    "workflow_requests",
    "delivery_mode",
    "TEXT NOT NULL DEFAULT 'draft_pr'",
  );
  ensureColumn(
    database,
    "workflow_requests",
    "evidence_mode",
    "TEXT NOT NULL DEFAULT 'standard'",
  );
  ensureColumn(
    database,
    "workflow_requests",
    "input_template_id",
    "TEXT NOT NULL DEFAULT 'freeform'",
  );
  ensureColumn(
    database,
    "request_attachments",
    "purpose",
    "TEXT NOT NULL DEFAULT 'intake'",
  );
  ensureColumn(
    database,
    "request_attachments",
    "recovery_of_run_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    database,
    "request_attachments",
    "actor",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    database,
    "workflow_requests",
    "azure_reference_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    database,
    "workers",
    "auto_commit_pr",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "workers",
    "repository_candidates_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  ensureColumn(
    database,
    "workers",
    "repository_candidates_updated_at",
    "TEXT",
  );
  ensureColumn(
    database,
    "workers",
    "sandbox_mode",
    "TEXT NOT NULL DEFAULT 'workspace-write'",
  );
  ensureColumn(
    database,
    "workers",
    "codex_ready",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "workers",
    "codex_status",
    "TEXT NOT NULL DEFAULT 'unknown'",
  );
  ensureColumn(
    database,
    "workers",
    "codex_error",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    database,
    "workers",
    "codex_diagnostic_code",
    "TEXT NOT NULL DEFAULT 'unknown'",
  );
  ensureColumn(
    database,
    "workers",
    "codex_executable_path",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(database, "workers", "codex_checked_at", "TEXT");
  ensureColumn(database, "workers", "readiness_check_requested_at", "TEXT");
  ensureColumn(database, "workers", "codex_setup_requested_at", "TEXT");
  ensureColumn(database, "worker_runs", "repo_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "worker_runs", "retry_of_run_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    database,
    "worker_runs",
    "dispatch_reason",
    "TEXT NOT NULL DEFAULT 'normal'",
  );

  return database;
}

function getLatestUpdatedAt(rows: Array<Record<string, unknown>>) {
  return rows.reduce((latest, row) => {
    const value = typeof row.updated_at === "string" ? row.updated_at : "";
    return value > latest ? value : latest;
  }, "");
}

function mapRequestRow(row: unknown): WorkflowRequest {
  const value = row as Record<string, string>;

  return {
    requestId: value.request_id,
    kind: value.kind as WorkflowRequest["kind"],
    title: value.title,
    detail: value.detail,
    taskLevel: value.task_level as WorkflowRequest["taskLevel"],
    owner: value.owner,
    assignedWorkerId: value.assigned_worker_id,
    repoPath: value.repo_path ?? "",
    deliveryMode: normalizeDeliveryMode(value.delivery_mode),
    evidenceMode: normalizeRequestEvidenceMode(value.evidence_mode),
    templateId: normalizeRequestInputTemplateId(value.input_template_id),
    status: value.status as WorkflowStage,
    azureReferenceType:
      value.azure_reference_type as WorkflowRequest["azureReferenceType"],
    azureReferenceId: value.azure_reference_id,
    azureReferenceEvidence: parseAzureReferenceEvidence(
      value.azure_reference_json,
      value.azure_reference_type as WorkflowRequest["azureReferenceType"],
      value.azure_reference_id,
    ),
    interpretation: parseInterpretation(value.analysis_json, value.detail),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function parseInterpretation(value: unknown, detail: string) {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return normalizeRequestInterpretation(parsed, { fallbackDetail: detail });
    } catch {
      // Fall through to deterministic reconstruction.
    }
  }

  return normalizeRequestInterpretation(null, { fallbackDetail: detail });
}

function parseAzureReferenceEvidence(
  value: unknown,
  referenceType: WorkflowRequest["azureReferenceType"],
  referenceId: string,
) {
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeAzureReferenceEvidence(
        JSON.parse(value),
        referenceType,
        referenceId,
      );
    } catch {
      // Fall through to a tracking-only snapshot.
    }
  }

  return normalizeAzureReferenceEvidence(null, referenceType, referenceId);
}

function normalizeRequestEvidenceMode(
  value: unknown,
): WorkflowRequest["evidenceMode"] {
  return value === "ui_only" ? "ui_only" : "standard";
}

function mapWorkerRow(row: unknown): WorkerRegistration {
  const value = row as Record<string, string | number | null>;

  return {
    workerId: String(value.worker_id),
    displayName: String(value.display_name),
    repoPath: String(value.repo_path ?? ""),
    commandTemplate: String(value.command_template ?? ""),
    autoCommitAndPr: value.auto_commit_pr === 1 || value.auto_commit_pr === "1",
    sandboxMode: normalizeSandboxMode(value.sandbox_mode),
    codexReady: value.codex_ready === 1 || value.codex_ready === "1",
    codexStatus: normalizeCodexStatus(value.codex_status),
    codexError: String(value.codex_error ?? ""),
    codexDiagnosticCode: normalizeCodexDiagnosticCode(
      value.codex_diagnostic_code,
    ),
    codexExecutablePath: String(value.codex_executable_path ?? ""),
    codexCheckedAt: value.codex_checked_at
      ? String(value.codex_checked_at)
      : null,
    readinessCheckRequestedAt: value.readiness_check_requested_at
      ? String(value.readiness_check_requested_at)
      : null,
    codexSetupRequestedAt: value.codex_setup_requested_at
      ? String(value.codex_setup_requested_at)
      : null,
    repositoryCandidates: parseRepositoryCandidates(
      value.repository_candidates_json,
    ),
    repositoryCandidatesUpdatedAt: value.repository_candidates_updated_at
      ? String(value.repository_candidates_updated_at)
      : null,
    status:
      value.status === "active"
        ? "active"
        : value.status === "disabled"
          ? "disabled"
          : "registered",
    lastSeenAt: value.last_seen_at ? String(value.last_seen_at) : null,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function normalizeRepositoryCandidates(
  input: WorkerRepositoryCandidateInput[],
): RepositoryCandidate[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return uniqueRepositoryCandidates(
    input
      .map((candidate) => ({
        name: typeof candidate.name === "string" ? candidate.name.trim() : "",
        path: typeof candidate.path === "string" ? candidate.path.trim() : "",
        source:
          typeof candidate.source === "string" ? candidate.source.trim() : "",
      }))
      .filter((candidate) => candidate.name && candidate.path)
      .slice(0, 50),
  );
}

function normalizeWorkerCodexReadiness(
  input: WorkerCodexReadinessInput | undefined,
) {
  const codexStatus = normalizeCodexStatus(input?.codexStatus);
  const codexReady = input?.codexReady === true && codexStatus === "ready";
  const codexCheckedAt =
    typeof input?.codexCheckedAt === "string" && input.codexCheckedAt.trim()
      ? input.codexCheckedAt.trim()
      : new Date().toISOString();

  return {
    codexReady,
    codexStatus: codexReady ? "ready" : codexStatus,
    codexError:
      typeof input?.codexError === "string" ? input.codexError.trim() : "",
    codexDiagnosticCode: codexReady
      ? "ready"
      : normalizeCodexDiagnosticCode(input?.codexDiagnosticCode),
    codexExecutablePath:
      typeof input?.codexExecutablePath === "string"
        ? input.codexExecutablePath.trim()
        : "",
    codexCheckedAt,
  };
}

function normalizeCodexStatus(
  value: unknown,
): WorkerRegistration["codexStatus"] {
  if (
    value === "ready" ||
    value === "missing-command" ||
    value === "command-failed"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeCodexDiagnosticCode(
  value: unknown,
): WorkerRegistration["codexDiagnosticCode"] {
  if (
    value === "ready" ||
    value === "missing-command" ||
    value === "cli-missing" ||
    value === "desktop-internal-not-cli" ||
    value === "cli-command-failed"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeSandboxMode(
  value: unknown,
): WorkerRegistration["sandboxMode"] {
  return value === "danger-full-access" ? value : DEFAULT_SANDBOX_MODE;
}

function normalizeDeliveryMode(value: unknown): DeliveryMode {
  return value === "no_pr" ? "no_pr" : "draft_pr";
}

function buildDefaultCodexCommandTemplate(
  sandboxMode: WorkerRegistration["sandboxMode"],
) {
  return `codex exec --skip-git-repo-check --sandbox ${sandboxMode} - < {packetFile}`;
}

function parseRepositoryCandidates(value: unknown): RepositoryCandidate[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    return normalizeRepositoryCandidates(JSON.parse(value));
  } catch {
    return [];
  }
}

function uniqueRepositoryCandidates(
  candidates: RepositoryCandidate[],
): RepositoryCandidate[] {
  const seen = new Set<string>();
  const result: RepositoryCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(candidate);
  }

  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function mapRunRow(row: unknown): WorkerRun {
  const value = row as Record<string, string | null>;

  return {
    runId: String(value.run_id),
    requestId: String(value.request_id),
    agentRole: value.agent_role as AgentRole,
    workerId: String(value.worker_id),
    repoPath: String(value.repo_path ?? ""),
    status: value.status as WorkerRunStatus,
    retryOfRunId: String(value.retry_of_run_id ?? ""),
    dispatchReason: normalizeDispatchReason(value.dispatch_reason),
    packet: String(value.packet),
    commandOutput: String(value.command_output ?? ""),
    diffSummary: String(value.diff_summary ?? ""),
    artifact: String(value.artifact ?? ""),
    error: String(value.error ?? ""),
    createdAt: String(value.created_at),
    startedAt: value.started_at ? String(value.started_at) : null,
    completedAt: value.completed_at ? String(value.completed_at) : null,
    updatedAt: String(value.updated_at),
  };
}

function mapAuditRow(row: unknown): AuditEvent {
  const value = row as Record<string, string>;

  return {
    id: value.id,
    requestId: value.request_id,
    eventType: value.event_type,
    message: value.message,
    actor: value.actor,
    metadata: value.metadata,
    createdAt: value.created_at,
  };
}

function mapPullRequestLinkRow(row: unknown): AzurePullRequestLink {
  const value = row as Record<string, string | number>;

  return {
    id: String(value.id),
    requestId: String(value.request_id),
    pullRequestId: Number(value.pull_request_id),
    webUrl: String(value.web_url ?? ""),
    createdAt: String(value.created_at),
  };
}

function mapAttachmentRow(row: unknown): RequestAttachment {
  const value = row as Record<string, string | number>;

  return {
    attachmentId: String(value.attachment_id),
    requestId: String(value.request_id),
    filename: String(value.filename),
    contentType: String(value.content_type),
    sizeBytes: Number(value.size_bytes),
    storagePath: String(value.storage_path),
    purpose: normalizeAttachmentPurpose(value.purpose),
    recoveryOfRunId: String(value.recovery_of_run_id ?? ""),
    actor: String(value.actor ?? ""),
    createdAt: String(value.created_at),
  };
}

function normalizeAttachmentPurpose(value: unknown): RequestAttachmentPurpose {
  return value === "clarification" ? "clarification" : "intake";
}

function normalizeDispatchReason(value: unknown): WorkerRunDispatchReason {
  if (
    value === "auto_repair" ||
    value === "manual_retry" ||
    value === "clarification_retry"
  ) {
    return value;
  }

  return "normal";
}

function normalizeCompleteStatus(
  status: WorkerRunStatus,
): Exclude<WorkerRunStatus, "queued" | "running"> {
  if (status === "completed" || status === "failed" || status === "blocked") {
    return status;
  }

  throw new Error("Worker run completion status must be completed, failed, or blocked.");
}

function getWorkerInterpretationFromCompletion(
  input: CompleteWorkerRunInput,
  artifact: string,
  fallbackDetail: string,
) {
  if (input.interpretation) {
    return normalizeRequestInterpretation(input.interpretation, {
      fallbackDetail,
      source: "worker",
    });
  }

  return extractWorkerInterpretationFromText(
    [input.commandOutput ?? "", artifact].join("\n\n"),
    fallbackDetail,
  );
}

function ensureColumn(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: string;
  }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function createWorkerToken() {
  return `cw_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requireTrimmed(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
}

function sanitizeAttachmentFilename(value: string) {
  const filename = path.basename(value.trim()).replace(/[^\w.\- ]+/g, "_");
  return filename || "pasted-image";
}
