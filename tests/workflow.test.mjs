import assert from "node:assert/strict";
import test from "node:test";

const {
  buildWorkflowAgentPacket,
  createWorkflowRequestFromInput,
  evaluateWorkflowStageGate,
  extractClarificationPromptFromArtifact,
  getNextAgentRole,
  getPrDeliveryTraceForRequest,
  getStageAfterCompletedAgent,
  getStageForQueuedAgent,
} = await import("../src/lib/control-plane-workflow.ts");
const { summarizeStageGateBlockers } = await import(
  "../src/lib/blocker-summary.ts"
);

test("workflow dispatches Agent0 through Agent3 in the expected order", () => {
  const request = sampleRequest();

  assert.equal(getNextAgentRole(request, []), "agent0");
  assert.equal(getStageForQueuedAgent("agent0"), "dispatched");
  assert.equal(getStageAfterCompletedAgent("agent0"), "source_check");
  assert.equal(getStageAfterCompletedAgent("agent1"), "ready_for_implementation");
  assert.equal(getStageAfterCompletedAgent("agent2"), "review");
  assert.equal(getStageAfterCompletedAgent("agent3"), "pr_ready");
  assert.equal(getStageAfterCompletedAgent("agent3", "no_pr"), "delivered");

  assert.equal(
    getNextAgentRole({ ...request, status: "ready_for_implementation" }, []),
    "agent2",
  );
  assert.equal(getNextAgentRole({ ...request, status: "review" }, []), "agent3");
  assert.equal(getNextAgentRole({ ...request, status: "pr_ready" }, []), null);
});

