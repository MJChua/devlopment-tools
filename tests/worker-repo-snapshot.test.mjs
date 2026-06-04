import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("request repo snapshot is reused across agent runs", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "control-plane-db-"));
  process.env.CONTROL_PLANE_DB_PATH = path.join(tempDir, "snapshot.sqlite");
  process.env.CONTROL_PLANE_ATTACHMENT_DIR = path.join(tempDir, "attachments");

  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: "worker-1",
    displayName: "Worker 1",
    commandTemplate: "echo ok",
  });
  const repoA = "C:\\workspace\\repo-a";
  const repoB = "C:\\workspace\\repo-b";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [
      { name: "repo-a", path: repoA, source: "scan" },
      { name: "repo-b", path: repoB, source: "scan" },
    ],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath: repoA });

  const request = createRequest({
    detail: "Add a filter.",
    assignedWorkerId: worker.workerId,
    repoPath: repoA,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  assert.equal(agent0.repoPath, repoA);

  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath: repoB });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const detail = getRequestDetail(request.requestId);
  const agent1 = detail.runs.find((run) => run.agentRole === "agent1");
  assert.equal(detail.request.status, "source_check");
  assert.equal(agent1?.status, "queued");
  assert.equal(agent1?.repoPath, repoA);
});

test("no-PR workflow auto-dispatches through Agent3 and then delivers", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: "worker-2",
    displayName: "Worker 2",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-no-pr";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-no-pr", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Update my personal project.",
    assignedWorkerId: worker.workerId,
    repoPath,
    deliveryMode: "no_pr",
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });

  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent0.runId,
    completedAgent: "agent0",
    nextAgent: "agent1",
  });
  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent1.runId,
    completedAgent: "agent1",
    nextAgent: "agent2",
  });
  const agent2 = getRun(getRequestDetail(request.requestId), "agent2");
  assert.match(agent2.packet, /### Agent 1: Source & Scope Handoff Summary/);
  assert.match(agent2.packet, /Artifact title: Source Check Report/);
  assert.match(
    agent2.packet,
    /do not add, delete, or modify files outside that scope/i,
  );
  assert.doesNotMatch(agent2.packet, /## Fallback User Request/);
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent2.runId,
    completedAgent: "agent2",
    nextAgent: "agent3",
  });
  const agent3 = getRun(getRequestDetail(request.requestId), "agent3");
  assert.match(agent3.packet, /### Agent 1: Source & Scope Handoff Summary/);
  assert.match(
    agent3.packet,
    /### Agent 2: Controlled Implementation Handoff Summary/,
  );
  assert.match(agent3.packet, /Artifact title: Implementation Result/);
  assert.match(agent3.packet, /Flag unapproved file creation/);
  assert.doesNotMatch(agent3.packet, /## Fallback User Request/);
  completeWorkerRun(worker.workerId, worker.token, agent3.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: sampleCompletedArtifact("agent3"),
  });

  const delivered = getRequestDetail(request.requestId);
  assert.equal(delivered.request.status, "delivered");
  assert.equal(
    delivered.runs.filter((run) => run.status === "queued").length,
    0,
  );
});

test("Agent3 block review keeps request blocked instead of PR ready", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: `worker-agent3-block-${randomUUID()}`,
    displayName: "Agent3 Block Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-agent3-block";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-agent3-block", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Add MJ to topbar.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: verifiedAzureReferenceEvidence("795"),
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent0.runId,
    completedAgent: "agent0",
    nextAgent: "agent1",
  });
  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent1.runId,
    completedAgent: "agent1",
    nextAgent: "agent2",
  });
  const agent2 = getRun(getRequestDetail(request.requestId), "agent2");
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent2.runId,
    completedAgent: "agent2",
    nextAgent: "agent3",
  });
  const agent3 = getRun(getRequestDetail(request.requestId), "agent3");

  completeWorkerRun(worker.workerId, worker.token, agent3.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "dirty branch",
    artifact: sampleAgent3BlockedArtifact(),
  });

  const blocked = getRequestDetail(request.requestId);
  const blockedRun = getRun(blocked, "agent3");
  assert.equal(blockedRun.status, "blocked");
  assert.equal(blocked.request.status, "blocked");
  assert.match(blockedRun.error, /delivery review blocked PR readiness/i);
});

