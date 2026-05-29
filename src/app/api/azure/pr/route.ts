import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import { validateCreatePullRequestBody } from "@/lib/create-pr-validation";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

type CreatePullRequestBody = AzureRequestBody & {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreatePullRequestBody;
    const validation = validateCreatePullRequestBody(body);

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.error,
          policyWarnings: validation.policyWarnings,
        },
        { status: validation.status },
      );
    }

    const { pullRequest } = validation;

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const existingPullRequest = await client.findActivePullRequestForBranches(
      pullRequest.sourceBranch,
      pullRequest.targetBranch,
    );

    if (existingPullRequest) {
      return NextResponse.json(
        {
          error: `Active PR #${existingPullRequest.pullRequestId} already exists for ${pullRequest.sourceBranch} -> ${pullRequest.targetBranch}.`,
          existingPullRequest,
        },
        { status: 409 },
      );
    }

    const result = await client.createPullRequest({
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      title: pullRequest.title,
      description: pullRequest.description,
      isDraft: pullRequest.isDraft,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
