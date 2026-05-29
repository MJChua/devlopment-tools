import { fileURLToPath } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

import {
  REALTIME_DEFAULT_PORT,
  REALTIME_WS_PATH,
} from "../src/lib/realtime.ts";
import { getRealtimeDigest } from "../src/lib/control-plane-db.ts";

const DEFAULT_DIGEST_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

export function createRealtimeServer(options = {}) {
  const host = options.host ?? process.env.REALTIME_HOST ?? "127.0.0.1";
  const port = Number(options.port ?? process.env.REALTIME_PORT ?? REALTIME_DEFAULT_PORT);
  const path = options.path ?? REALTIME_WS_PATH;
  const digestIntervalMs =
    options.digestIntervalMs ?? DEFAULT_DIGEST_INTERVAL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const log = options.log ?? true;
  const wss = new WebSocketServer({ host, port, path });
  let currentDigest = null;
  let digestTimer = null;
  let heartbeatTimer = null;

  const ready = new Promise((resolve, reject) => {
    wss.once("listening", () => {
      currentDigest = readDigest();
      digestTimer = setInterval(checkDigest, digestIntervalMs);
      heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);
      if (log) {
        console.log(`[realtime] listening on ${getUrl()}`);
      }
      resolve();
    });
    wss.once("error", reject);
  });

  wss.on("connection", (socket) => {
    const digest = currentDigest ?? readDigest();
    send(socket, {
      type: "hello",
      serverTime: new Date().toISOString(),
      checkedAt: digest.checkedAt,
      digest: digest.digest,
    });
  });

  function readDigest() {
    return getRealtimeDigest();
  }

  function checkDigest() {
    try {
      const nextDigest = readDigest();
      if (!currentDigest || nextDigest.digest !== currentDigest.digest) {
        currentDigest = nextDigest;
        broadcast({
          type: "state:changed",
          checkedAt: nextDigest.checkedAt,
          digest: nextDigest.digest,
        });
      } else {
        currentDigest = nextDigest;
      }
    } catch (error) {
      broadcastError(error);
    }
  }

  function sendHeartbeat() {
    try {
      currentDigest = readDigest();
      broadcast({
        type: "heartbeat",
        checkedAt: currentDigest.checkedAt,
        digest: currentDigest.digest,
      });
    } catch (error) {
      broadcastError(error);
    }
  }

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function broadcastError(error) {
    const message = error instanceof Error ? error.message : "Realtime server error.";
    broadcast({
      type: "error",
      checkedAt: new Date().toISOString(),
      message,
    });
    if (log) {
      console.error("[realtime]", message);
    }
  }

  function getUrl() {
    const address = wss.address();
    const resolvedPort =
      address && typeof address === "object" ? address.port : port;
    return `ws://${host}:${resolvedPort}${path}`;
  }

  async function close() {
    if (digestTimer) {
      clearInterval(digestTimer);
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    for (const client of wss.clients) {
      client.close();
    }
    await new Promise((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return { close, getUrl, ready, wss };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createRealtimeServer();

  server.ready.catch((error) => {
    console.error("[realtime] failed to start", error);
    process.exitCode = 1;
  });

  const stop = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
