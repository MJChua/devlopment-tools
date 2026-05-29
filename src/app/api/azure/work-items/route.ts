import { NextResponse } from "next/server";

import { AzureDevOpsClient, formatError } from "@/lib/azure-devops";
import {
  parseAzureRequestBody,
  type AzureRequestBody,
} from "@/lib/request-validation";

type WorkItemQueryRequestBody = AzureRequestBody & {
  iterationPath?: string;
  state?: string;
  type?: string;
  assignedTo?: string;
  searchText?: string;
  top?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WorkItemQueryRequestBody;
    const { config, credentials } = parseAzureRequestBody(body);
    const client = new AzureDevOpsClient(config, credentials);
    const result = await client.queryWorkItems({
      iterationPath: body.iterationPath,
      state: body.state,
      type: body.type,
      assignedTo: body.assignedTo,
      searchText: body.searchText,
      top: body.top,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error), workItemsUnavailable: true },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
