#!/usr/bin/env node
// dev.mjs: start the web app in one of the two local modes, the same on bash, PowerShell and cmd.exe
// (setting environment variables inline differs per shell; this script sets them for the child process only).
//
//   node scripts/dev.mjs mock    # NEXT_PUBLIC_MOCK=1: in-memory simulated world, simulated login, no server logic
//   node scripts/dev.mjs local   # NEXT_PUBLIC_MOCK=0 SERVER_BACKEND=dev DEV_LOGIN=1 GAME_MODE=PLAY DEV_TICK_SECONDS=5:
//                                #   the real route handlers on a simulated contract (docs/SERVER.md, "Local end-to-end dev mode")
//   (root shortcut for the first one: `pnpm dev:mock`)
//
// It only sets non-secret development switches and then runs `pnpm --filter ./apps/web dev`. A variable that
// is already set in your shell wins (so `DEV_TICK_SECONDS=60 node scripts/dev.mjs local` keeps 60).
// `local` refuses to run with NODE_ENV=production (the server code refuses too).

import { spawn } from "node:child_process";

const mode = process.argv[2];
const MODES = {
  mock: { NEXT_PUBLIC_MOCK: "1" },
  local: { NEXT_PUBLIC_MOCK: "0", SERVER_BACKEND: "dev", DEV_LOGIN: "1", GAME_MODE: "PLAY", DEV_TICK_SECONDS: "5" },
};
if (!mode || !(mode in MODES)) {
  console.error("usage: node scripts/dev.mjs mock|local");
  process.exit(2);
}
if (mode === "local" && process.env.NODE_ENV === "production") {
  console.error("refusing: the local dev backend must not run with NODE_ENV=production");
  process.exit(2);
}

const env = { ...process.env };
for (const [k, v] of Object.entries(MODES[mode])) if (env[k] === undefined) env[k] = v;
// Mock mode must not inherit a backend switch from the shell.
if (mode === "mock") env.NEXT_PUBLIC_MOCK = "1";

console.log(`starting the web app in ${mode} mode (Ctrl+C to stop); first page load compiles for a few seconds`);
const child = spawn("pnpm", ["--filter", "./apps/web", "dev"], { env, stdio: "inherit", shell: process.platform === "win32" });
const stop = () => child.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
