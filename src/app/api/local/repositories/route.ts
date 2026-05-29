import { NextResponse } from "next/server";

import { listWorkerRepositoryCandidates } from "@/lib/control-plane-db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      repositories: listWorkerRepositoryCandidates(),
      source: "worker-reported",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