test("Agent3 uses Agent2 execution repo path when worker reports a request worktree", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    heartbeatWorkerRun,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: `worker-worktree-path-${randomUUID()}`,
    displayName: "Worktree Path Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-worktree-source";
  const worktreePath = "C:\\workspace\\.codex-request-worktrees\\REQ-test";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-worktree-source", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    title: `Resume snapshot ${randomUUID()}`,
    detail: "Add UI copy.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: verifiedAzureReferenceEvidence("795"),
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent0.runId,
    completedAgent: "agent0",
    nextAgent: "agent1",
  });
  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent1.runId,
    completedAgent: "agent1",
    nextAgent: "agent2",
  });
  const agent2 = getRun(getRequestDetail(request.requestId), "agent2");

  heartbeatWorkerRun(worker.workerId, worker.token, agent2.runId, {
    progressLabel: "Preparing request worktree",
    executionRepoPath: worktreePath,
  });
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent2.runId,
    completedAgent: "agent2",
    nextAgent: "agent3",
  });

  const agent3 = getRun(getRequestDetail(request.requestId), "agent3");
  assert.equal(agent3.repoPath, worktreePath);
  assert.match(agent3.packet, new RegExp(escapeRegExp(worktreePath)));
});

test("request resume snapshot and packet pressure metadata persist across dispatch", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: `worker-resume-snapshot-${randomUUID()}`,
    displayName: "Resume Snapshot Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-resume-snapshot";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-resume-snapshot", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Add UI copy.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: verifiedAzureReferenceEvidence("795"),
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent0.runId,
    completedAgent: "agent0",
    nextAgent: "agent1",
  });
  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeAndAssertNext({
    completeWorkerRun,
    getRequestDetail,
    requestId: request.requestId,
    worker,
    runId: agent1.runId,
    completedAgent: "agent1",
    nextAgent: "agent2",
  });

  const detail = getRequestDetail(request.requestId);
  const agent2 = getRun(detail, "agent2");

  assert.deepEqual(detail.request.resumeSnapshot.allowedFiles, ["src/**", "tests/**"]);
  assert.match(detail.request.resumeSnapshot.latestBlocker, /^$/);
  assert.equal(detail.request.resumeSnapshot.executionRepoPath, repoPath);
  assert(agent2.packetSizeChars > 0);
  assert.equal(agent2.priorHandoffCount, 1);
  assert.equal(agent2.usedResumeSnapshot, true);
  assert.equal(agent2.isRetryContext, false);
  assert.match(agent2.packet, /## Request Resume Snapshot/);
});

test("clarification retry updates snapshot and only reruns the blocked agent context", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    recoverWorkflowRequest,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const worker = registerWorker({
    workerId: `worker-retry-snapshot-${randomUUID()}`,
    displayName: "Retry Snapshot Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-retry-snapshot";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-retry-snapshot", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    title: `Retry snapshot ${randomUUID()}`,
    detail: "Add MJ to the top menu bar.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });
  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "blocked",
    commandOutput: "blocked",
    diffSummary: "clean",
    artifact: "# Source Check Report\n\n## Can Proceed\nno",
    error: "Need to know whether admin-agent or admin-hq is the target.",
  });

  const retry = recoverWorkflowRequest({
    requestId: request.requestId,
    action: "clarify_and_retry",
    runId: agent1.runId,
    clarification: "Use admin-agent.",
  });
  const detail = getRequestDetail(request.requestId);
  const retryRun = detail.runs.find((run) => run.runId === retry.runId);

  assert.equal(detail.request.resumeSnapshot.latestClarification, "Use admin-agent.");
  assert.match(
    detail.request.resumeSnapshot.latestBlocker,
    /admin-agent or admin-hq/,
  );
  assert.equal(retryRun.agentRole, "agent1");
  assert.equal(retryRun.isRetryContext, true);
  assert.match(retryRun.packet, /## Recovery Context/);
  assert.match(retryRun.packet, /Operator clarification:\nUse admin-agent\./);
  assert.doesNotMatch(retryRun.packet, /Implementation Result/);
  assert.doesNotMatch(retryRun.packet, /Delivery Report/);
});

