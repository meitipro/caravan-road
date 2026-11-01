#!/usr/bin/env node
// check-env.mjs: print which environment variable NAMES are missing for a deployment target.
// It never prints a value, a length, or any part of a value. It only reports names and
// "set" / "missing".
//
// Usage:
//   node scripts/check-env.mjs --target web   [--mode PLAY|LIVE] [--env-file apps/web/.env.local]
//   node scripts/check-env.mjs --target worker [--env-file path]
//   node scripts/check-env.mjs --target all
//
// Without --env-file the process environment is checked (what a host dashboard provides).
// With --env-file the file is parsed for KEY=VALUE lines and merged over the process environment;
// the file is read in memory only. Exit code: 0 all required names set, 1 something required is
// missing, 2 bad usage.
//
// The name lists mirror apps/web/src/server/env.ts and intents/create.ts (web), apps/worker/src/config.ts (worker) and
// .env.example. If those files change, update the lists below.

import { readFileSync, existsSync } from "node:fs";

const WEB_REQUIRED = [
  "GAME_MODE", "NEAR_NETWORK", "CARAVAN_CONTRACT_ID",
  "RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEY",
  "OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY",
  "KEY_ENC_SECRET", "DATABASE_URL", "AUTH_SECRET", "CRON_SECRET",
];
// Not part of loadEnv(), but without them nobody can sign in (Auth.js infers these names).
const WEB_LOGIN = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_DISCORD_ID", "AUTH_DISCORD_SECRET"];
const WEB_LIVE_ONLY = ["NEAR_RPC_URL", "TREASURY_ACCOUNT_ID", "TREASURY_PRIVATE_KEY", "ONECLICK_JWT", "ONECLICK_USDC_ASSET_ID"];
const WORKER_REQUIRED = [
  "NEAR_NETWORK", "NEAR_RPC_URL", "CARAVAN_CONTRACT_ID",
  "MERCHANT_ACCOUNT_DASHT", "MERCHANT_ACCOUNT_MADAN", "MERCHANT_ACCOUNT_BANDAR", "MERCHANT_ACCOUNT_SHAHR",
  "KEY_DASHT", "KEY_MADAN", "KEY_BANDAR", "KEY_SHAHR",
  "DATABASE_URL", "NEAR_AI_API_KEY", "NEAR_AI_MODEL",
];
const WORKER_OPTIONAL = ["NEAR_AI_BASE_URL", "NEAR_AI_RESPONSE_FORMAT", "WORKER_PERIOD_SECONDS", "WORKER_STAGGER_SECONDS", "WORKER_ID"];

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage: node scripts/check-env.mjs --target web|worker|all [--mode PLAY|LIVE] [--env-file <path>]");
  process.exit(2);
}

function parseArgs(argv) {
  const o = { target: null, mode: null, envFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(`${a} needs a value`);
      return v;
    };
    if (a === "--target") o.target = next();
    else if (a === "--mode") o.mode = next();
    else if (a === "--env-file") o.envFile = next();
    else if (a === "--help" || a === "-h") usage();
    else usage(`unknown argument ${a}`);
  }
  if (!["web", "worker", "all"].includes(o.target ?? "")) usage("--target web|worker|all is required");
  if (o.mode !== null && !["PLAY", "LIVE"].includes(o.mode)) usage("--mode must be PLAY or LIVE");
  return o;
}

let modeFromFile = null;

/** Parse KEY=VALUE lines. Only names and the presence of a non-empty value are kept in the result. */
function readEnvFile(path) {
  if (!existsSync(path)) usage(`env file not found: ${path}`);
  const set = {};
  modeFromFile = null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    set[m[1]] = v.trim() !== "";
    if (m[1] === "GAME_MODE" && (v === "PLAY" || v === "LIVE")) modeFromFile = v; // only these two words are kept
  }
  return set;
}

const opts = parseArgs(process.argv.slice(2));
const present = (name) => Boolean(process.env[name] && process.env[name].trim() !== "");
const fileSet = opts.envFile ? readEnvFile(opts.envFile) : {};
const isSet = (name) => (name in fileSet ? fileSet[name] : present(name));

// Mode: explicit flag, else GAME_MODE from the environment or file if it is exactly PLAY or LIVE.
// (Only compared against the two allowed words here; the value is never printed.)
function detectMode() {
  if (opts.mode) return opts.mode;
  const raw = "GAME_MODE" in fileSet ? modeFromFile : process.env.GAME_MODE;
  return raw === "PLAY" || raw === "LIVE" ? raw : null;
}

let missingRequired = 0;
function report(title, required, optional = []) {
  console.log(`\n${title}`);
  for (const n of required) {
    const ok = isSet(n);
    if (!ok) missingRequired++;
    console.log(`  ${ok ? "set    " : "MISSING"}  ${n}`);
  }
  for (const n of optional) console.log(`  ${isSet(n) ? "set    " : "unset  "}  ${n}  (optional)`);
}

if (opts.target === "web" || opts.target === "all") {
  const mode = detectMode();
  report("web server (apps/web), always required", WEB_REQUIRED);
  report("web server, needed for sign-in", WEB_LOGIN);
  if (mode === "LIVE") report("web server, LIVE mode only", WEB_LIVE_ONLY);
  else report("web server, LIVE mode only (not required in PLAY)", [], WEB_LIVE_ONLY);
  report("web UI", [], ["NEXT_PUBLIC_MOCK", "NEXT_PUBLIC_MODE"]);
  if (mode === null) console.log("\n  note: pass --mode LIVE to check the LIVE-only names; GAME_MODE itself must be PLAY or LIVE.");
}
if (opts.target === "worker" || opts.target === "all") report("worker (apps/worker)", WORKER_REQUIRED, WORKER_OPTIONAL);

console.log(missingRequired === 0 ? "\nAll required names are set." : `\n${missingRequired} required name(s) missing.`);
process.exit(missingRequired === 0 ? 0 : 1);
