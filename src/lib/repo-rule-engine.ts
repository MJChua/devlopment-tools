import type {
  BranchClass,
  BuildEvidence,
  PullRequestDetail,
  PullRequestSummary,
} from "@/lib/azure-devops";
import type { RequestIntakeRecord } from "@/lib/request-intake";

export type RuleSeverity = "block" | "warning" | "pass";

export type RuleFinding = {
  severity: RuleSeverity;
  title: string;
  detail: string;
};

export type PullRequestLifecycle =
  | "active"
  | "completed"
  | "abandoned"
  | "unknown";

export type StageGateStatus =
  | "ready"
  | "blocked"
  | "needs-review"
  | "historical"
  | "inspection-failed";

export type StageGateDecision = {
  status: StageGateStatus;
  label: string;
  detail: string;
  deliveryGate: boolean;
};

export type PullRequestReadiness = {
  decision:
    | "deliverable"
    | "blocked"
    | "needs-review"
    | "not-current"
    | "inspection-failed";
  label: string;
  summary: string;
  blockers: string[];
  reviewItems: string[];
  humanDecisions: string[];
  requiredVerification: string[];
};

export type RuleCheckReport = {
  pullRequestId: number;
  title: string;
  existingDescription: string;
  sourceBranch: string;
  targetBranch: string;
  changedFiles: Array<{
    path: string;
    changeType: string;
    objectType?: string;
  }>;
  pullRequestStatus: string;
  lifecycle: PullRequestLifecycle;
  status: "blocked" | "warning" | "passed";
  stageGate: StageGateDecision;
  readiness: PullRequestReadiness;
  findings: RuleFinding[];
  requiredVerification: string[];
};

export const AZURE_PR_DESCRIPTION_LIMIT = 4000;
export const AZURE_PR_COMMENT_LIMIT = 4000;
export const CONTROL_PLANE_READINESS_COMMENT_MARKER =
  "<!-- azure-ai-control-plane:readiness -->";
export const CONTROL_PLANE_DESCRIPTION_START_MARKER =
  "<!-- azure-ai-control-plane:readiness-description:start -->";
export const CONTROL_PLANE_DESCRIPTION_END_MARKER =
  "<!-- azure-ai-control-plane:readiness-description:end -->";

type PathGate = {
  id: string;
  title: string;
  detail: string;
  severity: "block" | "warning";
  requiredVerification: string[];
  matches: (paths: string[]) => boolean;
  downgradeToWarningWhen?: (paths: string[]) => boolean;
};

export type RepoRuleConfig = {
  name: string;
  protectedBranches: string[];
  branchTargets: Partial<Record<BranchClass, string[]>>;
  pendingBranchTargetClasses: Partial<Record<BranchClass, string>>;
  defaultVerification: string;
  pathGates: PathGate[];
  appScopeVerification: Array<{
    prefix: string;
    command: string;
  }>;
};