test("workflow packet is role-specific and keeps implementation packet lean", () => {
  const request = sampleRequest();
  const packet = buildWorkflowAgentPacket(request, "agent2", [
    sampleRun({
      agentRole: "agent1",
      artifact: [
        "# Source Check Report",
        "",
        "## Confirmed Requirements",
        "- Add the member filter behavior verified by product notes.",
        "",
        "## Confirmed Scope",
        "- Update the admin agent member list filter only.",
        "",
        "## Allowed Files",
        "- apps/admin-agent-web/src/views/AgentDirectoryView.vue",
        "- apps/admin-agent-web/src/views/AgentDirectoryView.test.ts",
        "",
        "## Non-Scope",
        "- Do not change shared API contracts.",
        "",
        "## Do Not Touch",
        "- package.json",
        "- .env files",
        "",
        "## Can Proceed",
        "yes",
        "",
        "## Task Package For Agent2",
        "- Implement only the allowed files and run targeted view tests.",
        "",
        "## Raw Notes",
        "- THIS RAW NOTE SHOULD NOT TRAVEL TO THE NEXT AGENT.",
      ].join("\n"),
      status: "completed",
    }),
  ]);

  assert.match(packet, /Request ID: REQ-202605251430-member-filter/);
  assert.match(packet, /Agent 2: Controlled Implementation/);
  assert.match(packet, /Delivery Mode: Draft PR required/);
  assert.match(packet, /## Prior Handoff Summary/);
  assert.match(packet, /Artifact title: Source Check Report/);
  assert.match(packet, /## Confirmed Requirements/);
  assert.match(packet, /## Allowed Files/);
  assert.match(packet, /AgentDirectoryView\.vue/);
  assert.match(packet, /## Non-Scope/);
  assert.match(packet, /## Task Package For Agent2/);
  assert.match(packet, /Azure writes require human approval/);
  assert.doesNotMatch(packet, /## User Request/);
  assert.doesNotMatch(packet, /THIS RAW NOTE SHOULD NOT TRAVEL/);
  assert.doesNotMatch(packet, /直接用自然語言描述/);
  assert.doesNotMatch(packet, /Delivery Report/);
});

test("workflow packet keeps only latest effective handoff per agent", () => {
  const request = sampleRequest();
  const oldAgent1 = sampleRun({
    runId: "agent1-old",
    agentRole: "agent1",
    status: "completed",
    artifact: [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- old requirement",
      "",
      "## Confirmed Scope",
      "- old scope",
      "",
      "## Allowed Files",
      "- apps/old/OldTopBar.vue",
      "",
      "## Non-Scope",
      "- none",
      "",
      "## Do Not Touch",
      "- none",
      "",
      "## Can Proceed",
      "yes",
      "",
      "## Task Package For Agent2",
      "- old package",
    ].join("\n"),
    completedAt: "2026-05-25T06:31:00.000Z",
  });
  const retriedAgent1 = sampleRun({
    runId: "agent1-new",
    retryOfRunId: oldAgent1.runId,
    agentRole: "agent1",
    status: "completed",
    artifact: [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- new requirement",
      "",
      "## Confirmed Scope",
      "- new scope",
      "",
      "## Allowed Files",
      "- apps/new/NewTopBar.vue",
      "",
      "## Non-Scope",
      "- none",
      "",
      "## Do Not Touch",
      "- none",
      "",
      "## Can Proceed",
      "yes",
      "",
      "## Task Package For Agent2",
      "- new package",
    ].join("\n"),
    completedAt: "2026-05-25T06:35:00.000Z",
  });
  const packet = buildWorkflowAgentPacket(request, "agent2", [
    oldAgent1,
    retriedAgent1,
  ]);

  assert.match(packet, /apps\/new\/NewTopBar\.vue/);
  assert.doesNotMatch(packet, /apps\/old\/OldTopBar\.vue/);
  assert.doesNotMatch(packet, /old requirement/);
});

test("resume snapshot does not replace missing required handoff", () => {
  const request = sampleRequest({
    resumeSnapshot: {
      updatedAt: "2026-05-25T06:35:00.000Z",
      updatedByRunId: "agent1-new",
      sourceAgentRole: "agent1",
      confirmedRequirements: ["Add MJ to topbar."],
      confirmedScope: ["Topbar UI only."],
      allowedFiles: ["apps/admin-agent-web/src/components/AgentTopBar.vue"],
      nonScope: ["No API changes."],
      doNotTouch: ["packages/**"],
      latestBlocker: "",
      latestClarification: "",
      verificationSummary: [],
      executionRepoPath: "C:\\workspace\\repo",
      prDeliveryTrace: null,
    },
  });
  const packet = buildWorkflowAgentPacket(request, "agent2", []);

  assert.match(packet, /## Request Resume Snapshot/);
  assert.match(packet, /does not replace required Agent handoff contracts/);
  assert.match(packet, /No relevant prior handoff summary/);
});

test("Level 1 packets prefer scoped verification and Agent3 trusts Agent2 evidence", () => {
  const request = sampleRequest({ taskLevel: "Level 1" });
  const agent1Run = sampleRun({
    agentRole: "agent1",
    status: "completed",
    artifact: [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- Add UI copy.",
      "",
      "## Confirmed Scope",
      "- App-local topbar UI only.",
      "",
      "## Allowed Files",
      "- apps/admin-agent-web/src/components/AgentTopBar.vue",
      "",
      "## Non-Scope",
      "- No API or permission changes.",
      "",
      "## Do Not Touch",
      "- packages/**",
      "",
      "## Can Proceed",
      "yes",
      "",
      "## Task Package For Agent2",
      "- Run scoped component test.",
    ].join("\n"),
  });
  const agent2Packet = buildWorkflowAgentPacket(request, "agent2", [agent1Run]);
  const agent3Packet = buildWorkflowAgentPacket(request, "agent3", [
    agent1Run,
    sampleRun({
      agentRole: "agent2",
      status: "completed",
      artifact: sampleImplementationResult(),
    }),
  ]);

  assert.match(agent2Packet, /prefer scoped verification over full app verification/i);
  assert.match(agent2Packet, /Do not run broad `pnpm verify:\*` by default/);
  assert.match(agent3Packet, /Prefer trusting Agent2's `Commands Run`/);
  assert.match(agent3Packet, /Do not rerun full `pnpm verify:\*` by default/);
});

test("high-risk packets keep full verification guidance", () => {
  const request = sampleRequest({
    taskLevel: "Level 3",
    interpretation: {
      ...sampleRequest().interpretation,
      riskFlags: ["Touches API contract"],
    },
  });
  const agent2Packet = buildWorkflowAgentPacket(request, "agent2", []);

  assert.match(agent2Packet, /run the relevant full `pnpm verify:\*` gate/);
  assert.doesNotMatch(agent2Packet, /Do not run broad `pnpm verify:\*` by default/);
});

test("workflow packet maps Azure Work Item reference to user-facing 單號", () => {
  const packet = buildWorkflowAgentPacket(sampleRequest(), "agent0", []);

  assert.match(packet, /Azure Reference: Azure 單號: 795/);
  assert.match(packet, /Input Template: freeform/);
  assert.match(packet, /Tracking reference only/);
  assert.match(packet, /## User Request/);
  assert.match(packet, /intake evidence for Agent1 to validate with repository inspection/);
  assert.doesNotMatch(packet, /Task Package and Implementation Result/);
});

test("workflow packet carries selected input template", () => {
  const packet = buildWorkflowAgentPacket(
    sampleRequest({ templateId: "ui_visual", evidenceMode: "ui_only" }),
    "agent1",
    [],
  );

  assert.match(packet, /Input Template: ui_visual/);
  assert.match(packet, /Evidence Mode: UI-only visual evidence/);
});

test("workflow packet separates verified Azure Work Item evidence from tracking IDs", () => {
  const trackingPacket = buildWorkflowAgentPacket(sampleRequest(), "agent1", []);
  assert.match(trackingPacket, /## Azure Reference Status/);
  assert.match(trackingPacket, /Tracking reference only/);
  assert.doesNotMatch(trackingPacket, /## Verified Azure Work Item Evidence/);

  const verifiedPacket = buildWorkflowAgentPacket(
    sampleRequest({
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
    }),
    "agent1",
    [],
  );

  assert.match(verifiedPacket, /## Verified Azure Work Item Evidence/);
  assert.match(verifiedPacket, /Title: Header role label/);
  assert.match(verifiedPacket, /State: Active/);
  assert.doesNotMatch(verifiedPacket, /Tracking reference only/);
});

test("draft PR packet derives team branch trace from Azure Work Item", () => {
  const bugRequest = sampleRequest({
    kind: "BUG",
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
  const trace = getPrDeliveryTraceForRequest(bugRequest);
  const packet = buildWorkflowAgentPacket(bugRequest, "agent2", [
    sampleRun({
      agentRole: "agent1",
      status: "completed",
      artifact: completeAgent1Artifact(),
    }),
  ]);

  assert.equal(trace.baseBranch, "develop");
  assert.equal(trace.sourceBranch, "bug/795");
  assert.equal(trace.branchKind, "bug");
  assert.match(packet, /PR Delivery Base Branch: develop/);
  assert.match(packet, /PR Delivery Source Branch: bug\/795/);
  assert.match(packet, /PR Delivery Work Item: 795/);
  assert.match(packet, /App will discover and track the active Azure PR automatically/);
});

test("draft PR branch trace requires verified Work Item evidence", () => {
  const trackingRequest = sampleRequest({
    azureReferenceId: "390",
    azureReferenceEvidence: {
      status: "tracking",
      referenceType: "work-item",
      referenceId: "390",
      checkedAt: "2026-05-28T03:00:00.000Z",
      title: "",
      workItemType: "",
      workItemState: "",
      assignedTo: "",
      areaPath: "",
      iterationPath: "",
      webUrl: "",
      summary: "",
      error: "",
    },
  });
  const trace = getPrDeliveryTraceForRequest(trackingRequest);
  const packet = buildWorkflowAgentPacket(trackingRequest, "agent2", [
    sampleRun({
      agentRole: "agent1",
      status: "completed",
      artifact: completeAgent1Artifact(),
    }),
  ]);

  assert.equal(trace.sourceBranch, "");
  assert.equal(trace.workItemId, "");
  assert.match(trace.reason, /verified Azure Work Item/);
  assert.match(packet, /PR Delivery Source Branch: \(pending work item\)/);
  assert.doesNotMatch(packet, /feature\/390|bug\/390|hotfix\/390/);
});

test("draft PR packet can derive hotfix branch from verified Work Item", () => {
  const hotfixRequest = sampleRequest({
    kind: "HOTFIX",
    azureReferenceId: "390",
    azureReferenceEvidence: {
      status: "verified",
      referenceType: "work-item",
      referenceId: "390",
      checkedAt: "2026-05-28T03:00:00.000Z",
      title: "Production login fix",
      workItemType: "Bug",
      workItemState: "Active",
      assignedTo: "QA",
      areaPath: "Project",
      iterationPath: "Project\\Sprint 1",
      webUrl: "https://dev.azure.com/org/project/_workitems/edit/390",
      summary: "Production login fix",
      error: "",
    },
  });
  const trace = getPrDeliveryTraceForRequest(hotfixRequest);

  assert.equal(trace.sourceBranch, "hotfix/390");
  assert.equal(trace.branchKind, "hotfix");
  assert.equal(trace.workItemId, "390");
});

test("workflow blocks Agent2 dispatch until draft PR Work Item is verified", () => {
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "ready_for_implementation" }),
    runs: [
      sampleRun({
        agentRole: "agent1",
        status: "completed",
        artifact: completeAgent1Artifact(),
      }),
    ],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "human-decision");
  assert.equal(stageGate.needsClarification, true);
  assert.match(stageGate.summary, /verified Azure Work Item/);
  assert.match(stageGate.blockers.join("\n"), /verified Azure Work Item/);
});

test("UI-only visual evidence mode narrows Agent1 source requirements", () => {
  const packet = buildWorkflowAgentPacket(
    sampleRequest({
      evidenceMode: "ui_only",
      azureReferenceType: "none",
      azureReferenceId: "",
    }),
    "agent1",
    [],
  );

  assert.match(packet, /Evidence Mode: UI-only visual evidence/);
  assert.match(packet, /Source strictness: contextual/);
  assert.match(packet, /## UI-only Visual Evidence Mode/);
  assert.match(
    packet,
    /Do not block solely because there is no new Figma, formal spec, Swagger, or QA TestCase/,
  );
  assert.match(
    packet,
    /Require external confirmed source only for new or changed API fields\/contracts, permission or role mapping, data model or persistence, business rules/,
  );
  assert.match(packet, /legacy UI-only marker narrows scope further/);
});

test("standard Agent1 packet allows user evidence and repo inspection for low-risk fixes", () => {
  const packet = buildWorkflowAgentPacket(
    sampleRequest({
      detail: "會員搜尋頁面按下查詢沒有反應，附截圖；預期顯示符合 login name 的結果。",
      azureReferenceType: "none",
      azureReferenceId: "",
    }),
    "agent1",
    [],
  );

  assert.match(packet, /User text, screenshots, and selected-repo inspection can be sufficient evidence/);
  assert.match(packet, /Do not block solely because there is no new Figma, formal spec, Swagger, or QA TestCase/);
  assert.match(packet, /inspect selected-repo project docs, app folders, routes, pages, and likely components/);
  assert.match(packet, /Use repository inspection to confirm existing code ownership/);
  assert.match(packet, /CONTROL_PLANE_CLARIFICATION_PROMPT_START/);
  assert.match(packet, /"questions"/);
  assert.match(packet, /logout button/);
  assert.doesNotMatch(packet, /User request is intake evidence only/);
});

test("blocker summaries translate common Agent1 English blockers", () => {
  const summaries = summarizeStageGateBlockers([
    [
      "Agent1 source check cannot proceed: - Missing confirmed Spec / business rule source.",
      "- Azure Work Item 795 was not confirmed from this environment.",
      "- Existing code uses login identity values `agent` and `manager`; the requested display says `Agent/Admin`.",
    ].join("\n"),
  ]);

  assert.deepEqual(
    summaries.map((summary) => summary.title),
    [
      "缺少可驗證規格或業務規則",
      "Azure 單號尚未驗證",
      "角色文字對應不明",
    ],
  );
  assert.match(summaries[1].original, /Azure Work Item 795/);
});

test("blocker summaries dedupe repeated fallback blockers", () => {
  const summaries = summarizeStageGateBlockers([
    "Agent1 source check cannot proceed: - unknown blocker A\n- unknown blocker A",
    "Agent1 source check cannot proceed: - unknown blocker A",
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "需要人工確認");
  assert.equal(
    summaries[0].original
      .split("\n\n---\n\n")
      .filter((item) => item.includes("unknown blocker A")).length,
    1,
  );
});

test("blocker summaries explain worker runtime and dirty repo blockers", () => {
  const summaries = summarizeStageGateBlockers([
    "worker_runtime_error: 本機背景 Worker 版本不同步或執行環境異常，請重新下載並重啟 Worker。原始錯誤：ReferenceError: finalizeTeamPrDelivery is not defined",
    "worker_version_mismatch: 本機背景 Worker 版本不同步，請重新下載並重啟 Worker。原始錯誤：Worker script integrity mismatch.",
    "repo_dirty_blocked: 本機 repo 目前有未提交異動或分支衝突。Cannot prepare the request branch because the selected repo has uncommitted changes.",
  ]);

  assert.deepEqual(
    summaries.map((summary) => summary.title),
    ["Worker 內部錯誤", "本機 Worker 版本不同步", "本機 repo 狀態不乾淨"],
  );
  assert.match(summaries[0].nextAction, /worker bundle/);
  assert.match(summaries[1].nextAction, /重新下載並重啟 Worker/);
  assert.match(summaries[2].nextAction, /commit、stash/);
});

test("blocker summaries explain verified Work Item branch requirements", () => {
  const summaries = summarizeStageGateBlockers([
    "Draft PR branch preparation requires a verified Azure Work Item.",
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "Azure 單號尚未驗證");
  assert.match(summaries[0].reason, /tracking reference/);
  assert.match(summaries[0].nextAction, /Azure Work Item/);
});

test("blocker summaries explain outdated PR branches", () => {
  const summaries = summarizeStageGateBlockers([
    "pr_branch_outdated: Formal PR branch is behind origin/develop. The worker will not merge or rebase origin/develop automatically.",
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "PR 分支落後 develop");
  assert.match(summaries[0].nextAction, /Agent2/);
});

test("blocker summaries merge UI-only target and expectation gaps", () => {
  const summaries = summarizeStageGateBlockers([
    [
      "Agent1 source check cannot proceed: - Which exact app/page/component or URL should Agent2 visually check or change?",
      "- What is the confirmed expected visual result or evidence, such as screenshot, copy, color, spacing, placement, or simple visual state?",
      "- blocked: the packet confirms only UI-only visual evidence mode. It does not identify the target surface or expected visual result.",
    ].join("\n"),
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "缺少 UI 目標與期望結果");
  assert.match(summaries[0].nextAction, /app\/page\/component\/URL/);
  assert.match(summaries[0].original, /expected visual result/);
  assert.match(summaries[0].original, /target surface/);
});

test("blocker summaries explain multi-target and placement choices plainly", () => {
  const summaries = summarizeStageGateBlockers([
    [
      "Agent1 source check cannot proceed: - Which target surface should receive `MJ`: `apps/admin-agent-web` topbar, `apps/admin-hq-web` topbar, or `apps/trader-web` header?",
      "- Should `MJ` appear after the existing rightmost logout button, or immediately before it while keeping logout as the final control?",
      "- Blocker: repository inspection confirms multiple plausible top menu/header implementations.",
    ].join("\n"),
  ]);

  assert.deepEqual(
    summaries.map((summary) => summary.title),
    ["需要選擇目標子專案或畫面", "需要確認放置位置"],
  );
  assert.match(summaries[0].nextAction, /admin-agent/);
  assert.match(summaries[1].reason, /登出按鈕後面/);
});

test("Agent1 packet requires a source check schema with file scope and non-scope", () => {
  const packet = buildWorkflowAgentPacket(sampleRequest(), "agent1", [
    sampleRun({
      agentRole: "agent0",
      artifact: "# Agent0\n\nSuggested next agent: agent1",
      status: "completed",
    }),
  ]);

  assert.match(packet, /# Source Check Report/);
  assert.match(packet, /## Confirmed Requirements/);
  assert.match(packet, /## Allowed Files/);
  assert.match(packet, /## Non-Scope/);
  assert.match(packet, /## Do Not Touch/);
  assert.match(packet, /## Task Package For Agent2/);
  assert.match(packet, /file boundaries/);
});

test("stage gate parses Agent1 quick clarification prompt", () => {
  const blockedRun = sampleRun({
    runId: "agent1-multi-candidate",
    agentRole: "agent1",
    status: "blocked",
    artifact: sampleClarificationPromptArtifact(),
    error:
      "Agent1 source check cannot proceed: Which target surface should receive MJ?",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "blocked" }),
    runs: [blockedRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "blocked");
  assert.equal(stageGate.needsClarification, true);
  assert.equal(stageGate.clarificationPrompt?.title, "選擇目標子專案");
  assert.equal(stageGate.clarificationPrompt?.questions.length, 2);
  assert.equal(
    stageGate.clarificationPrompt?.questions[0].options
      .map((option) => option.id)
      .join(","),
    "admin-agent,admin-hq,trader",
  );

  const prompt = extractClarificationPromptFromArtifact(
    sampleClarificationPromptArtifact(),
  );
  assert.equal(prompt?.questions[1].id, "placement");
});

test("Agent2 packet flags incomplete Agent1 handoff instead of filling gaps", () => {
  const packet = buildWorkflowAgentPacket(sampleRequest(), "agent2", [
    sampleRun({
      agentRole: "agent1",
      artifact: [
        "# Source Check Report",
        "",
        "## Confirmed Requirements",
        "- Add a member filter.",
        "",
        "## Can Proceed",
        "yes",
      ].join("\n"),
      status: "completed",
    }),
  ]);

  assert.match(packet, /Missing required handoff fields:/);
  assert.match(packet, /Allowed Files/);
  assert.match(packet, /Non-Scope/);
  assert.match(packet, /Treat this handoff as incomplete/);
  assert.doesNotMatch(packet, /## User Request/);
});

test("workflow stage gate blocks missing worker and waits for open runs", () => {
  const request = sampleRequest({ assignedWorkerId: "" });
  const blocked = evaluateWorkflowStageGate({
    request,
    runs: [],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blockers, [
    "No Local Worker is assigned to this request.",
  ]);

  const waiting = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "running" }),
    runs: [sampleRun({ status: "running", agentRole: "agent2" })],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(waiting.status, "waiting");
  assert.match(waiting.summary, /Agent 2/);
});

test("workflow stage gate ignores blockers superseded by recovery runs", () => {
  const blockedRun = sampleRun({
    runId: "agent1-blocked",
    agentRole: "agent1",
    status: "blocked",
    error:
      "Agent handoff is incomplete. Missing required fields: Allowed Files.",
  });
  const recoveryRun = sampleRun({
    runId: "agent1-recovery",
    agentRole: "agent1",
    status: "completed",
    retryOfRunId: blockedRun.runId,
    dispatchReason: "manual_retry",
    artifact: "# Source Check Report\n\n## Confirmed Requirements\n- ok",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({
      status: "ready_for_implementation",
      azureReferenceEvidence: verifiedWorkItemEvidence("795"),
    }),
    runs: [blockedRun, recoveryRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "ready");
  assert.equal(stageGate.blockedRunId, "");
  assert.equal(stageGate.blockers.length, 0);
});

test("workflow stage gate marks stale running run without enabling duplicate dispatch", () => {
  const staleRun = sampleRun({
    runId: "agent2-stale",
    agentRole: "agent2",
    status: "running",
    updatedAt: "2026-05-25T06:00:00.000Z",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "running" }),
    runs: [staleRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "waiting");
  assert.equal(stageGate.recoveryKind, "stale_run");
  assert.equal(stageGate.blockedRunId, staleRun.runId);
  assert.equal(stageGate.canManualRetry, false);
});

test("workflow stage gate separates worker runtime errors from Agent blockers", () => {
  const blockedRun = sampleRun({
    runId: "agent0-worker-runtime",
    agentRole: "agent0",
    status: "blocked",
    error:
      "worker_runtime_error: 本機背景 Worker 版本不同步或執行環境異常，請重新下載並重啟 Worker。原始錯誤：ReferenceError: finalizeTeamPrDelivery is not defined",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "blocked" }),
    runs: [blockedRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "blocked");
  assert.equal(stageGate.recoveryKind, "worker_internal_error");
  assert.equal(stageGate.needsClarification, false);
  assert.match(stageGate.blockers[0], /worker_internal_error/);
});

test("workflow stage gate separates worker version mismatch from internal errors", () => {
  const blockedRun = sampleRun({
    runId: "agent0-worker-version",
    agentRole: "agent0",
    status: "blocked",
    error:
      "worker_version_mismatch: 本機背景 Worker 版本不同步，請重新下載並重啟 Worker。原始錯誤：Worker script integrity mismatch.",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "blocked" }),
    runs: [blockedRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "blocked");
  assert.equal(stageGate.recoveryKind, "worker_version_mismatch");
  assert.equal(stageGate.needsClarification, false);
  assert.match(stageGate.blockers[0], /worker_version_mismatch/);
});

test("workflow stage gate separates dirty repo blockers", () => {
  const blockedRun = sampleRun({
    runId: "agent2-dirty-repo",
    agentRole: "agent2",
    status: "blocked",
    error:
      "repo_dirty_blocked: 本機 repo 目前有未提交異動或分支衝突。Cannot prepare the request branch because the selected repo has uncommitted changes.",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "blocked" }),
    runs: [blockedRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "blocked");
  assert.equal(stageGate.recoveryKind, "repo_dirty_blocked");
  assert.equal(stageGate.needsClarification, false);
  assert.match(stageGate.blockers[0], /未提交異動/);
});

test("workflow stage gate separates outdated PR branch blockers", () => {
  const blockedRun = sampleRun({
    runId: "agent2-outdated-branch",
    agentRole: "agent2",
    status: "blocked",
    error:
      "pr_branch_outdated: Formal PR branch is behind origin/develop. Update the branch manually in Azure Repos or Git, then rerun Agent2.",
  });
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "blocked" }),
    runs: [blockedRun],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "blocked");
  assert.equal(stageGate.recoveryKind, "pr_branch_outdated");
  assert.equal(stageGate.needsClarification, false);
  assert.match(stageGate.blockers[0], /pr_branch_outdated/);
});

test("workflow waits for Local Worker/Codex interpretation before high-risk stop", () => {
  const base = sampleRequest();
  const highRiskRequest = sampleRequest({
    interpretation: {
      ...base.interpretation,
      source: "provisional",
      riskFlags: ["Deploy is outside this App's operation scope."],
    },
  });
  const waiting = evaluateWorkflowStageGate({
    request: { ...highRiskRequest, status: "dispatched" },
    runs: [sampleRun({ status: "queued", agentRole: "agent0" })],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(waiting.status, "waiting");

  const stopped = evaluateWorkflowStageGate({
    request: {
      ...highRiskRequest,
      status: "blocked",
      interpretation: {
        ...highRiskRequest.interpretation,
        source: "worker",
      },
    },
    runs: [sampleRun({ status: "completed", agentRole: "agent0" })],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stopped.status, "human-decision");
  assert.match(stopped.summary, /Local Worker\/Codex flagged/);
});

test("workflow PR-ready gate waits for Azure PR tracking", () => {
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "pr_ready" }),
    runs: [],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "human-decision");
  assert.match(stageGate.summary, /discover and track the active Azure PR/);
  assert.equal(stageGate.humanDecisions.length, 1);
});

test("workflow no-PR delivery is tracked as completed after Agent3 review", () => {
  const request = sampleRequest({ deliveryMode: "no_pr", status: "delivered" });
  const stageGate = evaluateWorkflowStageGate({
    request,
    runs: [
      sampleRun({
        agentRole: "agent3",
        status: "completed",
        artifact: sampleDeliveryReport(),
      }),
    ],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "ready");
  assert.equal(stageGate.label, "Delivered");
  assert.match(stageGate.summary, /without PR/);
  assert.equal(
    getNextAgentRole(
      sampleRequest({ deliveryMode: "no_pr", status: "review" }),
      [],
    ),
    "agent3",
  );
});

function sampleDeliveryReport(overrides = {}) {
  return [
    "# Delivery Report",
    "",
    "## Review Result",
    overrides.reviewResult ?? "- pass: no PR required.",
    "",
    "## Scope Compliance",
    overrides.scopeCompliance ?? "- pass.",
    "",
    "## Unapproved Changes",
    overrides.unapprovedChanges ?? "- none.",
    "",
    "## Verification Result",
    overrides.verificationResult ?? "- Commands reviewed and passing.",
    "",
    "## Regression Risk",
    overrides.regressionRisk ?? "- low.",
    "",
    "## Human Decisions",
    overrides.humanDecisions ?? "- none.",
  ].join("\n");
}

function sampleImplementationResult() {
  return [
    "# Implementation Result",
    "",
    "## Changed Files",
    "- apps/admin-agent-web/src/components/AgentTopBar.vue",
    "",
    "## Commands Run",
    "- pnpm --filter @odin/admin-agent-web test -- AgentTopBar.test.ts: pass.",
    "",
    "## Verification Result",
    "- pass.",
    "",
    "## Scope Compliance",
    "- No file outside Agent1 allowed files changed.",
    "",
    "## Human Decisions",
    "- none.",
  ].join("\n");
}

function completeAgent1Artifact() {
  return [
    "# Source Check Report",
    "",
    "## Confirmed Requirements",
    "- Update the confirmed UI behavior.",
    "",
    "## Confirmed Scope",
    "- Header UI only.",
    "",
    "## Allowed Files",
    "- apps/admin-agent-web/src/components/AgentTopBar.vue",
    "",
    "## Non-Scope",
    "- Do not change API behavior.",
    "",
    "## Do Not Touch",
    "- package.json",
    "",
    "## Blocking Questions",
    "- none",
    "",
    "## Can Proceed",
    "yes",
    "",
    "## Task Package For Agent2",
    "- Make the scoped UI change and run targeted verification.",
  ].join("\n");
}

function sampleClarificationPromptArtifact() {
  return [
    "# Source Check Report",
    "",
    "## Confirmed Requirements",
    "- Add literal text `MJ` to a top menu bar.",
    "",
    "## Confirmed Scope",
    "- Source confirmation only until target is selected.",
    "",
    "## Allowed Files",
    "- none",
    "",
    "## Non-Scope",
    "- Do not change multiple apps.",
    "",
    "## Do Not Touch",
    "- package.json",
    "",
    "## Blocking Questions",
    "- Which target surface should receive `MJ`: admin-agent, admin-hq, or trader?",
    "- Should `MJ` appear after logout, or before logout while logout remains final?",
    "",
    "## Can Proceed",
    "no",
    "",
    "## Task Package For Agent2",
    "- blocked until target and placement are confirmed.",
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
        {
          id: "placement",
          question: "MJ 要放在哪裡？",
          options: [
            {
              id: "after-logout",
              label: "登出後面",
              description: "MJ 成為最右側內容",
              clarification: "放置位置：MJ 放在登出按鈕後面，成為最右側內容。",
            },
            {
              id: "before-logout",
              label: "登出前面",
              description: "登出仍維持最右側",
              clarification: "放置位置：MJ 放在登出按鈕前面，登出仍維持最右側。",
            },
          ],
        },
      ],
    }),
    "CONTROL_PLANE_CLARIFICATION_PROMPT_END",
  ].join("\n");
}

function sampleRequest(overrides = {}) {
  return {
    ...createWorkflowRequestFromInput(
      {
        kind: "REQ",
        title: "Member filter",
        detail: "Add a member filter.",
        taskLevel: "Level 2",
        owner: "Michael",
        assignedWorkerId: "michael-local",
        azureReferenceType: "work-item",
        azureReferenceId: "795",
      },
      new Date(2026, 4, 25, 14, 30),
    ),
    ...overrides,
  };
}

function verifiedWorkItemEvidence(referenceId, overrides = {}) {
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

function sampleRun(overrides = {}) {
  return {
    runId: "run-1",
    requestId: "REQ-202605251430-member-filter",
    agentRole: "agent0",
    workerId: "michael-local",
    repoPath: "C:\\workspace\\repo",
    status: "queued",
    retryOfRunId: "",
    dispatchReason: "normal",
    packet: "packet",
    commandOutput: "",
    diffSummary: "",
    artifact: "",
    error: "",
    progressLabel: "",
    progressDetail: "",
    progressUpdatedAt: null,
    packetSizeChars: 0,
    priorHandoffCount: 0,
    usedResumeSnapshot: false,
    isRetryContext: false,
    createdAt: "2026-05-25T06:30:00.000Z",
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-05-25T06:30:00.000Z",
    ...overrides,
  };
}
