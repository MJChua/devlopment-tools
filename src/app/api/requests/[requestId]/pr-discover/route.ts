import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  getRequest,
  linkPullRequestToWorkflow,
  recordPullRequestDiscovery,
} from "@/lib/control-plane-db";
import { getPrDeliveryTraceForRequest } from "@/lib/control-plane-workflow";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

export const runtime = "nodejs";

type PullRequestDiscoverBody = AzureRequestBody & {
  actor?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as PullRequestDiscoverBody;
    const workflowRequest = getRequest(requestId);
    if (!workflowRequest) {
      return NextResponse.json(
        { error: "Request not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (workflowRequest.deliveryMode !== "draft_pr") {
      return NextResponse.json(
        { error: "Only draft PR delivery requests can discover Azure PRs." },
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
            "Azure PR discovery can only run after the request reaches PR Ready.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const expectedTrace = getPrDeliveryTraceForRequest(workflowRequest);
    if (!expectedTrace.sourceBranch) {
      const trace = recordPullRequestDiscovery({
        requestId,
        trace: {
          ...expectedTrace,
          discoveryStatus: "failed",
          reason:
            expectedTrace.reason ||
            "Cannot derive a request branch without an Azure Work Item number.",
        },
        actor: body.actor,
      });
      return NextResponse.json(
        { trace, matches: [] },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const matches = await client.findActivePullRequestsForBranches(
      expectedTrace.sourceBranch,
      expectedTrace.baseBranch,
      10,
    );

    if (matches.length === 0) {
      const trace = recordPullRequestDiscovery({
        requestId,
        trace: {
          ...expectedTrace,
          discoveryStatus: "not_found",
          reason: `No active Azure PR found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
        },
        actor: body.actor,
      });
      return NextResponse.json(
        { trace, matches },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (matches.length > 1) {
      const trace = recordPullRequestDiscovery({
        requestId,
        trace: {
          ...expectedTrace,
          discoveryStatus: "ambiguous",
          reason: `Multiple active Azure PRs found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
        },
        actor: body.actor,
      });
      return NextResponse.json(
        { trace, matches },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [pullRequest] = matches;
    const link = linkPullRequestToWorkflow({
      requestId,
      pullRequestId: pullRequest.pullRequestId,
      webUrl: pullRequest.webUrl,
      trace: {
        ...expectedTrace,
        discoveryStatus: "found",
        pullRequestId: pullRequest.pullRequestId,
        webUrl: pullRequest.webUrl,
        reason: `Active Azure PR #${pullRequest.pullRequestId} found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
      },
      actor: body.actor,
    });

    return NextResponse.json(
      {
        trace: {
          ...expectedTrace,
          discoveryStatus: "found",
          pullRequestId: pullRequest.pullRequestId,
          webUrl: pullRequest.webUrl,
          reason: `Active Azure PR #${pullRequest.pullRequestId} found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
        },
        link,
        matches,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
