export const TEST_WRITE_BRANCH_PREFIX = "AITraining/";

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