export const ODIN_MT5_WEB_RULES: RepoRuleConfig = {
  name: "odin-mt5-web",
  protectedBranches: ["main", "release", "develop"],
  branchTargets: {
    feature: ["develop"],
    bug: ["develop"],
    "ai-training": ["develop"],
  },
  pendingBranchTargetClasses: {
    hotfix:
      "Hotfix branch target policy is pending until the production release flow is finalized.",
  },
  defaultVerification: "pnpm preflight:affected",
  appScopeVerification: [
    { prefix: "apps/trader-web/", command: "pnpm verify:trader" },
    { prefix: "apps/admin-hq-web/", command: "pnpm verify:admin-hq" },
    { prefix: "apps/admin-agent-web/", command: "pnpm verify:admin-agent" },
    { prefix: "packages/", command: "pnpm verify:shared" },
  ],
  pathGates: [
    {
      id: "contracts",
      title: "Contract-change gate",
      detail:
        "Changes under packages/contracts require live Swagger confirmation, package API alignment, and docs/human/api-field-spec sync.",
      severity: "block",
      requiredVerification: ["pnpm verify:shared", "pnpm verify:docs"],
      matches: (paths) =>
        paths.some((path) => path.startsWith("packages/contracts/")),
      downgradeToWarningWhen: (paths) =>
        hasAnyPath(paths, ["docs/human/api-field-spec/", "packages/api-"]),
    },
    {
      id: "i18n",
      title: "i18n verification required",
      detail:
        "Locale or i18n workflow paths changed. Run i18n parity validation before delivery.",
      severity: "warning",
      requiredVerification: ["pnpm i18n:check"],
      matches: (paths) =>
        paths.some(
          (path) =>
            path.includes("/src/i18n/locales/") ||
            path === "docs/human/i18n-workflow.md",
        ),
    },
    {
      id: "environment",
      title: "Environment-shape verification required",
      detail:
        "Environment shape changed. Keep .env.example and src/env.d.ts aligned.",
      severity: "warning",
      requiredVerification: ["pnpm env:check"],
      matches: (paths) =>
        paths.some(
          (path) =>
            path.endsWith(".env.example") ||
            path.endsWith("src/env.d.ts") ||
            path.includes("/src/env.d.ts"),
        ),
    },
    {
      id: "ai-human-doc-sync",
      title: "AI/human doc sync gate",
      detail:
        "AI-facing workflow or policy docs changed. Odin rules require matching human-facing docs when team-facing behavior changes.",
      severity: "block",
      requiredVerification: ["pnpm verify:docs"],
      matches: (paths) =>
        paths.some(
          (path) =>
            path === "agents.md" ||
            path === "claude.md" ||
            path.startsWith("docs/ai/") ||
            path.startsWith(".codex/") ||
            path.startsWith(".agents/") ||
            path.startsWith(".claude/"),
        ),
      downgradeToWarningWhen: (paths) => hasAnyPath(paths, ["docs/human/"]),
    },
    {
      id: "azure-policy",
      title: "Azure reviewer policy changed",
      detail:
        "Changes under .azuredevops require reviewer policy validation and reviewer-owner attention.",
      severity: "warning",
      requiredVerification: ["pnpm review:policies:check", "pnpm verify:docs"],
      matches: (paths) => paths.some((path) => path.startsWith(".azuredevops/")),
    },
    {
      id: "route-shell",
      title: "Route or shell behavior changed",
      detail:
        "Route, shell, tab, sidebar, or navigation blocker changes should include browser-flow verification.",
      severity: "warning",
      requiredVerification: ["pnpm test:e2e"],
      matches: (paths) =>
        paths.some(
          (path) =>
            path.includes("/src/router/") ||
            path.includes("adminshell") ||
            path.includes("sidenav") ||
            path.includes("topbar") ||
            path.includes("routetabs") ||
            path.includes("navigationblocker"),
        ),
    },
  ],
};

export function evaluatePullRequestRules(
  pullRequest: PullRequestSummary,
  detail: PullRequestDetail,
  rules = ODIN_MT5_WEB_RULES,
): RuleCheckReport {
  const findings: RuleFinding[] = [];
  const requiredVerification = new Set<string>();
  const paths = detail.changes.map((change) => normalizePath(change.path));
  const branchClass = getSourceBranchClass(pullRequest.sourceBranch);
  const lifecycle = getPullRequestLifecycle(pullRequest.status);

  addLifecycleFinding(findings, lifecycle);
  addWorkItemFinding(findings, detail.linkedWorkItems.length);
  addBranchTargetFinding(findings, pullRequest, branchClass, rules);
  addBuildFinding(findings, detail);
  addPathGateFindings(findings, requiredVerification, paths, rules);
  addScopeVerification(requiredVerification, paths, rules);

  if (requiredVerification.size === 0) {
    requiredVerification.add(rules.defaultVerification);
  }

  const status = findings.some((finding) => finding.severity === "block")
    ? "blocked"
    : findings.some((finding) => finding.severity === "warning")
      ? "warning"
      : "passed";
  const verification = [...requiredVerification];
  const stageGate = decideStageGate(lifecycle, status);
  const readiness = buildReadiness(stageGate, findings, verification);

  return {
    pullRequestId: pullRequest.id,
    title: pullRequest.title,
    existingDescription: detail.description || pullRequest.description,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    changedFiles: detail.changes.map((change) => ({
      path: change.path,
      changeType: change.changeType,
      objectType: change.objectType,
    })),
    pullRequestStatus: pullRequest.status,
    lifecycle,
    status,
    stageGate,
    readiness,
    findings,
    requiredVerification: verification,
  };
}

