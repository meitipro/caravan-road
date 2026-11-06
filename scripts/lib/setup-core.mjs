// setup-core.mjs: pure helpers for scripts/setup-testnet.mjs (no network, no file access).
//
// Safety design (master plan 0.3 rules 4 and 5):
//  - Key material only ever lives in `Secret` objects. A Secret prints as "[secret]" from toString(),
//    toJSON() and util.inspect, and its value is added to a process-wide redaction list, so even a
//    careless `log(String(x))` cannot leak it.
//  - Every log line goes through `redact()`: known secret values and anything shaped like a NEAR secret key
//    (`ed25519:` followed by 70+ base58 characters; public keys are 43-44 characters and are NOT redacted,
//    the script is allowed to show public keys) are replaced.
//  - The argv parser refuses key-shaped values and secret-named flags without echoing the value.

import { createHash } from "node:crypto";

export class SetupError extends Error {
  /** @param {string} message  @param {number} [exitCode] 1 = a step failed or a check failed, 2 = bad usage or configuration */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SetupError";
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------------------------- secrets

const knownSecrets = new Set();
const SECRET_KEY_RE = /\b(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{70,}/g;

export class Secret {
  #value;
  constructor(value) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError("Secret needs a non-empty string");
    this.#value = value;
    if (value.length >= 8) knownSecrets.add(value);
  }
  /** The only way to read the value. Call it only where the value goes into a signer or the env file. */
  reveal() { return this.#value; }
  toString() { return "[secret]"; }
  toJSON() { return "[secret]"; }
  [Symbol.for("nodejs.util.inspect.custom")]() { return "[secret]"; }
}

/** Replace every known secret value and every secret-key-shaped string. Public keys are left alone. */
export function redact(text) {
  let out = String(text);
  for (const s of knownSecrets) out = out.split(s).join("[redacted]");
  return out.replace(SECRET_KEY_RE, "[redacted-key]");
}

/** Test helper only: forget the registry so a test can prove the code itself never emits a value. */
export function _forgetSecretsForTests() { knownSecrets.clear(); }

/**
 * @param {{out: (line: string) => void, err: (line: string) => void, redact?: boolean}} sinks
 * `redact: false` exists only so the test suite can prove the code never emits a secret by itself.
 */
export function createLogger({ out, err, redact: doRedact = true }) {
  const clean = (s) => (doRedact ? redact(s) : String(s));
  return {
    info: (line = "") => out(clean(line)),
    warn: (line = "") => err(clean(`warning: ${line}`)),
    error: (line = "") => err(clean(`error: ${line}`)),
  };
}

/** True when a string looks like a private key, a 32-byte hex secret or a seed phrase. */
export function looksLikeKeyMaterial(s) {
  if (typeof s !== "string") return false;
  if (/(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{20,}/.test(s)) return true;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return true;
  if (/^(?:[a-z]+\s+){11,}[a-z]+$/.test(s.trim())) return true;
  return false;
}

// ----------------------------------------------------------------------------------------------- amounts

export const YOCTO_PER_NEAR = 10n ** 24n;
/** 1E19 yoctoNEAR per stored byte, https://docs.near.org/protocol/storage/storage-staking */
export const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;

/** "1.5" -> 1500000000000000000000000n. No floats anywhere. */
export function parseNear(text, what = "amount") {
  const t = String(text).trim();
  if (!/^\d+(\.\d{1,24})?$/.test(t)) throw new SetupError(`${what} must be a plain decimal NEAR amount such as 1.5 (got something else)`, 2);
  const [whole, frac = ""] = t.split(".");
  const v = BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac.padEnd(24, "0"));
  if (v <= 0n) throw new SetupError(`${what} must be greater than zero`, 2);
  return v;
}

/** yocto -> "12.3456" (truncated to 4 decimals, trailing zeros trimmed; "<0.0001" for tiny non-zero values). */
export function formatNear(yocto) {
  const v = BigInt(yocto);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / YOCTO_PER_NEAR;
  const frac4 = ((a % YOCTO_PER_NEAR) / 10n ** 20n).toString().padStart(4, "0").replace(/0+$/, "");
  let s = frac4 ? `${whole}.${frac4}` : `${whole}`;
  if (s === "0" && a > 0n) s = "<0.0001";
  return `${neg ? "-" : ""}${s}`;
}

// ------------------------------------------------------------------------------------------ base58 / hash

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = `1${out}`; else break; }
  return out;
}

