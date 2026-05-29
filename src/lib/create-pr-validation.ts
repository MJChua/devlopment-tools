import {
  AZURE_PR_DESCRIPTION_LIMIT,
  getCreatePullRequestWarnings,
  hasControlPlaneDescriptionBlock,
  isProtectedBranch,
} from "./repo-rule-engine.ts";
import {
  getTestWritePolicyMessage,
  isTestWriteAllowedBranch,
} from "./test-write-policy.ts";

export type CreatePullRequestValidationBody = {
  pullRequest?: {
    sourceBranch?: string;
    targetBranch?: string;
    title?: string;
    description?: string;
    isDraft?: boolean;
    policyAcknowledged?: boolean;
  };
  confirmWrite?: boolean;
};

export type CreatePullRequestValidationResult =
  | {
      ok: true;
      pullRequest: {
        sourceBranch: string;
        targetBranch: string;
        title: string;
        description: string;
        isDraft: boolean;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      policyWarnings?: string[];
    };

export function validateCreatePullRequestBody(
  body: CreatePullRequestValidationBody,
): CreatePullRequestValidationResult {
  if (body.confirmWrite !== true) {
    return {
      ok: false,
      status: 400,
      error: "Azure write confirmation is required before creating a pull request.",
    };
  }

  const sourceBranch = body.pullRequest?.sourceBranch?.trim();
  const targetBranch = body.pullRequest?.targetBranch?.trim();
  const title = body.pullRequest?.title?.trim();
  const description = body.pullRequest?.description?.trim();

  if (!sourceBranch || !targetBranch || !title || !description) {
    return {
      ok: false,
      status: 400,
      error:
        "pullRequest.sourceBranch, targetBranch, title, and description are required.",
    };
  }

  if (sourceBranch === targetBranch) {
    return {
      ok: false,
      status: 400,
      error: "sourceBranch and targetBranch must be different.",
    };
  }

  if (isProtectedBranch(sourceBranch)) {
    return {
      ok: false,
      status: 400,
      error: "sourceBranch must not be a protected branch for MVP PR creation.",
    };
  }

  if (!isTestWriteAllowedBranch(sourceBranch)) {
    return {
      ok: false,
      status: 400,
      error: getTestWritePolicyMessage(sourceBranch),
    };
  }

  if (!isProtectedBranch(targetBranch)) {
    return {
      ok: false,
      status: 400,
      error: "targetBranch must be a configured protected branch for MVP PR creation.",
    };
  }

  if (description.length > AZURE_PR_DESCRIPTION_LIMIT) {
    return {
      ok: false,
      status: 400,
      error: `description must be ${AZURE_PR_DESCRIPTION_LIMIT} characters or less.`,
    };
  }

  if (!hasControlPlaneDescriptionBlock(description)) {
    return {
      ok: false,
      status: 400,
      error: "description must contain the Azure AI Control Plane marker block.",
    };
  }

  const policyWarnings = getCreatePullRequestWarnings({
    sourceBranch,
    targetBranch,
  });

  if (policyWarnings.length > 0 && body.pullRequest?.policyAcknowledged !== true) {
    return {
      ok: false,
      status: 400,
      error:
        "Branch policy warnings require explicit acknowledgement before creating a pull request.",
      policyWarnings,
    };
  }

  return {
    ok: true,
    pullRequest: {
      sourceBranch,
      targetBranch,
      title,
      description,
      isDraft: body.pullRequest?.isDraft ?? true,
    },
  };
}
