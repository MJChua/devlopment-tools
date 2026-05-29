import { NextResponse } from "next/server";

import { completeWorkerRun } from "@/lib/control-plane-db";
import { parseWorkerAuth } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const { workerId, token } = parseWorkerAuth(request);
    const run = completeWorkerRun(workerId, token, runId, await request.json());

    return NextResponse.json(
      { run },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run completion failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
