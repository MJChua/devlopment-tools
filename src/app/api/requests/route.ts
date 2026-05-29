import { NextResponse } from "next/server";

import {
  createRequest,
  listRequests,
} from "@/lib/control-plane-db";
import { normalizeWorkflowRequestInput } from "@/lib/control-plane-workflow";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(
      { requests: listRequests() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = normalizeWorkflowRequestInput(await request.json());
    const workflowRequest = createRequest(input);

    return NextResponse.json(
      { request: workflowRequest },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
