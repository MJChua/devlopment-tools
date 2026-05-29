import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AzureRequestBody;
    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const iterations = await client.getIterationTree();

    return NextResponse.json(
      { iterations },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error), iterationsUnavailable: true },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
