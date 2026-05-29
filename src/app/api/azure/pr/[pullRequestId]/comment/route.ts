import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  AZURE_PR_COMMENT_LIMIT,
  hasControlPlaneReadinessComment,
} from "@/lib/repo-rule-engine";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

type CommentRequestBody = AzureRequestBody & {
  comment?: {
    content?: string;
  };
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

    const body = (await request.json()) as CommentRequestBody;

    if (body.confirmWrite !== true) {
      return NextResponse.json(
        {
          error:
            "Azure write confirmation is required before posting a PR comment.",
        },
        { status: 400 },
      );
    }

    const content = body.comment?.content?.trim();
    if (!content) {
      return NextResponse.json(
        { error: "comment.content is required." },
        { status: 400 },
      );
    }

    if (content.length > AZURE_PR_COMMENT_LIMIT) {
      return NextResponse.json(
        {
          error: `comment.content must be ${AZURE_PR_COMMENT_LIMIT} characters or less.`,
        },
        { status: 400 },
      );
    }

    if (!hasControlPlaneReadinessComment(content)) {
      return NextResponse.json(
        {
          error:
            "comment.content must contain the Azure AI Control Plane readiness marker.",
        },
        { status: 400 },
      );
    }

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const thread = await client.createPullRequestCommentThread(
      parsedPullRequestId,
      content,
    );

    return NextResponse.json(thread, {
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
