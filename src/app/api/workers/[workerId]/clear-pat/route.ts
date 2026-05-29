import { NextResponse } from "next/server";

import { assertWorkerHasNoActiveRuns } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workerId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { workerId } = await context.params;
    const worker = assertWorkerHasNoActiveRuns(workerId, "clear PAT");

    return NextResponse.json(
      { canClearPat: true, worker },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PAT clear guard failed.";
    return NextResponse.json(
      { error: message },
      {
        status: message.includes("queued or running") ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
