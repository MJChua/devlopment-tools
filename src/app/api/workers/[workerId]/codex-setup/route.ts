import { NextResponse } from "next/server";

import { requestWorkerCodexSetup } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workerId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { workerId } = await context.params;
    const worker = requestWorkerCodexSetup(workerId);

    return NextResponse.json(
      { worker },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Worker Codex setup request failed.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
