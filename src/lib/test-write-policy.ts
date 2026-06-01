export const TEST_WRITE_BRANCH_PREFIX = "AITraining/";
export const TEAM_PR_BASE_BRANCH = "develop";
export const TEAM_PR_BRANCH_PREFIXES = ["feature", "bug", "hotfix"] as const;
export type TeamPrBranchKind = (typeof TEAM_PR_BRANCH_PREFIXES)[number];

export function normalizeBranchName(branchOrRef: string) {
  return branchOrRef.trim().replace(/^refs\/heads\//, "");
}

export function isTestWriteAllowedBranch(branchOrRef: string) {
  return normalizeBranchName(branchOrRef).startsWith(TEST_WRITE_BRANCH_PREFIX);
}

export function getTestWritePolicyMessage(branchOrRef: string) {
  const branch = normalizeBranchName(branchOrRef);
  return `Testing-stage Azure writes are limited to ${TEST_WRITE_BRANCH_PREFIX} branches. "${branch}" is read-only.`;
}

export function isTeamPrDeliveryBranch(branchOrRef: string) {
  const branch = normalizeBranchName(branchOrRef);
  return /^(feature|bug|hotfix)\/\d+$/.test(branch);
}

export function isTeamPrDeliveryTargetBranch(branchOrRef: string) {
  return normalizeBranchName(branchOrRef) === TEAM_PR_BASE_BRANCH;
}

export function buildTeamPrDeliveryBranch(input: {
  workItemId: string;
  workItemType?: string;
  requestKind?: string;
}) {
  const workItemId = input.workItemId.trim();
  if (!/^\d+$/.test(workItemId)) {
    return "";
  }

  const branchKind = getTeamPrBranchKind(input);
  return `${branchKind}/${workItemId}`;
}

export function getTeamPrBranchKind(input: {
  workItemType?: string;
  requestKind?: string;
}): TeamPrBranchKind {
  const workItemType = input.workItemType?.trim().toLowerCase() ?? "";
  const requestKind = input.requestKind?.trim().toUpperCase() ?? "";
  if (workItemType === "hotfix" || requestKind === "HOTFIX") {
    return "hotfix";
  }

  return workItemType === "bug" || requestKind === "BUG" ? "bug" : "feature";
}

export function getTeamPrDeliveryPolicyMessage(branchOrRef: string) {
  const branch = normalizeBranchName(branchOrRef);
  return `Formal PR delivery branches must be feature/{workItemId}, bug/{workItemId}, or hotfix/{workItemId} targeting ${TEAM_PR_BASE_BRANCH}. "${branch}" is not a formal delivery branch.`;
}
