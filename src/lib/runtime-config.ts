export type RuntimeConfigSource =
  | "env"
  | "forwarded-host"
  | "origin"
  | "browser-fallback";

export type RuntimeConfig = {
  controlPlaneUrl: string;
  source: RuntimeConfigSource;
};

export function resolveControlPlaneUrl(input: {
  envUrl?: string | null;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  origin?: string | null;
  requestUrl?: string | null;
}): RuntimeConfig {
  const envUrl = normalizePublicUrl(input.envUrl);
  if (envUrl) {
    return { controlPlaneUrl: envUrl, source: "env" };
  }

  const forwardedProto = firstHeaderValue(input.forwardedProto);
  const forwardedHost = firstHeaderValue(input.forwardedHost);
  if (forwardedProto && forwardedHost) {
    const forwardedUrl = normalizePublicUrl(
      `${forwardedProto.replace(/:$/, "")}://${forwardedHost}`,
    );
    if (forwardedUrl) {
      return { controlPlaneUrl: forwardedUrl, source: "forwarded-host" };
    }
  }

  const origin = normalizePublicUrl(input.origin);
  if (origin) {
    return { controlPlaneUrl: origin, source: "origin" };
  }

  const requestOrigin = getRequestOrigin(input.requestUrl);
  if (requestOrigin) {
    return { controlPlaneUrl: requestOrigin, source: "origin" };
  }

  return { controlPlaneUrl: "", source: "browser-fallback" };
}

export function normalizePublicUrl(value: string | null | undefined) {
  if (!value?.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    return url.origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function firstHeaderValue(value: string | null | undefined) {
  return value?.split(",")[0]?.trim() ?? "";
}

function getRequestOrigin(value: string | null | undefined) {
  if (!value?.trim()) {
    return "";
  }

  try {
    return normalizePublicUrl(new URL(value).origin);
  } catch {
    return "";
  }
}
