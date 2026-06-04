import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  buildAgentPacket,
  buildCreatePullRequestDescription,
  evaluatePullRequestRules,
  getCreatePullRequestWarnings,
  getRecommendedTargetBranch,
} = await import("../src/lib/repo-rule-engine.ts");
const {
  buildTeamPrDeliveryBranch,
  getTeamPrBranchKind,
  isTeamPrDeliveryBranch,
  isTeamPrDeliveryTargetBranch,
  getTestWritePolicyMessage,
  isTestWriteAllowedBranch,
  normalizeBranchName,
} = await import("../src/lib/test-write-policy.ts");
const { createRequestIntakeRecord } = await import(
  "../src/lib/request-intake.ts"
);
const { validateCreatePullRequestBody } = await import(
  "../src/lib/create-pr-validation.ts"
);
const {
  buildWorkItemFilterQuery,
  normalizeWorkItemIteration,
} = await import("../src/lib/azure-work-items.ts");

test("workflow UI does not render the removed workspace diagnostics card", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /WorkspaceStatusPanel/);
  assert.doesNotMatch(source, /工作區診斷/);
  assert.doesNotMatch(source, /Control Plane/);
  assert.doesNotMatch(source, /Repo snapshot/);
  assert.doesNotMatch(source, /共享 team/);
  assert.doesNotMatch(source, /個人 localhost/);
  assert.doesNotMatch(source, /label="Owner"/);
  assert.doesNotMatch(source, /getControlPlaneMode/);
});

test("workflow UI routes missing launcher profiles to toast-only guidance", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /launcher_profile_missing/);
  assert.match(source, /本機連線資料不存在，請按/);
  assert.match(source, /launcherState\.available\s*&&\s*launcherState\.hasProfile/);
  assert.match(source, /workerVersionMismatch && launcherHasProfile/);
  assert.doesNotMatch(source, /本機連線資料已不存在/);
  assert.doesNotMatch(source, /重新連線本機 Worker/);
});

test("testing-stage write policy allows only AITraining source branches", () => {
  assert.equal(
    normalizeBranchName("refs/heads/AITraining/test_p"),
    "AITraining/test_p",
  );
  assert.equal(isTestWriteAllowedBranch("AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("refs/heads/AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("AI_Training/test_p"), false);
  assert.equal(isTestWriteAllowedBranch("bug/775"), false);
  assert.equal(isTestWriteAllowedBranch("hotfix/390"), false);
  assert.equal(
    getTestWritePolicyMessage("refs/heads/bug/775"),
    'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
  );
});

test("formal PR delivery policy allows numbered feature, bug, and hotfix branches without suffixes", () => {
  assert.equal(isTeamPrDeliveryBranch("feature/725"), true);
  assert.equal(isTeamPrDeliveryBranch("refs/heads/bug/399"), true);
  assert.equal(isTeamPrDeliveryBranch("hotfix/390"), true);
  assert.equal(isTeamPrDeliveryBranch("feature/390-title"), false);
  assert.equal(isTeamPrDeliveryBranch("bug/390-fix"), false);
  assert.equal(isTeamPrDeliveryBranch("hotfix/390-prod"), false);
  assert.equal(isTeamPrDeliveryBranch("feature/member-filter"), false);
  assert.equal(isTeamPrDeliveryBranch("AITraining/test_p"), false);
  assert.equal(isTeamPrDeliveryTargetBranch("develop"), true);
  assert.equal(isTeamPrDeliveryTargetBranch("main"), false);
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "399", workItemType: "Bug" }),
    "bug/399",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "725", requestKind: "REQ" }),
    "feature/725",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "390", requestKind: "HOTFIX" }),
    "hotfix/390",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "390-title", requestKind: "REQ" }),
    "",
  );
  assert.equal(getTeamPrBranchKind({ workItemType: "Bug" }), "bug");
  assert.equal(getTeamPrBranchKind({ requestKind: "BUG" }), "bug");
  assert.equal(getTeamPrBranchKind({ requestKind: "HOTFIX" }), "hotfix");
});

test("local worker explains verified Work Item requirement for formal PR branches", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /no verified Azure Work Item/);
  assert.match(source, /feature\/\{id\}, bug\/\{id\}, or hotfix\/\{id\}/);
});

test("local worker pushes formal PR branches without merging develop locally", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /git merge --no-edit origin\/develop/);
  assert.doesNotMatch(source, /Merging origin\/develop/);
  assert.match(source, /git merge-base --is-ancestor origin\/develop HEAD/);
  assert.match(source, /pr_branch_outdated/);
  assert.match(source, /origin\/\$\{branchName\}/);
  assert.equal((source.match(/git push/g) ?? []).length, 1);
});

