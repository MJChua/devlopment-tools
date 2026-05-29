import { NextResponse } from "next/server";

import { resolveControlPlaneUrl } from "@/lib/runtime-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = resolveControlPlaneUrl({
    envUrl: process.env.CONTROL_PLANE_PUBLIC_URL,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    origin: request.headers.get("origin"),
    requestUrl: request.url,
  });

  return NextResponse.json(config, {
    headers: { "Cache-Control": "no-store" },
  });
}
