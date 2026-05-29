import assert from "node:assert/strict";
import test from "node:test";

const {
  buildWorkflowAgentPacket,
  createWorkflowRequestFromInput,
  evaluateWorkflowStageGate,
  extractClarificationPromptFromArtifact,
  getNextAgentRole,
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
    request: sampleRequest({ status: "ready_for_implementation" }),
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

test("workflow PR-ready gate requires human Azure write approval", () => {
  const stageGate = evaluateWorkflowStageGate({
    request: sampleRequest({ status: "pr_ready" }),
    runs: [],
    prLinks: [],
    auditEvents: [],
  });

  assert.equal(stageGate.status, "human-decision");
  assert.match(stageGate.summary, /guarded Azure draft PR write/);
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
    createdAt: "2026-05-25T06:30:00.000Z",
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-05-25T06:30:00.000Z",
    ...overrides,
  };
}