test("local worker keeps polling when the App is temporarily unreachable", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /pollRetryDelaysMs = \[5000, 10000, 30000\]/);
  assert.match(source, /App is temporarily unreachable/);
  assert.match(source, /worker stays alive and will retry/);
  assert.match(source, /isTransientPollError/);
  assert.match(source, /WorkerStoppedError/);
  assert.match(source, /HTTP 5\\d\\d/);
  assert.match(source, /ECONNREFUSED/);
});

test("local launcher supervises saved workers and reports stale pids", () => {
  const launcherSource = readFileSync(
    new URL("../scripts/local-launcher.mjs", import.meta.url),
    "utf8",
  );
  const utilsSource = readFileSync(
    new URL("../scripts/local-launcher-utils.mjs", import.meta.url),
    "utf8",
  );

  assert.match(launcherSource, /workerSupervisorIntervalMs = 15000/);
  assert.match(launcherSource, /startWorkerSupervisor\(\)/);
  assert.match(launcherSource, /superviseSavedProfiles/);
  assert.match(launcherSource, /worker supervisor restarting/);
  assert.match(utilsSource, /workerStatusReason/);
  assert.match(utilsSource, /pid_not_running/);
});

test("workflow UI keeps launcher recovery guidance concise", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Launcher 需要更新/);
  assert.match(source, /Launcher 暫時模式/);
  assert.match(source, /複製正式安裝指令/);
  assert.match(source, /inferWorkerStatusReason/);
  assert.match(source, /pid_not_running/);
  assert.match(source, /查看詳情/);
  assert.doesNotMatch(source, /Launcher 目前是暫時啟動模式/);
  assert.doesNotMatch(source, /目前 worker 可以使用，但 Scheduled Task 尚未正式安裝/);
  assert.doesNotMatch(source, /重開機或重新登入後穩定性取決於 Startup/);
});

test("workflow request records are scoped to the selected repository", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /isRequestForSelectedRepository\(request, selectedRepoPath\)/);
  assert.match(source, /normalizeRepositoryPath\(request\.repoPath\) === normalizedSelectedRepo/);
  assert.match(source, /!selectedExists \|\| selectedVisible/);
  assert.match(source, /const hiddenRequestId = selectedRequestId/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /selectedRequestIdRef\.current !== hiddenRequestId/);
  assert.match(source, /setSelectedRequestId\(""\)/);
  assert.match(source, /setDetail\(null\)/);
  assert.match(source, /setStageGate\(null\)/);
});

