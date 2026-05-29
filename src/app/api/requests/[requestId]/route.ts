import { NextResponse } from "next/server";

import { getRequestDetail } from "@/lib/control-plane-db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const detail = getRequestDetail(requestId);

    if (!detail) {
      return NextResponse.json(
        { error: "Request not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { detail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