test("incomplete Agent1 handoff auto-repairs once and recovery reruns same Agent", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    recoverWorkflowRequest,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-incomplete-handoff-${suffix}`,
    displayName: "Incomplete Handoff Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-incomplete-handoff";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [
      { name: "repo-incomplete-handoff", path: repoPath, source: "scan" },
    ],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Update the member filter only.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- Add a member filter.",
      "",
      "## Can Proceed",
      "yes",
    ].join("\n"),
  });

  const repairing = getRequestDetail(request.requestId);
  const firstAgent1Runs = getRuns(repairing, "agent1");
  const blockedAgent1 = firstAgent1Runs[0];
  const autoRepairAgent1 = firstAgent1Runs[1];

  assert.equal(repairing.request.status, "source_check");
  assert.equal(blockedAgent1.status, "blocked");
  assert.match(blockedAgent1.error, /Missing required fields/);
  assert.equal(autoRepairAgent1.status, "queued");
  assert.equal(autoRepairAgent1.retryOfRunId, blockedAgent1.runId);
  assert.equal(autoRepairAgent1.dispatchReason, "auto_repair");
  assert.match(autoRepairAgent1.packet, /Recovery Context/);
  assert.equal(
    repairing.runs.some((run) => run.agentRole === "agent2"),
    false,
  );

  completeWorkerRun(worker.workerId, worker.token, autoRepairAgent1.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Source Check Report\n\n## Confirmed Requirements\n- still incomplete",
  });

  const afterAutoRepair = getRequestDetail(request.requestId);
  const secondAgent1Runs = getRuns(afterAutoRepair, "agent1");
  const failedAutoRepair = secondAgent1Runs[1];

  assert.equal(afterAutoRepair.request.status, "blocked");
  assert.equal(secondAgent1Runs.length, 2);
  assert.equal(failedAutoRepair.status, "blocked");
  assert.equal(failedAutoRepair.dispatchReason, "auto_repair");

  const manualRetry = recoverWorkflowRequest({
    requestId: request.requestId,
    action: "retry_same_agent",
    runId: failedAutoRepair.runId,
    actor: "test",
  });

  assert.equal(manualRetry.agentRole, "agent1");
  assert.equal(manualRetry.retryOfRunId, failedAutoRepair.runId);
  assert.equal(manualRetry.dispatchReason, "manual_retry");

  completeWorkerRun(worker.workerId, worker.token, manualRetry.runId, {
    status: "blocked",
    commandOutput: "source missing",
    diffSummary: "clean",
    artifact: "# Worker Blocked\n\nMissing source.",
    error: "Missing confirmed source.",
  });

  const clarificationRetry = recoverWorkflowRequest({
    requestId: request.requestId,
    action: "clarify_and_retry",
    runId: manualRetry.runId,
    clarification: "Use Azure work item 795 as the confirmed source.",
    actor: "test",
  });

  const afterClarification = getRequestDetail(request.requestId);

  assert.equal(clarificationRetry.agentRole, "agent1");
  assert.equal(clarificationRetry.retryOfRunId, manualRetry.runId);
  assert.equal(clarificationRetry.dispatchReason, "clarification_retry");
  assert.match(clarificationRetry.packet, /Operator clarification/);
  assert.equal(
    afterClarification.runs.some((run) => run.agentRole === "agent2"),
    false,
  );
});

test("request image attachments are stored and included in Agent0 and Agent1 packets", async () => {
  const {
    completeWorkerRun,
    createRequest,
    createRequestAttachment,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-attachments-${suffix}`,
    displayName: "Attachment Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-attachments";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-attachments", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Use the attached screenshot as intake evidence.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const attachment = createRequestAttachment({
    requestId: request.requestId,
    filename: "screen.png",
    contentType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const detail = getRequestDetail(request.requestId);

  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].attachmentId, attachment.attachmentId);
  assert.equal(detail.attachments[0].purpose, "intake");
  assert.match(detail.attachments[0].storagePath, /request-attachments|attachments/);

  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  assert.match(agent0.packet, /## User Attachments/);
  assert.match(agent0.packet, /screen\.png \(image\/png, 4 bytes\)/);
  assert.match(agent0.packet, /intake evidence for Agent1 to validate/);

  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  assert.match(agent1.packet, /## User Attachments/);
  assert.match(agent1.packet, /screen\.png \(image\/png, 4 bytes\)/);
});