export function buildFailedRuleReport(
  pullRequest: PullRequestSummary,
  error: string,
): RuleCheckReport {
  return {
    pullRequestId: pullRequest.id,
    title: pullRequest.title,
    existingDescription: pullRequest.description,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    changedFiles: [],
    pullRequestStatus: pullRequest.status,
    lifecycle: getPullRequestLifecycle(pullRequest.status),
    status: "blocked",
    stageGate: {
      status: "inspection-failed",
      label: "Inspection failed",
      detail:
        "The App could not read enough Azure PR evidence to calculate a reliable stage gate.",
      deliveryGate: pullRequest.status === "active",
    },
    readiness: {
      decision: "inspection-failed",
      label: "Inspection failed",
      summary:
        "The App could not read enough Azure PR evidence to calculate readiness.",
      blockers: [error],
      reviewItems: [],
      humanDecisions: [],
      requiredVerification: [],
    },
    requiredVerification: [],
    findings: [
      {
        severity: "block",
        title: "PR inspection failed",
        detail: error,
      },
    ],
  };
}

export function summarizeFindings(reports: RuleCheckReport[]) {
  const counts = new Map<string, number>();

  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity === "pass") {
        continue;
      }

      counts.set(finding.title, (counts.get(finding.title) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.title.localeCompare(right.title),
    );
}

