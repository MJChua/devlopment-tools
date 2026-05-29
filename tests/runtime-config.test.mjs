import assert from "node:assert/strict";
import test from "node:test";

const { normalizePublicUrl, resolveControlPlaneUrl } = await import(
  "../src/lib/runtime-config.ts"
);

test("runtime config prefers explicit public URL", () => {
  const config = resolveControlPlaneUrl({
    envUrl: "https://mission.example.com/",
    forwardedProto: "https",
    forwardedHost: "preview.example.com",
    requestUrl: "http://localhost:3000/api/runtime-config",
  });

  assert.deepEqual(config, {
    controlPlaneUrl: "https://mission.example.com",
    source: "env",
  });
});

test("runtime config falls back to forwarded host", () => {
  const config = resolveControlPlaneUrl({
    forwardedProto: "https,http",
    forwardedHost: "preview.example.com,localhost:3000",
    requestUrl: "http://localhost:3000/api/runtime-config",
  });

  assert.deepEqual(config, {
    controlPlaneUrl: "https://preview.example.com",
    source: "forwarded-host",
  });
});

test("runtime config rejects non-http URLs and uses request origin", () => {
  const config = resolveControlPlaneUrl({
    envUrl: "file:///tmp/control-plane",
    forwardedProto: "ftp",
    forwardedHost: "example.com",
    requestUrl: "http://localhost:3000/api/runtime-config",
  });

  assert.deepEqual(config, {
    controlPlaneUrl: "http://localhost:3000",
    source: "origin",
  });
});

test("public URL normalization trims path and trailing slash", () => {
  assert.equal(
    normalizePublicUrl("https://mission.example.com/path/to/app/"),
    "https://mission.example.com",
  );
  assert.equal(normalizePublicUrl("mailto:test@example.com"), "");
});
