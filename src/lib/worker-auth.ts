export function parseWorkerAuth(request: Request) {
  const workerId = request.headers.get("x-worker-id")?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!workerId || !token) {
    throw new Error("Worker ID and bearer token are required.");
  }

  return { workerId, token };
}
