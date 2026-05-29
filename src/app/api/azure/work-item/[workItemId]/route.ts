import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  try {
    const { workItemId } = await params;
    const parsedWorkItemId = Number(workItemId);

    if (!Number.isInteger(parsedWorkItemId) || parsedWorkItemId <= 0) {
      return NextResponse.json(
        { error: "workItemId must be a positive integer." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as AzureRequestBody;
    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const workItem = await client.getWorkItemDetail(workItemId);

    return NextResponse.json(workItem, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error), workItemUnavailable: true },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