/** NEAR prints a contract's code hash as base58(sha256(wasm)). */
export function codeHashOf(bytes) { return base58Encode(createHash("sha256").update(bytes).digest()); }
/** The code hash of an account without a contract: 32 zero bytes. */
export const NO_CODE_HASH = "1".repeat(32);

// ----------------------------------------------------------------------------------------------- config

export const CITIES = ["dasht", "madan", "bandar", "shahr"];
export const MERCHANT_METHODS = ["set_policy", "ship"];
/** docs/WORKER.md: the worker sends world_tick from the shahr key, so that key also needs it. */
export const SHAHR_EXTRA_METHODS = ["world_tick"];
export const DEFAULT_TESTNET_RPC = "https://test.rpc.fastnear.com"; // docs.near.org/tools/near-api (provider example)
export const DEFAULT_MAX_PLAYERS = 1000;          // docs/DEPLOY.md: the unit tests use 1000
export const DEFAULT_OPERATOR_DAILY_CAP = "200000"; // DECISIONS D15 suggestion (fils); required by init even in PLAY
/** Gas reserve kept per transaction the root signs (a transaction costs far less; this is a safety margin). */
export const GAS_RESERVE_YOCTO = 10n ** 22n; // 0.01 NEAR
/** docs/SERVER.md / cron health: the relayer alert threshold. */
export const RELAYER_LOW_YOCTO = 2n * YOCTO_PER_NEAR;

const DEFAULT_FUNDS = { owner: "0.5", operator: "1", relayer: "3", merchant: "2", contract: "6" };
const DEFAULT_ALLOWANCE = "1.5";

// https://docs.near.org/protocol/account-id : lowercase alphanumerics, parts separated by '.', '-' or '_' inside a part
const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function isAccountId(s) { return typeof s === "string" && s.length >= 2 && s.length <= 64 && ACCOUNT_ID_RE.test(s); }

/**
 * Build the whole setup configuration from the environment. Account names are derived from ROOT_ACCOUNT_ID only:
 * `<role>.<root>`. Nothing is invented and no network suffix is hard-coded (the root must end in .testnet, a guard).
 * @param {(name: string) => string | undefined} get  process env first, then the .env.local file
 * @param {{allowance?: string, maxPlayers?: string, operatorDailyCap?: string}} flags
 */
