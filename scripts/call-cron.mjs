#!/usr/bin/env node
// call-cron.mjs: call one of the server's cron routes with the bearer token from the environment.
// The token is read from CRON_SECRET in the process environment and is never printed.
//
// Usage:
//   CRON_SECRET=... node scripts/call-cron.mjs --base https://<your-host> --job tick|health|deposits|withdrawals
//   (set CRON_SECRET in your shell or use `node --env-file=<file> scripts/call-cron.mjs ...`; do not type the value
//    into a shared terminal history)
//
// Routes: apps/web/src/app/api/cron/{tick,health,deposits,withdrawals}/route.ts (GET or POST, Bearer CRON_SECRET).
// Only https is accepted, except for localhost / 127.0.0.1 (for a local test).
// Exit codes: 0 HTTP 2xx, 1 non-2xx or network error, 2 bad usage.

const JOBS = ["tick", "health", "deposits", "withdrawals"];
const argv = process.argv.slice(2);
const o = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) usage(`unexpected argument ${a}`);
  const v = argv[++i];
  if (v === undefined || v.startsWith("--")) usage(`${a} needs a value`);
  o[a.slice(2)] = v;
}

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: CRON_SECRET=... node scripts/call-cron.mjs --base <https-url> --job ${JOBS.join("|")}`);
  process.exit(2);
}

if (!o.base || !o.job) usage("--base and --job are required");
if (!JOBS.includes(o.job)) usage(`--job must be one of ${JOBS.join(", ")}`);
const secret = process.env.CRON_SECRET;
if (!secret) usage("CRON_SECRET is not set in the environment");

let url;
try {
  url = new URL(`/api/cron/${o.job}`, o.base);
} catch {
  usage("--base is not a valid URL");
}
const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
if (url.protocol !== "https:" && !(local && url.protocol === "http:")) usage("--base must be https (http only for localhost)");

try {
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${secret}` }, redirect: "error" });
  const text = (await res.text()).replaceAll(secret, "[redacted]");
  console.log(`${o.job}: HTTP ${res.status}`);
  console.log(text.length > 600 ? `${text.slice(0, 600)} ...(truncated)` : text);
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.error(`${o.job}: request failed (${e instanceof Error ? e.name : "error"})`);
  process.exit(1);
}
