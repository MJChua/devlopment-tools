import { NextResponse } from "next/server";

import { updateWorkerSelectedRepository } from "@/lib/control-plane-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workerId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { workerId } = await context.params;
    const body = await request.json();
    const worker = updateWorkerSelectedRepository({
      workerId,
      repoPath: typeof body.repoPath === "string" ? body.repoPath : "",
    });

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
            : "Worker repository update failed.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
