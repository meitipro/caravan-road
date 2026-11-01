#!/usr/bin/env node
// init-args.mjs: build the JSON arguments for the contract's `init` method from account ids YOU pass in,
// and check the rules the contract enforces (contracts/caravan/src/lib.rs `try_new`, DECISIONS.md D15/D18).
// It only prints JSON built from the values you give it. It invents nothing and handles no keys.
//
// Usage:
//   node scripts/init-args.mjs --mode PLAY --owner <account> --operator <account> \
//     --dasht <account> --madan <account> --bandar <account> --shahr <account> \
//     --relayer <account> --max-players <int> --operator-daily-cap <fils> [--auto-ship]
//
//   --relayer is the value of RELAYER_ACCOUNT_ID; it becomes `player_suffix` (".<relayer>"), because the
//   server creates player accounts as p<8hex>.<RELAYER_ACCOUNT_ID> (docs/SERVER.md).
//   --operator-daily-cap is in fils (200000 = 20 USDC = the LIVE deposit cap per player).
//
// Exit codes: 0 JSON printed, 2 bad input (reason printed to stderr).

const args = process.argv.slice(2);
const opt = {};
const flags = new Set();
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--auto-ship") { flags.add("auto-ship"); continue; }
  if (!a.startsWith("--")) bad(`unexpected argument ${a}`);
  const v = args[++i];
  if (v === undefined || v.startsWith("--")) bad(`${a} needs a value`);
  opt[a.slice(2)] = v;
}

function bad(msg) {
  console.error(`error: ${msg}`);
  console.error("usage: node scripts/init-args.mjs --mode PLAY|LIVE --owner A --operator B --dasht C --madan D --bandar E --shahr F --relayer G --max-players N --operator-daily-cap FILS [--auto-ship]");
  process.exit(2);
}

for (const k of ["mode", "owner", "operator", "dasht", "madan", "bandar", "shahr", "relayer", "max-players", "operator-daily-cap"]) {
  if (!(k in opt)) bad(`--${k} is required`);
}
if (!["PLAY", "LIVE"].includes(opt.mode)) bad("--mode must be PLAY or LIVE");

// NEAR account id shape: 2..64 chars of a-z 0-9 - _ . (implicit accounts are 64 hex chars and also fit).
const idOk = (s) => /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(s) && s.length >= 2 && s.length <= 64;
for (const k of ["owner", "operator", "dasht", "madan", "bandar", "shahr", "relayer"]) {
  if (!idOk(opt[k])) bad(`--${k} is not a valid account id shape`);
}
const merchants = [opt.dasht, opt.madan, opt.bandar, opt.shahr];
const all = [opt.owner, opt.operator, ...merchants];
if (new Set(all).size !== all.length) bad("owner, operator and the four merchants must all be different accounts");
if (!/^[1-9][0-9]*$/.test(opt["max-players"])) bad("--max-players must be a positive integer");
if (!/^[1-9][0-9]*$/.test(opt["operator-daily-cap"])) bad("--operator-daily-cap must be a positive integer (fils)");
if (opt.mode === "PLAY") console.error("note: PLAY mode closes deposits, but operator_daily_cap is still a required init argument.");

const json = {
  owner: opt.owner,
  operator: opt.operator,
  mode: opt.mode,
  merchant_accounts: { dasht: opt.dasht, madan: opt.madan, bandar: opt.bandar, shahr: opt.shahr },
  max_players: Number(opt["max-players"]),
  player_suffix: `.${opt.relayer}`,
  operator_daily_cap: opt["operator-daily-cap"], // U128 is a decimal string in JSON
  auto_ship: flags.has("auto-ship"),
};
console.log(JSON.stringify(json));