test("clarification attachments are stored and included in recovery packet", async () => {
  const {
    completeWorkerRun,
    createRequest,
    createRequestAttachment,
    dispatchNextAgent,
    getRequestDetail,
    recoverWorkflowRequest,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-clarification-attachment-${suffix}`,
    displayName: "Clarification Attachment Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-clarification-attachment";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [
      { name: "repo-clarification-attachment", path: repoPath, source: "scan" },
    ],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Fix the UI label using clarification screenshot.",
    assignedWorkerId: worker.workerId,
    repoPath,
    evidenceMode: "ui_only",
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "blocked",
    commandOutput: "blocked",
    diffSummary: "clean",
    artifact: "# Source Check Report\n\n## Can Proceed\nno",
    error: "Missing expected visual result.",
  });

  const blockedRun = getRun(getRequestDetail(request.requestId), "agent1");
  const attachment = createRequestAttachment({
    requestId: request.requestId,
    filename: "clarification.png",
    contentType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    purpose: "clarification",
    recoveryOfRunId: blockedRun.runId,
    actor: "qa-user",
  });
  const detail = getRequestDetail(request.requestId);

  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].purpose, "clarification");
  assert.equal(detail.attachments[0].recoveryOfRunId, blockedRun.runId);
  assert.equal(detail.attachments[0].actor, "qa-user");

  assert.throws(
    () =>
      recoverWorkflowRequest({
        requestId: request.requestId,
        action: "clarify_and_retry",
        runId: blockedRun.runId,
        clarificationAttachmentIds: ["not-this-request"],
        actor: "qa-user",
      }),
    /does not belong to this request/,
  );

  const retry = recoverWorkflowRequest({
    requestId: request.requestId,
    action: "clarify_and_retry",
    runId: blockedRun.runId,
    clarificationAttachmentIds: [attachment.attachmentId],
    actor: "qa-user",
  });

  assert.equal(retry.dispatchReason, "clarification_retry");
  assert.match(retry.packet, /Operator clarification attachments/);
  assert.match(retry.packet, /clarification\.png \(image\/png, 4 bytes\)/);
});

test("request evidence mode and Azure snapshot are persisted into packets", async () => {
  const {
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-evidence-${suffix}`,
    displayName: "Evidence Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-evidence";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-evidence", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Use the screenshot for a UI-only visual adjustment.",
    assignedWorkerId: worker.workerId,
    repoPath,
    deliveryMode: "draft_pr",
    evidenceMode: "ui_only",
    templateId: "ui_visual",
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: {
      status: "verified",
      referenceType: "work-item",
      referenceId: "795",
      checkedAt: "2026-05-28T03:00:00.000Z",
      title: "Header role label",
      workItemType: "Bug",
      workItemState: "Active",
      assignedTo: "QA",
      areaPath: "Project",
      iterationPath: "Project\\Sprint 1",
      webUrl: "https://dev.azure.com/org/project/_workitems/edit/795",
      summary: "Header role label",
      error: "",
    },
  });

  const detail = getRequestDetail(request.requestId);
  assert.equal(detail.request.evidenceMode, "ui_only");
  assert.equal(detail.request.templateId, "ui_visual");
  assert.equal(detail.request.azureReferenceEvidence.status, "verified");
  assert.equal(detail.request.azureReferenceEvidence.title, "Header role label");

  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  assert.match(agent0.packet, /Evidence Mode: UI-only visual evidence/);
  assert.match(agent0.packet, /Input Template: ui_visual/);
  assert.match(agent0.packet, /## Verified Azure Work Item Evidence/);
  assert.match(agent0.packet, /Title: Header role label/);
});

