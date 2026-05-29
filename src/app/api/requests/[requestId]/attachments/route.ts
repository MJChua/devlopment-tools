import { NextResponse } from "next/server";

import { createRequestAttachment } from "@/lib/control-plane-db";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Image file is required.");
    }

    const attachment = createRequestAttachment({
      requestId,
      filename: file.name,
      contentType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      purpose:
        formData.get("purpose")?.toString() === "clarification"
          ? "clarification"
          : "intake",
      recoveryOfRunId: formData.get("recoveryOfRunId")?.toString() ?? "",
      actor: formData.get("actor")?.toString() ?? "",
    });

    return NextResponse.json(
      { attachment },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attachment upload failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
