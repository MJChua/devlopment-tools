export const REALTIME_DEFAULT_PORT = 3001;
export const REALTIME_WS_PATH = "/ws";
export const REALTIME_RECONNECT_DELAYS_MS = [1000, 2000, 5000] as const;
export const REALTIME_FALLBACK_AFTER_ATTEMPT = 3;

export type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "fallback";

export type RealtimeHelloMessage = {
  type: "hello";
  serverTime: string;
  checkedAt: string;
  digest: string;
};

export type RealtimeHeartbeatMessage = {
  type: "heartbeat";
  checkedAt: string;
  digest: string;
};

export type RealtimeStateChangedMessage = {
  type: "state:changed";
  checkedAt: string;
  digest: string;
};

export type RealtimeErrorMessage = {
  type: "error";
  checkedAt: string;
  message: string;
};

export type RealtimeMessage =
  | RealtimeHelloMessage
  | RealtimeHeartbeatMessage
  | RealtimeStateChangedMessage
  | RealtimeErrorMessage;

export function getBrowserRealtimeUrl(port = REALTIME_DEFAULT_PORT) {
  return `ws://127.0.0.1:${port}${REALTIME_WS_PATH}`;
}

export function getRealtimeReconnectDelay(attempt: number) {
  const index = Math.max(0, Math.min(attempt, REALTIME_RECONNECT_DELAYS_MS.length - 1));
  return REALTIME_RECONNECT_DELAYS_MS[index];
}

export function shouldUseRealtimeFallback(attempt: number) {
  return attempt >= REALTIME_FALLBACK_AFTER_ATTEMPT;
}

export function parseRealtimeMessage(value: string): RealtimeMessage | null {
  try {
    const parsed = JSON.parse(value) as Partial<RealtimeMessage>;

    if (
      parsed.type === "hello" ||
      parsed.type === "heartbeat" ||
      parsed.type === "state:changed" ||
      parsed.type === "error"
    ) {
      return parsed as RealtimeMessage;
    }
  } catch {
    return null;
  }

  return null;
}
