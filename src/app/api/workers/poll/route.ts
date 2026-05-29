import { NextResponse } from "next/server";

import { pollWorker } from "@/lib/control-plane-db";
import { parseWorkerAuth } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workerId, token } = parseWorkerAuth(request);
    const workerPoll = pollWorker(workerId, token);

    return NextResponse.json(
      workerPoll,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Worker poll failed." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}
