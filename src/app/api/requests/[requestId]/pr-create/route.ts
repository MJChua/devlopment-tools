import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  getRequest,
  linkPullRequestToWorkflow,
} from "@/lib/control-plane-db";
import { getPrDeliveryTraceForRequest } from "@/lib/control-plane-workflow";
import {
  buildCreatePullRequestDescription,
  getCreatePullRequestWarnings,
} from "@/lib/repo-rule-engine";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";
import { isTeamPrDeliveryBranch } from "@/lib/test-write-policy";

export const runtime = "nodejs";

type PullRequestCreateBody = AzureRequestBody & {
  actor?: string;
  confirmWrite?: boolean;
  policyAcknowledged?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as PullRequestCreateBody;
    const workflowRequest = getRequest(requestId);
    if (!workflowRequest) {
      return NextResponse.json(
        { error: "Request not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (body.confirmWrite !== true) {
      return NextResponse.json(
        { error: "Azure write confirmation is required before creating a pull request." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (workflowRequest.deliveryMode !== "draft_pr") {
      return NextResponse.json(
        { error: "Only draft PR delivery requests can create Azure PRs." },
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
            "Azure PR creation can only run after the request reaches PR Ready.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const expectedTrace = getPrDeliveryTraceForRequest(workflowRequest);
    if (!expectedTrace.sourceBranch) {
      return NextResponse.json(
        {
          error:
            expectedTrace.reason ||
            "Cannot derive a request branch without a verified Azure Work Item.",
          trace: expectedTrace,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!isTeamPrDeliveryBranch(expectedTrace.sourceBranch)) {
      return NextResponse.json(
        {
          error:
            "Formal PR creation requires feature/{id}, bug/{id}, or hotfix/{id}.",
          trace: expectedTrace,
        },
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

    if (matches.length > 1) {
      return NextResponse.json(
        {
          error: `Multiple active Azure PRs found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
          trace: {
            ...expectedTrace,
            discoveryStatus: "ambiguous",
            reason: `Multiple active Azure PRs found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
          },
          matches,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const policyWarnings = getCreatePullRequestWarnings({
      sourceBranch: expectedTrace.sourceBranch,
      targetBranch: expectedTrace.baseBranch,
    });
    if (matches.length === 0 && policyWarnings.length > 0 && body.policyAcknowledged !== true) {
      return NextResponse.json(
        {
          error:
            "Branch policy warnings require explicit acknowledgement before creating a pull request.",
          policyWarnings,
          trace: expectedTrace,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const pullRequest = matches[0] ?? (await client.createPullRequest({
      sourceBranch: expectedTrace.sourceBranch,
      targetBranch: expectedTrace.baseBranch,
      title: `#${expectedTrace.workItemId} ${workflowRequest.title || workflowRequest.requestId}`,
      description: buildCreatePullRequestDescription({
        sourceBranch: expectedTrace.sourceBranch,
        targetBranch: expectedTrace.baseBranch,
      }),
      isDraft: true,
    }));
    const created = matches.length === 0;
    const trace = {
      ...expectedTrace,
      discoveryStatus: "found" as const,
      pullRequestId: pullRequest.pullRequestId,
      webUrl: pullRequest.webUrl,
      reason: created
        ? `Draft Azure PR #${pullRequest.pullRequestId} created for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`
        : `Active Azure PR #${pullRequest.pullRequestId} found for ${expectedTrace.sourceBranch} -> ${expectedTrace.baseBranch}.`,
    };
    const link = linkPullRequestToWorkflow({
      requestId,
      pullRequestId: pullRequest.pullRequestId,
      webUrl: pullRequest.webUrl,
      trace,
      actor: body.actor,
    });

    return NextResponse.json(
      {
        created,
        trace,
        link,
        pullRequest,
        matches: [pullRequest],
      },
      {
        status: created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
