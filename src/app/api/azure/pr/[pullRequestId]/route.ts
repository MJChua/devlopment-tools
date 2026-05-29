import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

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

    const body = (await request.json()) as AzureRequestBody;
    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const detail = await client.getPullRequestDetail(parsedPullRequestId);

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error), detailUnavailable: true },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