test("request record titles hide legacy English placeholders", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const workflowSource = readFileSync(
    new URL("../src/lib/control-plane-workflow.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /formatRequestDisplayTitle\(request\)/);
  assert.match(source, /formatRequestDisplayTitle\(selectedRequest\)/);
  assert.match(source, /request \? formatRequestDisplayTitle\(request\) : ""/);
  assert.match(source, /isEnglishPlaceholderTitle/);
  assert.match(source, /未命名需求/);
  assert.match(source, /formatInterpretationSummary\(interpretation\.summary\)/);
  assert.match(source, /isEnglishPlaceholderSummary/);
  assert.match(source, /需求摘要待本機 Codex 重新判讀/);
  assert.doesNotMatch(workflowSource, /short human-readable title/);
  assert.match(workflowSource, /中文可讀標題/);
  assert.match(workflowSource, /中文分類摘要；不要宣稱來源已確認/);
});

test("blocker recovery exposes one rerun Agent action", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const blockerSource = readFileSync(
    new URL("../src/lib/blocker-summary.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /async function rerunAgent/);
  assert.match(source, /hasRecoveryInput \? "clarify_and_retry" : "retry_same_agent"/);
  assert.match(source, /onRerunAgent=\{rerunAgent\}/);
  assert.match(source, /const canRerunAgent = canManualRetry \|\| canClarifyAndRetry/);
  assert.match(source, /重跑 Agent/);
  assert.doesNotMatch(source, /重跑同一 Agent/);
  assert.doesNotMatch(source, /補充後重跑 Agent/);
  assert.doesNotMatch(blockerSource, /重跑同一 Agent/);
});

test("workflow dark mode keeps legacy utility colors readable", () => {
  const source = readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert(source.includes(".dark .bg-white\\/75"));
  assert(source.includes(".dark .text-blue-600"));
  assert(source.includes(".dark .text-green-900"));
  assert(source.includes(".dark .text-amber-950"));
  assert(source.includes(".dark input"));
  assert(source.includes(".dark textarea"));
  assert(source.includes(".dark input::placeholder"));
});

test("hotfix planning remains documented as pending release policy", () => {
  const operatorGuide = readFileSync(
    new URL("../docs/operator-guide.md", import.meta.url),
    "utf8",
  );
  const futureNotes = readFileSync(
    new URL("../docs/future-phase-notes.md", import.meta.url),
    "utf8",
  );

  assert.match(operatorGuide, /Hotfix planning status/);
  assert.match(operatorGuide, /Formal PR delivery still uses `develop`/);
  assert.match(operatorGuide, /does not decide production release routing/);
  assert.match(operatorGuide, /must not create release branches, deploy, update branch policy/);
  assert.match(futureNotes, /Hotfix Release Target Policy/);
  assert.match(futureNotes, /pending product decision/);
  assert.match(futureNotes, /must not infer production release routing/);
});

test("request-scoped PR create route refreshes existing Azure PR before creating one", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/requests/[requestId]/pr-create/route.ts", import.meta.url),
    "utf8",
  );
  const launcherSource = readFileSync(
    new URL("../scripts/local-launcher.mjs", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /findActivePullRequestsForBranches/);
  assert.match(routeSource, /client\.createPullRequest/);
  assert.match(routeSource, /linkPullRequestToWorkflow/);
  assert.match(routeSource, /confirmWrite/);
  assert.match(routeSource, /isTeamPrDeliveryBranch/);
  assert.match(launcherSource, /pr-create/);
});

test("Work Item filter WIQL does not exclude states or types by default", () => {
  const query = buildWorkItemFilterQuery();

  assert.match(query, /\[System.TeamProject\] = @project/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Closed'/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Done'/);
  assert.doesNotMatch(query, /\[System.WorkItemType\]/);
});

test("Work Item filter WIQL applies selected Sprint and escapes quotes", () => {
  const query = buildWorkItemFilterQuery({
    iterationPath: "MT5-Trading-Platform\\Iteration\\Release 'A'\\Sprint 1",
    state: "Done",
    type: "Bug",
    assignedTo: "Michael Chao",
  });

  assert.match(
    query,
    /\[System.IterationPath\] UNDER 'MT5-Trading-Platform\\Release ''A''\\Sprint 1'/,
  );
  assert.match(query, /\[System.State\] = 'Done'/);
  assert.match(query, /\[System.WorkItemType\] = 'Bug'/);
  assert.match(query, /\[System.AssignedTo\] = 'Michael Chao'/);
});

test("Work Item filter WIQL supports project-level queries without Sprint", () => {
  const query = buildWorkItemFilterQuery({ state: "Active" });

  assert.match(query, /\[System.TeamProject\] = @project/);
  assert.match(query, /\[System.State\] = 'Active'/);
  assert.doesNotMatch(query, /\[System.IterationPath\]/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Closed'/);
});

test("Work Item iteration tree normalizer preserves Sprint metadata", () => {
  const normalized = normalizeWorkItemIteration({
    id: 1,
    name: "MT5-Trading-Platform",
    path: "\\MT5-Trading-Platform",
    children: [
      {
        id: 2,
        name: "Sprint 1",
        path: "\\MT5-Trading-Platform\\Iteration\\Sprint 1",
        attributes: {
          startDate: "2026-01-01T00:00:00Z",
          finishDate: "2026-01-15T00:00:00Z",
        },
      },
      {
        id: 3,
        name: "Release 1",
        path: "\\MT5-Trading-Platform\\Release 1",
        children: [
          {
            id: 4,
            name: "Iteration Review",
            path: "\\MT5-Trading-Platform\\Release 1\\Iteration Review",
          },
        ],
      },
    ],
  });

  assert.equal(normalized.path, "MT5-Trading-Platform");
  assert.equal(normalized.children[0].name, "Sprint 1");
  assert.equal(normalized.children[0].path, "MT5-Trading-Platform\\Sprint 1");
  assert.equal(
    normalized.children[0].sourcePath,
    "MT5-Trading-Platform\\Iteration\\Sprint 1",
  );
  assert.equal(normalized.children[0].startDate, "2026-01-01T00:00:00Z");
  assert.equal(normalized.children[0].finishDate, "2026-01-15T00:00:00Z");
  assert.equal(normalized.children[1].path, "MT5-Trading-Platform\\Release 1");
  assert.equal(
    normalized.children[1].children[0].path,
    "MT5-Trading-Platform\\Release 1\\Iteration Review",
  );
});

test("Create PR validation rejects non-AITraining source branches before PAT validation", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "bug/775",
      targetBranch: "develop",
      title: "blocked write policy",
      description: buildCreatePullRequestDescription({
        sourceBranch: "bug/775",
        targetBranch: "develop",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
  );
});

test("Create PR validation keeps AI_Training read-only during testing stage", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "AI_Training/test_p",
      targetBranch: "develop",
      title: "blocked underscore training branch",
      description: buildCreatePullRequestDescription({
        sourceBranch: "AI_Training/test_p",
        targetBranch: "develop",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    'Testing-stage Azure writes are limited to AITraining/ branches. "AI_Training/test_p" is read-only.',
  );
});

test("Create PR validation rejects invalid targets before Azure client work", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "AITraining/test_p",
      targetBranch: "AITraining/test-target",
      title: "blocked target",
      description: buildCreatePullRequestDescription({
        sourceBranch: "AITraining/test_p",
        targetBranch: "AITraining/test-target",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    "targetBranch must be a configured protected branch for MVP PR creation.",
  );
});

test("repo rule engine keeps branch targets and stage gate regression-safe", () => {
  assert.equal(getRecommendedTargetBranch("feature/member-filter"), "develop");
  assert.equal(getRecommendedTargetBranch("bug/775"), "develop");
  assert.equal(getRecommendedTargetBranch("hotfix/390"), "develop");
  assert.equal(getRecommendedTargetBranch("AITraining/test_p"), "develop");
  assert.equal(getRecommendedTargetBranch("AI_Training/test_p"), "develop");
  assert.deepEqual(
    getCreatePullRequestWarnings({
      sourceBranch: "hotfix/390",
      targetBranch: "develop",
    }),
    [
      "Hotfix branch target policy is pending until the production release flow is finalized.",
    ],
  );
  assert.deepEqual(
    getCreatePullRequestWarnings({
      sourceBranch: "feature/member-filter",
      targetBranch: "main",
    }),
    ["feature branches should target develop, but the selected target is main."],
  );

  const report = evaluatePullRequestRules(
    samplePullRequest(),
    samplePullRequestDetail({
      linkedWorkItems: [sampleWorkItem()],
      changes: [
        {
          path: "/apps/admin-agent-web/src/pages/member.tsx",
          changeType: "edit",
        },
      ],
    }),
  );

  assert.equal(report.status, "passed");
  assert.equal(report.stageGate.status, "ready");
  assert.equal(report.readiness.decision, "deliverable");
  assert.deepEqual(report.requiredVerification, ["pnpm verify:admin-agent"]);
});

test("repo rule engine blocks missing Work Item and carries request intake into Agent Packet", () => {
  const report = evaluatePullRequestRules(
    samplePullRequest(),
    samplePullRequestDetail({
      linkedWorkItems: [],
      changes: [
        {
          path: "/apps/admin-agent-web/src/pages/member.tsx",
          changeType: "edit",
        },
      ],
    }),
  );
  const intake = createRequestIntakeRecord(
    {
      kind: "REQ",
      title: "Member filter",
      detail: "Add a member filter for operations users.",
      taskLevel: "Level 2",
      azureReferenceType: "pr",
      azureReferenceId: "390",
    },
    new Date(2026, 4, 25, 17, 30),
  );
  const packet = buildAgentPacket(report, intake);

  assert.equal(report.status, "blocked");
  assert.equal(report.stageGate.status, "blocked");
  assert.match(packet, /Request ID: REQ-202605251730-member-filter/);
  assert.match(packet, /## User Request/);
  assert.match(packet, /Add a member filter for operations users\./);
  assert.match(packet, /intake evidence only/);
});

function samplePullRequest(overrides = {}) {
  return {
    id: 390,
    title: "Member filter",
    description: "Existing PR description",
    webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/390",
    status: "active",
    sourceBranch: "feature/member-filter",
    targetBranch: "develop",
    createdBy: "Michael Chao",
    isDraft: false,
    linkedWorkItems: [],
    buildEvidence: [],
    buildEvidenceSourcesChecked: [],
    statuses: [],
    reviewers: [],
    diagnostics: [],
    ...overrides,
  };
}

function samplePullRequestDetail(overrides = {}) {
  return {
    pullRequestId: 390,
    description: "Existing PR description",
    changes: [],
    linkedWorkItems: [],
    latestBuild: undefined,
    buildEvidence: [
      {
        source: "branch-build",
        state: "succeeded",
        label: "Build succeeded",
      },
    ],
    buildEvidenceSourcesChecked: [
      "branch latest build",
      "source commit build",
      "PR statuses",
    ],
    statuses: [],
    reviewers: [],
    diagnostics: [],
    ...overrides,
  };
}

function sampleWorkItem() {
  return {
    id: "795",
    url: "https://dev.azure.com/odin-tech/_apis/wit/workItems/795",
    webUrl:
      "https://dev.azure.com/odin-tech/MT5-Trading-Platform/_workitems/edit/795",
    title: "testing",
    type: "Task",
    state: "New",
  };
}
