import { NextResponse } from "next/server";

import { cancelWorkerRun } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ requestId: string; runId: string }>;
};

type CancelBody = {
  actor?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { requestId, runId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as CancelBody;
    const run = cancelWorkerRun({
      requestId,
      runId,
      actor: body.actor,
    });

    return NextResponse.json(
      { run },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Run stop request failed.";
    return NextResponse.json(
      { error: message },
      {
        status: message.includes("current open Agent run") ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
