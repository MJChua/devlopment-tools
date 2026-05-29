import { readFileSync } from "node:fs";

import { NextResponse } from "next/server";

import { getRequestAttachment } from "@/lib/control-plane-db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string; attachmentId: string }> },
) {
  try {
    const { requestId, attachmentId } = await params;
    const attachment = getRequestAttachment(requestId, attachmentId);
    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const file = readFileSync(attachment.storagePath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.sizeBytes),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attachment read failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
