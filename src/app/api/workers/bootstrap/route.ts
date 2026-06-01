import { readFile } from "node:fs/promises";
import path from "node:path";

import { getWorkerBootstrapManifest } from "../../../../lib/worker-bootstrap-manifest.ts";

export const runtime = "nodejs";

const BOOTSTRAP_FILES = new Map([
  ["local-worker.mjs", "text/javascript; charset=utf-8"],
  ["local-worker-utils.mjs", "text/javascript; charset=utf-8"],
  ["local-launcher.mjs", "text/javascript; charset=utf-8"],
  ["local-launcher-utils.mjs", "text/javascript; charset=utf-8"],
  ["local-launcher-install.ps1", "text/plain; charset=utf-8"],
  ["worker-manifest.json", "application/json; charset=utf-8"],
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get("file")?.trim() || "";

    const contentType = BOOTSTRAP_FILES.get(fileName);
    if (!contentType) {
      return new Response("Unknown worker bootstrap file.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (fileName === "worker-manifest.json") {
      return Response.json(getWorkerBootstrapManifest(), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const script = await readFile(
      path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", fileName),
      "utf8",
    );

    return new Response(script, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Worker bootstrap download failed.",
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
