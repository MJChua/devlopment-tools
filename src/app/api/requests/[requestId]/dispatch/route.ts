import { NextResponse } from "next/server";

import { dispatchNextAgent } from "@/lib/control-plane-db";
import { AGENT_ROLES, type AgentRole } from "@/lib/control-plane-workflow";

export const runtime = "nodejs";

type DispatchBody = {
  workerId?: string;
  agentRole?: AgentRole;
  actor?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as DispatchBody;
    const agentRole =
      body.agentRole && AGENT_ROLES.includes(body.agentRole)
        ? body.agentRole
        : undefined;
    const run = dispatchNextAgent({
      requestId,
      workerId: body.workerId,
      agentRole,
      actor: body.actor,
    });

    return NextResponse.json(
      { run },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dispatch failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
