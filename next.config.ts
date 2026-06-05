import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  outputFileTracingExcludes: {
    "/api/**/*": [
      ".git/**/*",
      ".control-plane/**/*",
      ".codex-artifacts/**/*",
      ".playwright-cli/**/*",
      "next.config.*",
    ],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
