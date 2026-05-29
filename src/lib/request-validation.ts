import type { AzureCredentials, AzureProjectConfig } from "@/lib/azure-devops";

export type AzureRequestBody = {
  config?: Partial<AzureProjectConfig>;
  credentials?: Partial<AzureCredentials>;
};

export function parseAzureRequestBody(body: AzureRequestBody): {
  config: AzureProjectConfig;
  credentials: AzureCredentials;
} {
  const orgUrl = body.config?.orgUrl?.trim();
  const project = body.config?.project?.trim();
  const repository = body.config?.repository?.trim();
  const pat = body.credentials?.pat?.trim();

  const missing = [
    !orgUrl ? "orgUrl" : null,
    !project ? "project" : null,
    !repository ? "repository" : null,
    !pat ? "pat" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required field(s): ${missing.join(", ")}`);
  }

  return {
    config: {
      orgUrl: requireString(orgUrl, "orgUrl"),
      project: requireString(project, "project"),
      repository: requireString(repository, "repository"),
    },
    credentials: {
      pat: requireString(pat, "pat"),
    },
  };
}

function requireString(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value;
}
