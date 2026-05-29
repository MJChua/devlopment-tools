import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  getRequest,
  linkPullRequestToWorkflow,
} from "@/lib/control-plane-db";
import { getPrDeliveryTraceForRequest } from "@/lib/control-plane-workflow";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

export const runtime = "nodejs";

type PullRequestLinkBody = AzureRequestBody & {
  pullRequestId?: number | string;
  actor?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as PullRequestLinkBody;
    const pullRequestId = Number(body.pullRequestId);

    if (!Number.isInteger(pullRequestId) || pullRequestId <= 0) {
      return NextResponse.json(
        { error: "pullRequestId must be a positive integer." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const workflowRequest = getRequest(requestId);
    if (!workflowRequest) {
      return NextResponse.json(
        { error: "Request not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (workflowRequest.deliveryMode !== "draft_pr") {
      return NextResponse.json(
        { error: "Only draft PR delivery requests can link Azure PRs." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      workflowRequest.status !== "pr_ready" &&
      workflowRequest.status !== "pr_created"
    ) {
      return NextResponse.json(
        {
          error:
            "Azure PR links can only be recorded after the request reaches PR Ready.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const pullRequest = await client.getPullRequestDetail(pullRequestId);

    if (pullRequest.status.toLowerCase() !== "active") {
      return NextResponse.json(
        {
          error: `Only active Azure PRs can be linked. PR ${pullRequestId} is ${pullRequest.status}.`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const trace = getPrDeliveryTraceForRequest(workflowRequest);
    if (
      trace.sourceBranch &&
      (pullRequest.sourceBranch !== trace.sourceBranch ||
        pullRequest.targetBranch !== trace.baseBranch)
    ) {
      return NextResponse.json(
        {
          error: `Azure PR #${pullRequestId} does not match this request branch. Expected ${trace.sourceBranch} -> ${trace.baseBranch}, got ${pullRequest.sourceBranch} -> ${pullRequest.targetBranch}.`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const link = linkPullRequestToWorkflow({
      requestId,
      pullRequestId: pullRequest.pullRequestId,
      webUrl: pullRequest.webUrl,
      trace,
      actor: body.actor,
    });

    return NextResponse.json(
      { link },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
