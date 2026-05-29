import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

type WorkItemLinkRequestBody = AzureRequestBody & {
  workItemId?: string;
  confirmWrite?: boolean;
};

export async function POST(
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

    const body = (await request.json()) as WorkItemLinkRequestBody;

    if (body.confirmWrite !== true) {
      return NextResponse.json(
        {
          error:
            "Azure write confirmation is required before linking a Work Item.",
        },
        { status: 400 },
      );
    }

    const workItemId = body.workItemId?.trim();
    const parsedWorkItemId = Number(workItemId);

    if (
      !workItemId ||
      !Number.isInteger(parsedWorkItemId) ||
      parsedWorkItemId <= 0
    ) {
      return NextResponse.json(
        { error: "workItemId must be a positive integer." },
        { status: 400 },
      );
    }

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const result = await client.linkWorkItemToPullRequest(
      parsedPullRequestId,
      workItemId,
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