test("Agent1 structured command output fixes generic worker artifact", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-command-output-${suffix}`,
    displayName: "Command Output Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-command-output";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-command-output", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Fix a generic artifact handoff.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: verifiedAzureReferenceEvidence("795"),
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "completed",
    commandOutput: [
      "codex logs before final answer",
      sampleCompletedArtifact("agent1"),
    ].join("\n\n"),
    diffSummary: "clean",
    artifact: "# agent1 Worker Result\n\n## Diff Summary\n\nclean",
  });

  const detail = getRequestDetail(request.requestId);
  const completedAgent1 = getRun(detail, "agent1");
  const agent2 = getRun(detail, "agent2");

  assert.equal(completedAgent1.status, "completed");
  assert.match(completedAgent1.artifact, /# Source Check Report/);
  assert.match(completedAgent1.artifact, /## Worker Execution Summary/);
  assert.equal(detail.request.status, "running");
  assert.equal(agent2.status, "queued");
});

test("Agent1 Can Proceed no blocks without schema auto-repair", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    getStageGate,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-can-proceed-no-${suffix}`,
    displayName: "Can Proceed No Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-can-proceed-no";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-can-proceed-no", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Implement only after source confirmation.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: sampleBlockedSourceCheckArtifact(),
  });

  const detail = getRequestDetail(request.requestId);
  const blockedAgent1 = getRun(detail, "agent1");
  const stageGate = getStageGate(request.requestId);

  assert.equal(blockedAgent1.status, "blocked");
  assert.match(blockedAgent1.error, /source check cannot proceed/);
  assert.equal(detail.request.status, "blocked");
  assert.equal(detail.runs.some((run) => run.agentRole === "agent2"), false);
  assert.equal(stageGate.needsClarification, true);
  assert.equal(stageGate.recoveryKind, "agent_blocked");
});

test("Agent1 quick clarification selection retries same agent", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    getStageGate,
    recoverWorkflowRequest,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-quick-clarification-${suffix}`,
    displayName: "Quick Clarification Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-quick-clarification";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-quick-clarification", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: '於 top menu bar 最右側新增字樣 "MJ"',
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: sampleMultiCandidateSourceCheckArtifact(),
  });

  const stageGate = getStageGate(request.requestId);
  assert.equal(stageGate.clarificationPrompt?.title, "選擇目標子專案");
  assert.equal(stageGate.clarificationPrompt?.questions[0].options.length, 3);

  const retry = recoverWorkflowRequest({
    requestId: request.requestId,
    runId: agent1.runId,
    action: "clarify_and_retry",
    clarification:
      "快速確認：\n- 要改哪個子專案？: admin-agent\n  目標子專案：apps/admin-agent-web；目標元件：AgentTopBar。",
  });

  assert.equal(retry.agentRole, "agent1");
  assert.equal(retry.retryOfRunId, agent1.runId);
  assert.equal(retry.dispatchReason, "clarification_retry");
  assert.match(retry.packet, /Operator clarification/);
  assert.match(retry.packet, /apps\/admin-agent-web/);
});

test("schema-blocked run can synchronize valid handoff from command output", async () => {
  const {
    completeWorkerRun,
    createRequest,
    dispatchNextAgent,
    getRequestDetail,
    recoverWorkflowRequest,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-sync-output-${suffix}`,
    displayName: "Sync Output Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-sync-output";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-sync-output", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Recover the existing command output.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "work-item",
    azureReferenceId: "795",
    azureReferenceEvidence: verifiedAzureReferenceEvidence("795"),
  });
  const agent0 = dispatchNextAgent({ requestId: request.requestId });
  completeWorkerRun(worker.workerId, worker.token, agent0.runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: "# Agent0",
  });

  const agent1 = getRun(getRequestDetail(request.requestId), "agent1");
  completeWorkerRun(worker.workerId, worker.token, agent1.runId, {
    status: "blocked",
    commandOutput: sampleCompletedArtifact("agent1"),
    diffSummary: "clean",
    artifact: "# agent1 Worker Result\n\n## Diff Summary\n\nclean",
    error:
      "Agent handoff is incomplete. Missing required fields: Confirmed Requirements.",
  });

  const beforeSync = getRequestDetail(request.requestId);
  assert.equal(getRun(beforeSync, "agent1").status, "blocked");
  assert.equal(beforeSync.request.status, "blocked");

  const synced = recoverWorkflowRequest({
    requestId: request.requestId,
    action: "sync_output",
    runId: agent1.runId,
    actor: "test",
  });
  const afterSync = getRequestDetail(request.requestId);

  assert.equal(synced.status, "completed");
  assert.match(synced.artifact, /# Source Check Report/);
  assert.equal(afterSync.request.status, "running");
  assert.equal(getRun(afterSync, "agent2").status, "queued");
});

