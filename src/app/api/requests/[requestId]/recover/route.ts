import { NextResponse } from "next/server";

import { recoverWorkflowRequest } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RecoverBody = {
  action?:
    | "retry_same_agent"
    | "clarify_and_retry"
    | "auto_repair"
    | "sync_output";
  runId?: string;
  clarification?: string;
  clarificationAttachmentIds?: string[];
  actor?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as RecoverBody;
    const action = body.action ?? "retry_same_agent";
    if (action === "auto_repair") {
      throw new Error("Automatic repair is server-only.");
    }
    const run = recoverWorkflowRequest({
      requestId,
      action,
      runId: body.runId,
      clarification: body.clarification,
      clarificationAttachmentIds: Array.isArray(body.clarificationAttachmentIds)
        ? body.clarificationAttachmentIds
        : [],
      actor: body.actor,
    });

    return NextResponse.json(
      { run },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recovery failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