export function buildConfig(get, flags = {}) {
  const root = get("ROOT_ACCOUNT_ID");
  if (!root) {
    throw new SetupError(
      "ROOT_ACCOUNT_ID is not set. Set it to the testnet account you created yourself, for example\n" +
      "  bash:       export ROOT_ACCOUNT_ID=<your-account>.testnet\n" +
      "  PowerShell: $env:ROOT_ACCOUNT_ID = '<your-account>.testnet'", 2);
  }
  if (!isAccountId(root)) throw new SetupError("ROOT_ACCOUNT_ID is not a valid NEAR account id", 2);
  const network = get("NEAR_NETWORK") ?? "testnet";
  if (network !== "testnet") throw new SetupError("NEAR_NETWORK must be testnet: this script is testnet-only (mainnet is always a manual owner action, master plan 0.3)", 2);
  if (root.endsWith(".near")) throw new SetupError("ROOT_ACCOUNT_ID looks like a mainnet account (.near). This script is testnet-only.", 2);
  if (!root.endsWith(".testnet")) throw new SetupError("ROOT_ACCOUNT_ID must end with .testnet (this script is testnet-only)", 2);

  const sub = (label) => `${label}.${root}`;
  const funds = {
    owner: parseNear(get("FUND_OWNER_NEAR") ?? DEFAULT_FUNDS.owner, "FUND_OWNER_NEAR"),
    operator: parseNear(get("FUND_OPERATOR_NEAR") ?? DEFAULT_FUNDS.operator, "FUND_OPERATOR_NEAR"),
    relayer: parseNear(get("FUND_RELAYER_NEAR") ?? DEFAULT_FUNDS.relayer, "FUND_RELAYER_NEAR"),
    merchant: parseNear(get("FUND_MERCHANT_NEAR") ?? DEFAULT_FUNDS.merchant, "FUND_MERCHANT_NEAR"),
    contract: parseNear(get("FUND_CONTRACT_NEAR") ?? DEFAULT_FUNDS.contract, "FUND_CONTRACT_NEAR"),
  };
  const allowance = parseNear(flags.allowance ?? get("KEY_ALLOWANCE_NEAR") ?? DEFAULT_ALLOWANCE, "allowance");

  const accounts = [
    { role: "owner", kind: "owner", id: sub("owner"), idVar: "OWNER_ACCOUNT_ID", keyVar: "OWNER_PRIVATE_KEY", fund: funds.owner, adminVar: "OWNER_PRIVATE_KEY" },
  ];
  const contractId = get("CARAVAN_CONTRACT_ID") ?? root;
  const contractIsRoot = contractId === root;
  if (!isAccountId(contractId)) throw new SetupError("CARAVAN_CONTRACT_ID is not a valid NEAR account id", 2);
  if (!contractIsRoot && !contractId.endsWith(`.${root}`)) {
    throw new SetupError(`CARAVAN_CONTRACT_ID must be the root account itself or a sub-account of it (${root}), so that this script can create and sign for it`, 2);
  }
  if (!contractIsRoot) {
    accounts.push({ role: "contract", kind: "contract", id: contractId, idVar: "CARAVAN_CONTRACT_ID", keyVar: null, fund: funds.contract, adminVar: "OWNER_PRIVATE_KEY" });
  }
  accounts.push(
    { role: "operator", kind: "service", id: sub("operator"), idVar: "OPERATOR_ACCOUNT_ID", keyVar: "OPERATOR_PRIVATE_KEY", fund: funds.operator, adminVar: "OPERATOR_PRIVATE_KEY" },
    { role: "relayer", kind: "service", id: sub("relayer"), idVar: "RELAYER_ACCOUNT_ID", keyVar: "RELAYER_PRIVATE_KEY", fund: funds.relayer, adminVar: "RELAYER_PRIVATE_KEY" },
  );
  for (const city of CITIES) {
    accounts.push({
      role: city, kind: "merchant", id: sub(city), idVar: `MERCHANT_ACCOUNT_${city.toUpperCase()}`, keyVar: `KEY_${city.toUpperCase()}`,
      fund: funds.merchant, adminVar: "OWNER_PRIVATE_KEY",
      methods: city === "shahr" ? [...MERCHANT_METHODS, ...SHAHR_EXTRA_METHODS] : [...MERCHANT_METHODS],
    });
  }
  const ids = accounts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new SetupError("derived account ids collide (check CARAVAN_CONTRACT_ID)", 2);
  for (const a of accounts) if (!isAccountId(a.id)) throw new SetupError(`derived account id for ${a.role} is not valid (too long?)`, 2);

  // The server creates p<8hex>.<relayer>: the whole id must stay within 64 characters.
  const relayer = accounts.find((a) => a.role === "relayer");
  if (`p00000000.${relayer.id}`.length > 64) throw new SetupError("ROOT_ACCOUNT_ID is too long: player accounts p<8hex>.relayer.<root> would exceed 64 characters", 2);

  const maxPlayers = flags.maxPlayers ?? String(DEFAULT_MAX_PLAYERS);
  const operatorDailyCap = flags.operatorDailyCap ?? DEFAULT_OPERATOR_DAILY_CAP;
  if (!/^[1-9][0-9]*$/.test(maxPlayers)) throw new SetupError("--max-players must be a positive integer", 2);
  if (!/^[1-9][0-9]*$/.test(operatorDailyCap)) throw new SetupError("--operator-daily-cap must be a positive integer (fils)", 2);

  const byRole = Object.fromEntries(accounts.map((a) => [a.role, a]));
  const rpcUrl = get("NEAR_RPC_URL") ?? DEFAULT_TESTNET_RPC;
  if (!/^https:\/\//.test(rpcUrl)) throw new SetupError("NEAR_RPC_URL must be an https URL", 2);

  /** Non-secret lines the accounts step writes to .env.local (names from .env.example plus ROOT/OWNER). */
  const envIds = [
    ["ROOT_ACCOUNT_ID", root], ["NEAR_NETWORK", network], ["NEAR_RPC_URL", rpcUrl], ["GAME_MODE", "PLAY"],
    ["CARAVAN_CONTRACT_ID", contractId],
    ...accounts.filter((a) => a.kind !== "contract").map((a) => [a.idVar, a.id]),
  ].map(([name, value]) => ({ name, value }));

  return {
    network, rpcUrl, root, contractId, contractIsRoot, accounts, byRole, funds, allowance, envIds,
    maxPlayers, operatorDailyCap, mode: "PLAY",
    merchants: accounts.filter((a) => a.kind === "merchant"),
    maxPlayerIdLength: `p00000000.${relayer.id}`.length,
  };
}

// ----------------------------------------------------------------------------------------------- CLI args

export const COMMANDS = ["plan", "accounts", "keys", "deploy", "verify", "all"];
const VALUE_FLAGS = {
  "--env-file": "envFile", "--allowance": "allowance", "--max-players": "maxPlayers",
  "--operator-daily-cap": "operatorDailyCap", "--wasm": "wasm", "--rotate": "rotate",
};
const BOOL_FLAGS = { "--dry-run": "dryRun", "--force": "force", "--skip-build": "skipBuild", "--help": "help", "-h": "help" };
const SECRET_FLAG_RE = /key|seed|secret|private|mnemonic|passw|token|phrase/i;

export const USAGE = `usage: node scripts/setup-testnet.mjs <command> [options]

commands
  plan       print what would be done (offline, no network, nothing written)
  accounts   create owner/operator/relayer/merchant sub-accounts, generate keys, write .env.local
  keys       add function-call keys to the merchant accounts (also: --rotate <roles>)
  deploy     build the wasm, deploy it, call init in one batch
  verify     read-only checks (get_config, get_world, wasm hash, merchant keys)
  all        accounts, keys, deploy, verify in that order

options
  --dry-run                 do not change anything (reads the chain, writes no file); always on for plan
  --force                   allow replacing differing values in .env.local / a mismatching key or contract
  --env-file <path>         default: .env.local in the repository root
  --allowance <NEAR>        gas allowance of each merchant function-call key (default ${DEFAULT_ALLOWANCE})
  --max-players <n>         init argument (default ${DEFAULT_MAX_PLAYERS})
  --operator-daily-cap <f>  init argument in fils (default ${DEFAULT_OPERATOR_DAILY_CAP})
  --wasm <path>             deploy this wasm instead of the default build output
  --skip-build              deploy the existing wasm without running cargo
  --rotate <roles>          keys only: comma list of dasht,madan,bandar,shahr,relayer,operator

environment (names only; see .env.example): ROOT_ACCOUNT_ID, ROOT_KEY_FILE, FUND_*_NEAR, KEY_ALLOWANCE_NEAR.
Keys are never accepted on the command line.`;

/** @returns {{command: string, flags: Record<string, any>}} */
export function parseArgs(argv) {
  const flags = {};
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (looksLikeKeyMaterial(a)) throw new SetupError("refusing: an argument looks like key material. Keys are never accepted on the command line (use ROOT_KEY_FILE / .env.local).", 2);
    if (a in BOOL_FLAGS) { flags[BOOL_FLAGS[a]] = true; continue; }
    if (a in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new SetupError(`${a} needs a value`, 2);
      if (looksLikeKeyMaterial(v)) throw new SetupError(`refusing: the value of ${a} looks like key material. Keys are never accepted on the command line.`, 2);
      flags[VALUE_FLAGS[a]] = v;
      continue;
    }
    if (a.startsWith("-")) {
      const name = a.split("=")[0];
      if (SECRET_FLAG_RE.test(name)) throw new SetupError(`refusing ${name}: keys and secrets are never accepted on the command line. The root key is read from the file named by ROOT_KEY_FILE or from the near-cli credentials directory.`, 2);
      throw new SetupError(`unknown option ${name}\n${USAGE}`, 2);
    }
    if (command) throw new SetupError(`unexpected argument ${a}`, 2);
    command = a;
  }
  if (flags.help) return { command: "help", flags };
  if (!command) throw new SetupError(`a command is required\n${USAGE}`, 2);
  if (!COMMANDS.includes(command)) throw new SetupError(`unknown command ${command}\n${USAGE}`, 2);
  if (flags.rotate && command !== "keys") throw new SetupError("--rotate is only valid with the keys command", 2);
  return { command, flags };
}
