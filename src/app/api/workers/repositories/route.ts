import { NextResponse } from "next/server";

import {
  listWorkerRepositoryCandidates,
  updateWorkerRepositoryCandidates,
} from "@/lib/control-plane-db";
import { parseWorkerAuth } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workerId = searchParams.get("workerId")?.trim() || undefined;

    return NextResponse.json(
      { repositories: listWorkerRepositoryCandidates(workerId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = parseWorkerAuth(request);
    const body = await request.json();
    const worker = updateWorkerRepositoryCandidates({
      workerId: auth.workerId,
      token: auth.token,
      repositories: Array.isArray(body.repositories) ? body.repositories : [],
      readiness: {
        codexReady: body.codexReady,
        codexStatus: body.codexStatus,
        codexError: body.codexError,
        codexDiagnosticCode: body.codexDiagnosticCode,
        codexExecutablePath: body.codexExecutablePath,
        codexCheckedAt: body.codexCheckedAt,
      },
    });

    return NextResponse.json(
      {
        worker,
        repositories: worker.repositoryCandidates,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Worker repository request failed.",
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
