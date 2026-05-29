import { NextResponse } from "next/server";

import { appendWorkerRunArtifact } from "@/lib/control-plane-db";
import { parseWorkerAuth } from "@/lib/worker-auth";

export const runtime = "nodejs";

type ArtifactBody = {
  artifact?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const { workerId, token } = parseWorkerAuth(request);
    const body = (await request.json()) as ArtifactBody;

    if (!body.artifact?.trim()) {
      throw new Error("artifact is required.");
    }

    const run = appendWorkerRunArtifact({
      workerId,
      token,
      runId,
      artifact: body.artifact,
    });

    return NextResponse.json(
      { run },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artifact upload failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