test("worker guard blocks PAT clear while an Agent task is queued", async () => {
  const {
    assertWorkerHasNoActiveRuns,
    createRequest,
    dispatchNextAgent,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");

  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-clear-pat-${suffix}`,
    displayName: "Clear PAT Worker",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\repo-clear-pat";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "repo-clear-pat", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });

  const request = createRequest({
    detail: "Keep the worker busy.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const run = dispatchNextAgent({ requestId: request.requestId });

  assert.equal(run.status, "queued");
  assert.throws(
    () => assertWorkerHasNoActiveRuns(worker.workerId, "clear PAT"),
    /Cannot clear PAT while an Agent task is queued or running/,
  );
});

test("worker runtime metadata is stored and mismatched hashes block dispatch", async () => {
  const {
    createRequest,
    dispatchNextAgent,
    listWorkers,
    registerWorker,
    updateWorkerRepositoryCandidates,
    updateWorkerSelectedRepository,
  } = await import("../src/lib/control-plane-db.ts");
  const { getWorkerBootstrapManifest, getWorkerScriptHash } = await import(
    "../src/lib/worker-bootstrap-manifest.ts"
  );
  const manifest = getWorkerBootstrapManifest();
  const repoPath = "C:\\workspace\\worker-runtime";
  const worker = registerWorker({
    workerId: `worker-runtime-${randomUUID()}`,
    displayName: "Runtime Worker",
    commandTemplate: "echo ok",
  });

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "worker-runtime", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
    runtime: {
      workerVersion: manifest.workerVersion,
      workerScriptHash: "0".repeat(64),
      launcherVersion: "0.2.0",
      workerUpdatedAt: "2026-05-29T00:00:00.000Z",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });
  const request = createRequest({
    detail: "Dispatch should wait for a matching worker script.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });

  assert.throws(
    () => dispatchNextAgent({ requestId: request.requestId }),
    /Worker 版本不同步/,
  );

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "worker-runtime", path: repoPath, source: "scan" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
    runtime: {
      workerVersion: manifest.workerVersion,
      workerScriptHash: getWorkerScriptHash(manifest),
      launcherVersion: "0.2.0",
      workerUpdatedAt: "2026-05-29T00:00:01.000Z",
    },
  });

  {
    const db = new DatabaseSync(process.env.CONTROL_PLANE_DB_PATH);
    try {
      db.prepare(
        `UPDATE workers
         SET worker_expected_version = ?, worker_expected_script_hash = ?
         WHERE worker_id = ?`,
      ).run("old-worker-version", "0".repeat(64), worker.workerId);
    } finally {
      db.close();
    }
  }

  const refreshedWorker = listWorkers().find(
    (candidate) => candidate.workerId === worker.workerId,
  );
  assert.equal(refreshedWorker?.workerExpectedVersion, manifest.workerVersion);
  assert.equal(
    refreshedWorker?.workerExpectedScriptHash,
    getWorkerScriptHash(manifest),
  );
  assert.equal(refreshedWorker?.workerVersionStatus, "current");
  assert.equal(dispatchNextAgent({ requestId: request.requestId }).status, "queued");
});

test("PR traceability links only verified PR-ready draft PR requests", async () => {
  const {
    createRequest,
    getRequestDetail,
    linkPullRequestToWorkflow,
    recordPullRequestDiscovery,
    registerWorker,
    updateRequestStage,
  } = await import("../src/lib/control-plane-db.ts");
  const suffix = randomUUID();
  const worker = registerWorker({
    workerId: `worker-pr-${suffix}`,
    displayName: "PR Worker",
    commandTemplate: "echo ok",
  });
  const request = createRequest({
    detail: "Prepare a verified PR traceability link.",
    assignedWorkerId: worker.workerId,
    repoPath: "C:\\workspace\\repo-pr",
    deliveryMode: "draft_pr",
    azureReferenceType: "none",
    azureReferenceId: "",
  });

  assert.throws(
    () =>
      linkPullRequestToWorkflow({
        requestId: "missing-request",
        pullRequestId: 399,
        webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/399",
      }),
    /Request not found/,
  );
  assert.throws(
    () =>
      linkPullRequestToWorkflow({
        requestId: request.requestId,
        pullRequestId: 0,
        webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/399",
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      linkPullRequestToWorkflow({
        requestId: request.requestId,
        pullRequestId: 399,
        webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/399",
      }),
    /PR Ready/,
  );

  updateRequestStage(request.requestId, "pr_ready");
  const notFoundTrace = recordPullRequestDiscovery({
    requestId: request.requestId,
    trace: {
      sourceBranch: "feature/399",
      baseBranch: "develop",
      workItemId: "399",
      branchKind: "feature",
      discoveryStatus: "not_found",
      reason: "No active PR found yet.",
    },
    actor: "test",
  });
  assert.equal(notFoundTrace.discoveryStatus, "not_found");
  assert.equal(
    getRequestDetail(request.requestId).request.resumeSnapshot.prDeliveryTrace
      .sourceBranch,
    "feature/399",
  );

  const link = linkPullRequestToWorkflow({
    requestId: request.requestId,
    pullRequestId: 399,
    webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/399",
    trace: {
      sourceBranch: "feature/399",
      baseBranch: "develop",
      workItemId: "399",
      branchKind: "feature",
    },
    actor: "test",
  });
  const linked = getRequestDetail(request.requestId);

  assert.equal(linked.request.status, "pr_created");
  assert.equal(linked.prLinks.length, 1);
  assert.equal(linked.prLinks[0].id, link.id);
  assert.equal(
    linked.request.resumeSnapshot.prDeliveryTrace.discoveryStatus,
    "found",
  );

  const duplicate = linkPullRequestToWorkflow({
    requestId: request.requestId,
    pullRequestId: 399,
    webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/399",
    actor: "test",
  });
  const afterDuplicate = getRequestDetail(request.requestId);

  assert.equal(duplicate.id, link.id);
  assert.equal(afterDuplicate.prLinks.length, 1);

  const noPrRequest = createRequest({
    detail: "Complete without PR.",
    assignedWorkerId: worker.workerId,
    repoPath: "C:\\workspace\\repo-no-pr-link",
    deliveryMode: "no_pr",
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  updateRequestStage(noPrRequest.requestId, "pr_ready");

  assert.throws(
    () =>
      linkPullRequestToWorkflow({
        requestId: noPrRequest.requestId,
        pullRequestId: 400,
        webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/400",
      }),
    /draft PR delivery/,
  );
});

function completeAndAssertNext({
  completeWorkerRun,
  getRequestDetail,
  requestId,
  worker,
  runId,
  completedAgent,
  nextAgent,
}) {
  completeWorkerRun(worker.workerId, worker.token, runId, {
    status: "completed",
    commandOutput: "ok",
    diffSummary: "clean",
    artifact: sampleCompletedArtifact(completedAgent),
  });

  const detail = getRequestDetail(requestId);
  assert.equal(getRun(detail, completedAgent).status, "completed");
  assert.equal(getRun(detail, nextAgent).status, "queued");
}

function sampleCompletedArtifact(agentRole) {
  if (agentRole === "agent1") {
    return [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- Complete the requested local project update.",
      "",
      "## Confirmed Scope",
      "- Keep the change inside the selected repository request scope.",
      "",
      "## Allowed Files",
      "- src/**",
      "- tests/**",
      "",
      "## Non-Scope",
      "- No package, environment, deployment, or Azure state changes.",
      "",
      "## Do Not Touch",
      "- package.json",
      "- .env files",
      "",
      "## Can Proceed",
      "yes",
      "",
      "## Task Package For Agent2",
      "- Implement the scoped change and run targeted verification.",
    ].join("\n");
  }

  if (agentRole === "agent2") {
    return [
      "# Implementation Result",
      "",
      "## Changed Files",
      "- src/example.ts: scoped implementation placeholder.",
      "",
      "## Commands Run",
      "- pnpm test: pass.",
      "",
      "## Verification Result",
      "- pass.",
      "",
      "## Scope Compliance",
      "- No file was added, deleted, or modified outside Agent1's allowed files.",
      "",
      "## Human Decisions",
      "- none.",
    ].join("\n");
  }

  if (agentRole === "agent3") {
    return [
      "# Delivery Report",
      "",
      "## Review Result",
      "- pass: implementation evidence is acceptable.",
      "",
      "## Scope Compliance",
      "- Agent2 stayed within Agent1 allowed files.",
      "",
      "## Unapproved Changes",
      "- none.",
      "",
      "## Verification Result",
      "- Commands reviewed and passing.",
      "",
      "## Regression Risk",
      "- low.",
      "",
      "## Human Decisions",
      "- none.",
    ].join("\n");
  }

  return `# ${agentRole}`;
}

function sampleAgent3BlockedArtifact() {
  return [
    "# Delivery Report",
    "",
    "## Review Result",
    "- block: current branch includes unrelated committed changes.",
    "",
    "## Scope Compliance",
    "- Agent2 diff is scoped, but PR branch is not clean.",
    "",
    "## Unapproved Changes",
    "- Current branch contains unrelated prior feature commits.",
    "",
    "## Verification Result",
    "- Agent2 commands reviewed.",
    "",
    "## Regression Risk",
    "- Delivery risk is high until branch is isolated.",
    "",
    "## Human Decisions",
    "- Create a clean request-scoped branch before PR.",
  ].join("\n");
}

function sampleBlockedSourceCheckArtifact() {
  return [
    "# Source Check Report",
    "",
    "## Confirmed Requirements",
    "- Existing sources do not confirm the requested behavior.",
    "",
    "## Confirmed Scope",
    "- Source check only.",
    "",
    "## Allowed Files",
    "- none",
    "",
    "## Non-Scope",
    "- No implementation until confirmed source exists.",
    "",
    "## Do Not Touch",
    "- src/**",
    "",
    "## Blocking Questions",
    "- Need a confirmed product or API source.",
    "",
    "## Can Proceed",
    "no",
    "",
    "## Task Package For Agent2",
    "- blocked; do not implement until source is confirmed.",
  ].join("\n");
}

function sampleMultiCandidateSourceCheckArtifact() {
  return [
    "# Source Check Report",
    "",
    "## Confirmed Requirements",
    "- Add literal text `MJ` to a top menu bar.",
    "",
    "## Confirmed Scope",
    "- Source confirmation only until target and placement are confirmed.",
    "",
    "## Allowed Files",
    "- none",
    "",
    "## Non-Scope",
    "- Do not modify more than one app.",
    "",
    "## Do Not Touch",
    "- package.json",
    "- .env files",
    "",
    "## Blocking Questions",
    "- Which target surface should receive `MJ`: admin-agent, admin-hq, or trader?",
    "- Should `MJ` appear after logout, or before logout while logout remains final?",
    "",
    "## Can Proceed",
    "no",
    "",
    "## Task Package For Agent2",
    "- blocked until the target surface and placement are confirmed.",
    "",
    "CONTROL_PLANE_CLARIFICATION_PROMPT_START",
    JSON.stringify({
      title: "選擇目標子專案",
      summary: "repo 裡有三個 topbar/header 候選，需要先選要改哪一個。",
      questions: [
        {
          id: "target_surface",
          question: "要改哪個子專案？",
          options: [
            {
              id: "admin-agent",
              label: "admin-agent",
              description: "apps/admin-agent-web / AgentTopBar",
              clarification:
                "目標子專案：apps/admin-agent-web；目標元件：AgentTopBar。",
            },
            {
              id: "admin-hq",
              label: "admin-hq",
              description: "apps/admin-hq-web / HqTopBar",
              clarification: "目標子專案：apps/admin-hq-web；目標元件：HqTopBar。",
            },
            {
              id: "trader",
              label: "trader",
              description: "apps/trader-web / TraderShell header",
              clarification:
                "目標子專案：apps/trader-web；目標元件：TraderShell header。",
            },
          ],
        },
      ],
    }),
    "CONTROL_PLANE_CLARIFICATION_PROMPT_END",
  ].join("\n");
}

function verifiedAzureReferenceEvidence(referenceId, overrides = {}) {
  return {
    status: "verified",
    referenceType: "work-item",
    referenceId,
    checkedAt: "2026-05-28T03:00:00.000Z",
    title: `Verified Work Item ${referenceId}`,
    workItemType: "Feature",
    workItemState: "Active",
    assignedTo: "QA",
    areaPath: "Project",
    iterationPath: "Project\\Sprint 1",
    webUrl: `https://dev.azure.com/org/project/_workitems/edit/${referenceId}`,
    summary: `Verified Work Item ${referenceId}`,
    error: "",
    ...overrides,
  };
}

function getRun(detail, agentRole) {
  const run = detail.runs.find((candidate) => candidate.agentRole === agentRole);
  assert(run, `${agentRole} run was not found`);
  return run;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRuns(detail, agentRole) {
  const runs = detail.runs.filter((candidate) => candidate.agentRole === agentRole);
  assert(runs.length > 0, `${agentRole} runs were not found`);
  return runs;
}
