import { NextResponse } from "next/server";

import { listWorkers, registerWorker } from "@/lib/control-plane-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(
      { workers: listWorkers() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const worker = registerWorker(await request.json());

    return NextResponse.json(
      { worker },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Worker request failed." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
