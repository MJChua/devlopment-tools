import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  AZURE_PR_DESCRIPTION_LIMIT,
  hasControlPlaneDescriptionBlock,
} from "@/lib/repo-rule-engine";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

type DescriptionRequestBody = AzureRequestBody & {
  description?: string;
  confirmWrite?: boolean;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ pullRequestId: string }> },
) {
  try {
    const { pullRequestId } = await params;
    const parsedPullRequestId = Number(pullRequestId);

    if (!Number.isInteger(parsedPullRequestId) || parsedPullRequestId <= 0) {
      return NextResponse.json(
        { error: "pullRequestId must be a positive integer." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as DescriptionRequestBody;

    if (body.confirmWrite !== true) {
      return NextResponse.json(
        {
          error:
            "Azure write confirmation is required before updating a PR description.",
        },
        { status: 400 },
      );
    }

    const description = body.description?.trim();
    if (!description) {
      return NextResponse.json(
        { error: "description is required." },
        { status: 400 },
      );
    }

    if (description.length > AZURE_PR_DESCRIPTION_LIMIT) {
      return NextResponse.json(
        {
          error: `description must be ${AZURE_PR_DESCRIPTION_LIMIT} characters or less.`,
        },
        { status: 400 },
      );
    }

    if (!hasControlPlaneDescriptionBlock(description)) {
      return NextResponse.json(
        {
          error:
            "description must contain the Azure AI Control Plane marker block.",
        },
        { status: 400 },
      );
    }

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const result = await client.updatePullRequestDescription(
      parsedPullRequestId,
      description,
    );

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
