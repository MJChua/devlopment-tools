import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

const tempDir = await mkdtemp(path.join(tmpdir(), "control-plane-realtime-"));
process.env.CONTROL_PLANE_DB_PATH = path.join(tempDir, "realtime.sqlite");

const {
  createRequest,
  dispatchNextAgent,
  getRequestDetail,
  getRealtimeDigest,
  heartbeatWorkerRun,
  pollWorker,
  registerWorker,
  updateWorkerRepositoryCandidates,
  updateWorkerSelectedRepository,
} = await import("../src/lib/control-plane-db.ts");
const {
  getRealtimeReconnectDelay,
  shouldUseRealtimeFallback,
} = await import("../src/lib/realtime.ts");
const { createRealtimeServer } = await import("../scripts/realtime-server.mjs");

test("realtime digest changes when worker state changes", () => {
  const before = getRealtimeDigest(new Date("2026-05-27T00:00:00.000Z"));

  registerWorker({
    workerId: "realtime-worker",
    displayName: "Realtime Worker",
    repoPath: "C:\\workspace\\realtime",
    commandTemplate: "echo ok",
  });

  const after = getRealtimeDigest(new Date("2026-05-27T00:00:01.000Z"));

  assert.notEqual(after.digest, before.digest);
  assert.equal(after.workerCount, before.workerCount + 1);
  assert.equal(after.requestCount, before.requestCount);
});

test("worker heartbeat timestamps do not change realtime digest", () => {
  const worker = registerWorker({
    workerId: "realtime-heartbeat-worker",
    displayName: "Realtime Heartbeat Worker",
    repoPath: "C:\\workspace\\realtime-heartbeat",
    commandTemplate: "echo ok",
  });

  pollWorker(worker.workerId, worker.token);
  const before = getRealtimeDigest(new Date("2026-05-27T00:00:02.000Z"));

  pollWorker(worker.workerId, worker.token);
  const after = getRealtimeDigest(new Date("2026-05-27T00:00:03.000Z"));

  assert.equal(after.digest, before.digest);
});

test("run heartbeat timestamps do not change realtime digest", () => {
  const worker = registerWorker({
    workerId: "realtime-run-heartbeat-worker",
    displayName: "Realtime Run Heartbeat Worker",
    repoPath: "C:\\workspace\\realtime-run",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\realtime-run";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "realtime-run", path: repoPath, source: "test" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });
  const request = createRequest({
    detail: "Verify heartbeat digest stability.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const run = dispatchNextAgent({ requestId: request.requestId });
  const before = getRealtimeDigest(new Date("2026-05-27T00:00:04.000Z"));

  heartbeatWorkerRun(worker.workerId, worker.token, run.runId);
  const after = getRealtimeDigest(new Date("2026-05-27T00:00:05.000Z"));

  assert.equal(after.digest, before.digest);
});

test("run progress heartbeat changes realtime digest and stores progress", () => {
  const worker = registerWorker({
    workerId: "realtime-run-progress-worker",
    displayName: "Realtime Run Progress Worker",
    repoPath: "C:\\workspace\\realtime-progress",
    commandTemplate: "echo ok",
  });
  const repoPath = "C:\\workspace\\realtime-progress";

  updateWorkerRepositoryCandidates({
    workerId: worker.workerId,
    token: worker.token,
    repositories: [{ name: "realtime-progress", path: repoPath, source: "test" }],
    readiness: {
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "codex",
    },
  });
  updateWorkerSelectedRepository({ workerId: worker.workerId, repoPath });
  const request = createRequest({
    detail: "Verify progress digest updates.",
    assignedWorkerId: worker.workerId,
    repoPath,
    azureReferenceType: "none",
    azureReferenceId: "",
  });
  const run = dispatchNextAgent({ requestId: request.requestId });
  const before = getRealtimeDigest(new Date("2026-05-27T00:00:06.000Z"));

  heartbeatWorkerRun(worker.workerId, worker.token, run.runId, {
    progressLabel: "Running tests",
    progressDetail: "pnpm test",
    progressUpdatedAt: "2026-05-27T00:00:07.000Z",
  });
  const after = getRealtimeDigest(new Date("2026-05-27T00:00:08.000Z"));
  const detail = getRequestDetail(request.requestId);
  const updatedRun = detail.runs.find((candidate) => candidate.runId === run.runId);

  assert.notEqual(after.digest, before.digest);
  assert.equal(updatedRun.progressLabel, "Running tests");
  assert.equal(updatedRun.progressDetail, "pnpm test");
});

test("realtime reconnect helpers use capped backoff and fallback threshold", () => {
  assert.equal(getRealtimeReconnectDelay(0), 1000);
  assert.equal(getRealtimeReconnectDelay(1), 2000);
  assert.equal(getRealtimeReconnectDelay(2), 5000);
  assert.equal(getRealtimeReconnectDelay(8), 5000);
  assert.equal(shouldUseRealtimeFallback(2), false);
  assert.equal(shouldUseRealtimeFallback(3), true);
});

test("realtime server sends hello and heartbeat messages", async () => {
  const server = createRealtimeServer({
    host: "127.0.0.1",
    port: 0,
    digestIntervalMs: 50,
    heartbeatIntervalMs: 50,
    log: false,
  });
  await server.ready;

  const socket = new WebSocket(server.getUrl());
  try {
    const hello = await waitForMessage(socket);
    assert.equal(hello.type, "hello");
    assert.match(hello.checkedAt, /^\d{4}-\d{2}-\d{2}T/);

    const heartbeat = await waitForMessage(socket);
    assert.equal(heartbeat.type, "heartbeat");
    assert.match(heartbeat.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    socket.close();
    await server.close();
  }
});

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for realtime message."));
    }, 1000);
    const onMessage = (value) => {
      cleanup();
      resolve(JSON.parse(value.toString()));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