export function buildMarkdownReport(reports: RuleCheckReport[]) {
  const summary = reports.reduce(
    (accumulator, report) => {
      accumulator[report.status] += 1;
      return accumulator;
    },
    { blocked: 0, warning: 0, passed: 0 },
  );
  const reasonSummary = summarizeFindings(reports);

  const lines = [
    "# Azure PR Rule Check Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Checked PRs: ${reports.length}`,
    `- Blocked: ${summary.blocked}`,
    `- Warnings: ${summary.warning}`,
    `- Passed: ${summary.passed}`,
    "",
    "## Stage Gates",
    "",
    ...summarizeStageGates(reports).map(
      (item) => `- ${item.label}: ${item.count}`,
    ),
    "",
    "## Finding Summary",
    "",
    ...reasonSummary.map((item) => `- ${item.title}: ${item.count}`),
    "",
    "## PR Results",
    "",
  ];

  for (const report of reports) {
    lines.push(
      `### #${report.pullRequestId} ${report.title}`,
      "",
      `- Status: ${report.status}`,
      `- Stage gate: ${report.stageGate.label}`,
      `- Readiness: ${report.readiness.label}`,
      `- Delivery gate: ${report.stageGate.deliveryGate ? "yes" : "no"}`,
      `- PR lifecycle: ${report.pullRequestStatus}`,
      `- Branch: ${report.sourceBranch} -> ${report.targetBranch}`,
      `- Changed files: ${report.changedFiles.length}`,
      `- Required verification: ${
        report.requiredVerification.length > 0
          ? report.requiredVerification.join(", ")
          : "none"
      }`,
      "",
    );

    if (report.readiness.blockers.length > 0) {
      lines.push("Blockers:");
      for (const blocker of report.readiness.blockers) {
        lines.push(`- ${blocker}`);
      }
      lines.push("");
    }

    if (report.readiness.reviewItems.length > 0) {
      lines.push("Review items:");
      for (const item of report.readiness.reviewItems) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    if (report.readiness.humanDecisions.length > 0) {
      lines.push("Human decisions:");
      for (const item of report.readiness.humanDecisions) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    for (const finding of report.findings) {
      lines.push(
        `- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.detail}`,
      );
    }

    if (report.changedFiles.length > 0) {
      lines.push("", "Changed files:");
      for (const file of report.changedFiles.slice(0, 50)) {
        lines.push(`- ${file.changeType}: ${file.path}`);
      }
      if (report.changedFiles.length > 50) {
        lines.push(`- ... ${report.changedFiles.length - 50} more file(s)`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function buildAgentPacket(
  report: RuleCheckReport,
  requestIntake?: RequestIntakeRecord,
) {
  const requestId = requestIntake?.requestId ?? `PR-${report.pullRequestId}`;
  const nextAgent =
    report.stageGate.status === "ready"
      ? "Agent 3: Review & Test / Delivery Agent"
      : report.stageGate.status === "needs-review"
        ? "Agent 3: Review & Test / Delivery Agent"
        : "Agent 1: Source & Scope Agent";
  const canProceed =
    report.stageGate.status === "ready" ||
    report.stageGate.status === "needs-review";
  const lines = [
    "# Agent Packet",
    "",
    `Request ID: ${requestId}`,
    `Source: ${requestIntake ? `Request Intake + Azure PR #${report.pullRequestId}` : `Azure PR #${report.pullRequestId}`}`,
    `Title: ${requestIntake?.title ?? report.title}`,
    `Recommended next agent: ${nextAgent}`,
    `Can proceed without human decision: ${canProceed ? "yes" : "no"}`,
    "",
    "## Agent Startup Prompt",
    "",
    "```text",
    `You are operating on Request ID: ${requestId}.`,
    `You are ${nextAgent}.`,
    "Only use the provided handoff artifacts and confirmed sources.",
    "Do not use unrelated previous request context.",
    "Do not invent missing requirements, API fields, UI behavior, QA criteria, or implementation scope.",
    "If information is missing, conflicting, or out of scope, stop and report it.",
    "```",
    "",
    "## Confirmed Azure Evidence",
    "",
    `- PR: #${report.pullRequestId}`,
    `- PR status: ${report.pullRequestStatus}`,
    `- Lifecycle: ${report.lifecycle}`,
    `- Source branch: ${report.sourceBranch}`,
    `- Target branch: ${report.targetBranch}`,
    `- Stage gate: ${report.stageGate.label}`,
    `- Readiness: ${report.readiness.label}`,
    `- Delivery gate: ${report.stageGate.deliveryGate ? "yes" : "no"}`,
    "",
    "## Scope",
    "",
    "- Use only the changed files and rule findings listed in this packet.",
    "- Verify the implementation against the PR evidence and repo rule findings.",
    "- Report blockers, missing evidence, source conflicts, or required human decisions.",
    "",
    "## Non-Scope",
    "",
    "- Do not create, abandon, merge, or approve Azure PRs.",
    "- Do not update Work Items, reviewers, branch policies, pipelines, or deployments.",
    "- Do not install packages, modify environment settings, or perform large refactors without human approval.",
    "- Do not treat provisional checks as QA-confirmed evidence.",
    "",
    "## Stage Gate Result",
    "",
    report.readiness.summary,
    "",
  ];

  if (requestIntake) {
    lines.push(
      "## User Request",
      "",
      `- Request kind: ${requestIntake.kind}`,
      `- Task Level: ${requestIntake.taskLevel}`,
      `- Intake title: ${requestIntake.title}`,
      `- Optional Azure reference: ${formatAgentPacketAzureReference(requestIntake)}`,
      "",
      requestIntake.detail,
      "",
      "This user request is intake evidence only. It is not confirmed Spec, Figma, Swagger/API, QA, or implementation scope.",
      "",
    );
  }

  appendReadinessSection(lines, "Blockers", report.readiness.blockers);
  appendReadinessSection(lines, "Review items", report.readiness.reviewItems);
  appendReadinessSection(
    lines,
    "Human decisions",
    report.readiness.humanDecisions,
  );
  appendReadinessSection(
    lines,
    "Required verification",
    report.readiness.requiredVerification,
  );

  lines.push("## Rule Findings", "");
  for (const finding of report.findings) {
    lines.push(
      `- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.detail}`,
    );
  }

  lines.push("", "## Changed Files", "");
  if (report.changedFiles.length === 0) {
    lines.push("- No changed file evidence was available in this packet.");
  } else {
    for (const file of report.changedFiles.slice(0, 100)) {
      lines.push(`- ${file.changeType}: ${file.path}`);
    }
    if (report.changedFiles.length > 100) {
      lines.push(`- ... ${report.changedFiles.length - 100} more file(s)`);
    }
  }

  lines.push(
    "",
    "## Stop Conditions",
    "",
    "- Missing source blocks implementation.",
    "- Source conflict exists.",
    "- Confirmed source or scope must be exceeded.",
    "- Work requires env change, package installation, deployment, file deletion, large refactor, or shared core module modification.",
    "- Review evidence is missing.",
    "",
    "_Generated by Azure AI Control Plane from Azure PR evidence and repo rule checks._",
  );

  return lines.join("\n");
}

export function buildPullRequestReadinessComment(report: RuleCheckReport) {
  const lines = [
    CONTROL_PLANE_READINESS_COMMENT_MARKER,
    "## AI Development Control Plane Readiness",
    "",
    `- PR: #${report.pullRequestId}`,
    `- Stage gate: ${report.stageGate.label}`,
    `- Readiness: ${report.readiness.label}`,
    `- Delivery gate: ${report.stageGate.deliveryGate ? "yes" : "no"}`,
    `- Lifecycle: ${report.pullRequestStatus}`,
    `- Branch: ${report.sourceBranch} -> ${report.targetBranch}`,
    "",
    report.readiness.summary,
    "",
  ];

  appendReadinessSection(lines, "Blockers", report.readiness.blockers);
  appendReadinessSection(lines, "Review items", report.readiness.reviewItems);
  appendReadinessSection(
    lines,
    "Human decisions",
    report.readiness.humanDecisions,
  );
  appendReadinessSection(
    lines,
    "Required verification",
    report.readiness.requiredVerification,
  );

  lines.push(
    "### Evidence",
    "",
    ...report.findings.map(
      (finding) =>
        `- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.detail}`,
    ),
    "",
    "_Generated by Azure AI Control Plane. Confirm human decisions before delivery._",
  );

  return lines.join("\n");
}

export function buildPullRequestDescriptionPreview(report: RuleCheckReport) {
  return mergePullRequestDescription(
    report.existingDescription,
    buildControlPlaneDescriptionBlock(report),
  );
}

export function buildCreatePullRequestDescription(input: {
  sourceBranch: string;
  targetBranch: string;
}) {
  const lines = [
    CONTROL_PLANE_DESCRIPTION_START_MARKER,
    "## AI Development Control Plane",
    "",
    "- Stage gate: Pending rule check",
    "- Readiness: Pending Azure PR evidence",
    `- Branch: ${input.sourceBranch} -> ${input.targetBranch}`,
    "- Delivery gate: yes",
    "",
    "Run Delivery Gate after the PR is created to read changed files, linked Work Items, build evidence, and repo rule findings.",
    "",
    "### Required verification",
    "",
    `- ${ODIN_MT5_WEB_RULES.defaultVerification}`,
    "",
    "### Human decisions",
    "",
    "- Confirm linked Work Item after PR creation.",
    "- Confirm reviewers and target branch policy before delivery.",
    "",
    "_Generated by Azure AI Control Plane. This preview has not been written to Azure DevOps._",
    CONTROL_PLANE_DESCRIPTION_END_MARKER,
  ];

  return lines.join("\n");
}

export function getRecommendedTargetBranch(sourceBranch: string) {
  const branchClass = getSourceBranchClass(sourceBranch);
  const allowedTargets = ODIN_MT5_WEB_RULES.branchTargets[branchClass];

  return allowedTargets?.[0] ?? ODIN_MT5_WEB_RULES.protectedBranches[2];
}

export function isProtectedBranch(branch: string) {
  return ODIN_MT5_WEB_RULES.protectedBranches.includes(branch);
}

export function getCreatePullRequestWarnings(input: {
  sourceBranch: string;
  targetBranch: string;
}) {
  const warnings: string[] = [];
  const branchClass = getSourceBranchClass(input.sourceBranch);
  const pendingPolicy = ODIN_MT5_WEB_RULES.pendingBranchTargetClasses[branchClass];
  const allowedTargets = ODIN_MT5_WEB_RULES.branchTargets[branchClass];

  if (pendingPolicy) {
    warnings.push(pendingPolicy);
  }

  if (allowedTargets && !allowedTargets.includes(input.targetBranch)) {
    warnings.push(
      `${branchClass} branches should target ${allowedTargets.join(
        " or ",
      )}, but the selected target is ${input.targetBranch}.`,
    );
  }

  if (!allowedTargets && !pendingPolicy) {
    warnings.push(
      "Source branch is not feature/*, bug/*, or hotfix/*. Confirm this branch follows team GitFlow before creating the PR.",
    );
  }

  return warnings;
}

export function hasControlPlaneDescriptionBlock(description: string) {
  return (
    description.includes(CONTROL_PLANE_DESCRIPTION_START_MARKER) &&
    description.includes(CONTROL_PLANE_DESCRIPTION_END_MARKER)
  );
}

export function hasControlPlaneReadinessComment(comment: string) {
  return comment.includes(CONTROL_PLANE_READINESS_COMMENT_MARKER);
}

function buildControlPlaneDescriptionBlock(report: RuleCheckReport) {
  const lines = [
    CONTROL_PLANE_DESCRIPTION_START_MARKER,
    "## AI Development Control Plane",
    "",
    `- Stage gate: ${report.stageGate.label}`,
    `- Readiness: ${report.readiness.label}`,
    `- Branch: ${report.sourceBranch} -> ${report.targetBranch}`,
    `- Delivery gate: ${report.stageGate.deliveryGate ? "yes" : "no"}`,
    "",
    report.readiness.summary,
    "",
  ];

  appendReadinessSection(lines, "Blockers", report.readiness.blockers);
  appendReadinessSection(lines, "Review items", report.readiness.reviewItems);
  appendReadinessSection(
    lines,
    "Human decisions",
    report.readiness.humanDecisions,
  );
  appendReadinessSection(
    lines,
    "Required verification",
    report.readiness.requiredVerification,
  );

  lines.push(
    "### Rule Evidence",
    "",
    ...report.findings.map(
      (finding) =>
        `- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.detail}`,
    ),
    "",
    "_Generated by Azure AI Control Plane. This preview has not been written to Azure DevOps._",
    CONTROL_PLANE_DESCRIPTION_END_MARKER,
  );

  return lines.join("\n");
}

function mergePullRequestDescription(existingDescription: string, block: string) {
  const existing = existingDescription.trim();
  const startIndex = existing.indexOf(CONTROL_PLANE_DESCRIPTION_START_MARKER);
  const endIndex = existing.indexOf(CONTROL_PLANE_DESCRIPTION_END_MARKER);

  if (startIndex >= 0 && endIndex > startIndex) {
    const blockEndIndex =
      endIndex + CONTROL_PLANE_DESCRIPTION_END_MARKER.length;
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(blockEndIndex).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n");
  }

  if (!existing) {
    return block;
  }

  return `${existing}\n\n${block}`;
}

export function getBuildEvidence(evidence: BuildEvidence[]): {
  state: "passed" | "failed" | "unresolved";
  label: string;
  source: string;
  url?: string;
} {
  const failed = evidence.find((item) =>
    ["failed", "error", "rejected"].includes(item.state.toLowerCase()),
  );

  if (failed) {
    return {
      state: "failed",
      label: failed.label,
      source: failed.source,
      url: failed.url,
    };
  }

  const pending = evidence.find((item) =>
    ["pending", "notset", "notapplicable"].includes(item.state.toLowerCase()),
  );

  if (pending) {
    return {
      state: "failed",
      label: pending.label,
      source: pending.source,
      url: pending.url,
    };
  }

  const succeeded = evidence.find((item) =>
    ["succeeded", "approved"].includes(item.state.toLowerCase()),
  );

  if (succeeded) {
    return {
      state: "passed",
      label: succeeded.label,
      source: succeeded.source,
      url: succeeded.url,
    };
  }

  return { state: "unresolved", label: "Unresolved", source: "none" };
}

function appendReadinessSection(
  lines: string[],
  title: string,
  items: string[],
) {
  if (items.length === 0) {
    return;
  }

  lines.push(`### ${title}`, "");
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

function formatAgentPacketAzureReference(record: RequestIntakeRecord) {
  if (record.azureReferenceType === "pr" && record.azureReferenceId) {
    return `Azure PR #${record.azureReferenceId}`;
  }

  if (record.azureReferenceType === "work-item" && record.azureReferenceId) {
    return `Azure 單號: ${record.azureReferenceId}`;
  }

  return "none";
}

export function summarizeStageGates(reports: RuleCheckReport[]) {
  const labels: Record<StageGateStatus, string> = {
    ready: "Ready",
    blocked: "Blocked",
    "needs-review": "Needs review",
    historical: "Historical",
    "inspection-failed": "Inspection failed",
  };
  const counts = new Map<StageGateStatus, number>();

  for (const report of reports) {
    counts.set(
      report.stageGate.status,
      (counts.get(report.stageGate.status) ?? 0) + 1,
    );
  }

  return ([...counts.entries()] as Array<[StageGateStatus, number]>).map(
    ([status, count]) => ({
      status,
      label: labels[status],
      count,
    }),
  );
}

export function summarizeReadiness(reports: RuleCheckReport[]) {
  return {
    blockers: reports.reduce(
      (count, report) => count + report.readiness.blockers.length,
      0,
    ),
    reviewItems: reports.reduce(
      (count, report) => count + report.readiness.reviewItems.length,
      0,
    ),
    humanDecisions: reports.reduce(
      (count, report) => count + report.readiness.humanDecisions.length,
      0,
    ),
    requiredVerification: [
      ...new Set(
        reports.flatMap((report) => report.readiness.requiredVerification),
      ),
    ],
  };
}

function addLifecycleFinding(
  findings: RuleFinding[],
  lifecycle: PullRequestLifecycle,
) {
  if (lifecycle === "abandoned") {
    findings.push({
      severity: "warning",
      title: "Historical abandoned PR",
      detail:
        "This PR is abandoned. Treat this report as a historical audit, not a current delivery gate.",
    });
    return;
  }

  if (lifecycle === "completed") {
    findings.push({
      severity: "pass",
      title: "Historical completed PR",
      detail:
        "This PR is completed. Treat this report as historical compliance evidence.",
    });
    return;
  }

  if (lifecycle === "active") {
    findings.push({
      severity: "pass",
      title: "Active PR",
      detail: "This PR is active and should satisfy delivery gates before merge.",
    });
  }
}

function addWorkItemFinding(findings: RuleFinding[], linkedWorkItemCount: number) {
  if (linkedWorkItemCount === 0) {
    findings.push({
      severity: "block",
      title: "Missing linked Work Item",
      detail:
        "Odin PR governance requires the PR to link the corresponding Azure Boards Work Item.",
    });
    return;
  }

  findings.push({
    severity: "pass",
    title: "Linked Work Item present",
    detail: `${linkedWorkItemCount} linked Work Item(s) were returned by Azure DevOps.`,
  });
}

function addBranchTargetFinding(
  findings: RuleFinding[],
  pullRequest: PullRequestSummary,
  branchClass: BranchClass,
  rules: RepoRuleConfig,
) {
  const pendingPolicy = rules.pendingBranchTargetClasses[branchClass];

  if (pendingPolicy) {
    findings.push({
      severity: "warning",
      title: "Branch target policy pending",
      detail: pendingPolicy,
    });
    return;
  }

  const allowedTargets = rules.branchTargets[branchClass] ?? [];

  if (allowedTargets.length > 0) {
    if (!allowedTargets.includes(pullRequest.targetBranch)) {
      findings.push({
        severity: "block",
        title: "Unexpected target branch",
        detail: `${branchClass} branches should target ${allowedTargets.join(
          " or ",
        )}, but this PR targets ${pullRequest.targetBranch}.`,
      });
      return;
    }

    findings.push({
      severity: "pass",
      title: "Branch target looks aligned",
      detail: `${pullRequest.sourceBranch} to ${pullRequest.targetBranch}.`,
    });
    return;
  }

  findings.push({
    severity: "warning",
    title: "Unclassified source branch",
    detail:
      "Source branch is not feature/*, bug/*, or hotfix/*. Confirm this branch follows team GitFlow.",
  });
}

function getPullRequestLifecycle(status: string): PullRequestLifecycle {
  if (status === "active" || status === "completed" || status === "abandoned") {
    return status;
  }

  return "unknown";
}

function decideStageGate(
  lifecycle: PullRequestLifecycle,
  status: RuleCheckReport["status"],
): StageGateDecision {
  if (lifecycle === "completed") {
    return {
      status: "historical",
      label: "Historical",
      detail:
        "Completed PRs are retained for compliance evidence and are not current delivery gates.",
      deliveryGate: false,
    };
  }

  if (lifecycle === "abandoned") {
    return {
      status: "historical",
      label: "Historical",
      detail:
        "Abandoned PRs are retained for audit context and are not current delivery gates.",
      deliveryGate: false,
    };
  }

  if (status === "blocked") {
    return {
      status: "blocked",
      label: "Blocked",
      detail: "Active PR has blocking findings and should not be delivered.",
      deliveryGate: true,
    };
  }

  if (status === "warning") {
    return {
      status: "needs-review",
      label: "Needs review",
      detail:
        "Active PR has warnings or pending policy decisions that need review before delivery.",
      deliveryGate: true,
    };
  }

  return {
    status: "ready",
    label: "Ready",
    detail: "Active PR satisfies the currently automated stage gate checks.",
    deliveryGate: true,
  };
}

function buildReadiness(
  stageGate: StageGateDecision,
  findings: RuleFinding[],
  requiredVerification: string[],
): PullRequestReadiness {
  const blockers = findings
    .filter((finding) => finding.severity === "block")
    .map(formatFindingForReadiness);
  const reviewItems = findings
    .filter((finding) => finding.severity === "warning")
    .map(formatFindingForReadiness);
  const humanDecisions = findings
    .filter((finding) =>
      [
        "Branch target policy pending",
        "Unclassified source branch",
        "Build evidence unresolved",
        "Hotfix target needs review",
      ].includes(finding.title),
    )
    .map(formatFindingForReadiness);

  if (stageGate.status === "historical") {
    return {
      decision: "not-current",
      label: "Not current",
      summary:
        "This PR is historical evidence only. Do not use it as a current delivery decision.",
      blockers,
      reviewItems,
      humanDecisions,
      requiredVerification,
    };
  }

  if (stageGate.status === "inspection-failed") {
    return {
      decision: "inspection-failed",
      label: "Inspection failed",
      summary:
        "Azure evidence was incomplete. Re-run after connector or permission issues are resolved.",
      blockers,
      reviewItems,
      humanDecisions,
      requiredVerification,
    };
  }

  if (stageGate.status === "blocked") {
    return {
      decision: "blocked",
      label: "Blocked",
      summary:
        "This active PR has blocking findings and is not ready for delivery.",
      blockers,
      reviewItems,
      humanDecisions,
      requiredVerification,
    };
  }

  if (stageGate.status === "needs-review") {
    return {
      decision: "needs-review",
      label: "Needs review",
      summary:
        "This active PR has warnings or pending decisions that require review before delivery.",
      blockers,
      reviewItems,
      humanDecisions,
      requiredVerification,
    };
  }

  return {
    decision: "deliverable",
    label: "Deliverable",
    summary:
      "This active PR satisfies the currently automated readiness checks.",
    blockers,
    reviewItems,
    humanDecisions,
    requiredVerification,
  };
}

function formatFindingForReadiness(finding: RuleFinding) {
  return `${finding.title}: ${finding.detail}`;
}

function addBuildFinding(
  findings: RuleFinding[],
  detail: PullRequestDetail,
) {
  const buildEvidence = getBuildEvidence(detail.buildEvidence);

  if (buildEvidence.state === "unresolved") {
    findings.push({
      severity: "warning",
      title: "Build evidence unresolved",
      detail: `No build evidence was returned from: ${detail.buildEvidenceSourcesChecked.join(
        ", ",
      )}. This needs investigation before using build status as a delivery gate.`,
    });
    return;
  }

  if (buildEvidence.state === "failed") {
    findings.push({
      severity: "block",
      title: "Build is not succeeded",
      detail: `Build evidence is "${buildEvidence.label}".`,
    });
    return;
  }

  findings.push({
    severity: "pass",
    title: "Build succeeded",
    detail: `Azure returned successful build evidence from ${buildEvidence.source}.`,
  });
}

function addPathGateFindings(
  findings: RuleFinding[],
  requiredVerification: Set<string>,
  paths: string[],
  rules: RepoRuleConfig,
) {
  for (const gate of rules.pathGates) {
    if (!gate.matches(paths)) {
      continue;
    }

    for (const command of gate.requiredVerification) {
      requiredVerification.add(command);
    }

    findings.push({
      severity: gate.downgradeToWarningWhen?.(paths) ? "warning" : gate.severity,
      title: gate.title,
      detail: gate.detail,
    });
  }
}

function addScopeVerification(
  requiredVerification: Set<string>,
  paths: string[],
  rules: RepoRuleConfig,
) {
  for (const scope of rules.appScopeVerification) {
    if (paths.some((path) => path.startsWith(scope.prefix))) {
      requiredVerification.add(scope.command);
    }
  }

  if (
    paths.some(
      (path) =>
        path.endsWith(".md") ||
        path.startsWith("docs/") ||
        path.startsWith(".codex/") ||
        path.startsWith(".agents/") ||
        path.startsWith(".azuredevops/"),
    )
  ) {
    requiredVerification.add("pnpm verify:docs");
  }
}

function normalizePath(path: string) {
  return path.replace(/^\/+/, "").toLowerCase();
}

function getSourceBranchClass(branch: string): BranchClass {
  if (branch.startsWith("feature/")) {
    return "feature";
  }

  if (branch.startsWith("bug/")) {
    return "bug";
  }

  if (isAiTrainingBranch(branch)) {
    return "ai-training";
  }

  if (branch === "hotfix" || branch.startsWith("hotfix/")) {
    return "hotfix";
  }

  return "other";
}

function hasAnyPath(paths: string[], prefixes: string[]) {
  return paths.some((path) =>
    prefixes.some((prefix) => path.startsWith(prefix.toLowerCase())),
  );
}

function isAiTrainingBranch(branch: string) {
  const normalized = branch.toLowerCase();
  return (
    normalized.startsWith("aitraining/") ||
    normalized.startsWith("ai_training/")
  );
}
