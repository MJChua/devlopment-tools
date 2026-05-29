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

test("testing-stage write policy allows only AITraining source branches", () => {
  assert.equal(
    normalizeBranchName("refs/heads/AITraining/test_p"),
    "AITraining/test_p",
  );
  assert.equal(isTestWriteAllowedBranch("AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("refs/heads/AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("AI_Training/test_p"), false);
  assert.equal(isTestWriteAllowedBranch("bug/775"), false);
  assert.equal(
    getTestWritePolicyMessage("refs/heads/bug/775"),
    'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
  );
});

test("formal PR delivery policy allows numbered feature and bug branches targeting develop", () => {
  assert.equal(isTeamPrDeliveryBranch("feature/725"), true);
  assert.equal(isTeamPrDeliveryBranch("refs/heads/bug/399"), true);
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
  assert.equal(getTeamPrBranchKind({ workItemType: "Bug" }), "bug");
  assert.equal(getTeamPrBranchKind({ requestKind: "BUG" }), "bug");
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
  assert.equal(getRecommendedTargetBranch("AITraining/test_p"), "develop");
  assert.equal(getRecommendedTargetBranch("AI_Training/test_p"), "develop");
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
