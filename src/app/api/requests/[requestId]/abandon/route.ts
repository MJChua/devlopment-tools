import { NextResponse } from "next/server";

import { abandonWorkflowRequest } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

type AbandonBody = {
  actor?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { requestId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as AbandonBody;
    const workflowRequest = abandonWorkflowRequest({
      requestId,
      actor: body.actor,
    });

    return NextResponse.json(
      { request: workflowRequest },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Request abandon failed.";
    return NextResponse.json(
      { error: message },
      {
        status: message.includes("queued or running") ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
