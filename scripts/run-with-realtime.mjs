import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const REALTIME_DEFAULT_PORT = 3001;
const mode = process.argv[2] === "start" ? "start" : "dev";
const realtimeHost = process.env.REALTIME_HOST ?? "127.0.0.1";
const realtimePort = Number(process.env.REALTIME_PORT ?? REALTIME_DEFAULT_PORT);
const nextCliPath = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const nextArgs =
  mode === "start"
    ? [nextCliPath, "start"]
    : [nextCliPath, "dev", "--turbopack"];
const children = [];
let stopping = false;

await ensureRealtimePortAvailable();

start("realtime", process.execPath, [
  "--no-warnings",
  "scripts/realtime-server.mjs",
]);
start("next", process.execPath, nextArgs);

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    stopChildren(child);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.error(`[${name}] ${error.message}`);
    stopChildren(child);
    process.exit(1);
  });
}

async function ensureRealtimePortAvailable() {
  try {
    await canListen(realtimeHost, realtimePort);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }

    console.error(
      [
        `[realtime] 無法啟動：${realtimeHost}:${realtimePort} 已被其他程序占用。`,
        "通常代表 Agent Flow / pnpm dev 已經有一份正在執行。",
        "",
        "Windows 查詢占用程序：",
        `  Get-NetTCPConnection -LocalAddress ${realtimeHost} -LocalPort ${realtimePort} | Select-Object -ExpandProperty OwningProcess`,
        "",
        "停止占用程序後再重啟：",
        "  Stop-Process -Id <PID>",
      ].join("\n"),
    );
    process.exit(1);
  }
}

function canListen(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, host);
  });
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill();
  }
}

async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  stopChildren(null);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
