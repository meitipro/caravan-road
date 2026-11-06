// Test doubles for scripts/setup-testnet.mjs: an in-memory NEAR chain, a fake key generator with sentinel
// secret strings, and a scenario builder. Nothing here touches the network or a real key.
// Every secret is a sentinel (ed25519:FAKESECRET...) so tests can assert it never appears in any output.

import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Secret, codeHashOf, NO_CODE_HASH, YOCTO_PER_NEAR } from "../lib/setup-core.mjs";
import { main } from "../setup-testnet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REAL_REPO = join(HERE, "..", "..");
export const near = (n) => BigInt(Math.round(Number(n) * 1e6)) * (YOCTO_PER_NEAR / 1_000_000n);

export const ROOT = "example.testnet";
export const ROOT_SECRET = "ed25519:FAKESECRETRoot" + "x".repeat(30); // base58-shaped on purpose: the key-file parser is strict
export const ROOT_PUBLIC = "ed25519:FAKEPUBLICRoot";

export function makeFakeCrypto() {
  let n = 0;
  return {
    generateKeyPair() {
      n++;
      return { secret: new Secret(`ed25519:FAKESECRETGen${n}` + "x".repeat(30)), publicKey: `ed25519:FAKEPUBLICGen${n}` };
    },
    publicKeyOf(secret) { return secret.reveal().replace("FAKESECRET", "FAKEPUBLIC").replace(/x+$/, ""); },
  };
}

export class FakeChain {
  constructor(crypto) {
    this.crypto = crypto;
    this.accounts = new Map();
    this.calls = [];
    this.failOn = null;      // (call) => boolean: throw before applying
    this.onCall = null;      // (call) => void: observer, runs before applying
    this.views = {};         // method -> value | function
  }
  addAccount(id, { balance, keys = [], codeHash = NO_CODE_HASH }) {
    this.accounts.set(id, { balance, keys: [...keys], codeHash });
  }
  _rec(call) {
    this.calls.push(call);
    if (this.onCall) this.onCall(call);
    if (this.failOn && this.failOn(call)) throw new Error(`fake chain refused ${call.type}`);
  }
  _asFull(accountId, signer) {
    const a = this.accounts.get(accountId);
    if (!a) throw new Error(`account ${accountId} does not exist`);
    const pk = this.crypto.publicKeyOf(signer);
    if (!a.keys.some((k) => k.publicKey === pk && k.kind === "full")) throw new Error(`signer key is not a full-access key of ${accountId}`);
    return a;
  }
  async getAccount(id) {
    this.calls.push({ type: "getAccount", id });
    const a = this.accounts.get(id);
    return a ? { total: a.balance, available: a.balance, storageUsage: 0, codeHash: a.codeHash } : null;
  }
  async listKeys(id) {
    this.calls.push({ type: "listKeys", id });
    return (this.accounts.get(id)?.keys ?? []).map((k) => ({ ...k }));
  }
  async createSubAccount({ parentId, signer, newAccountId, publicKey, amount }) {
    this._rec({ type: "createSubAccount", parentId, newAccountId, publicKey, amount, signedBy: parentId });
    const parent = this._asFull(parentId, signer);
    if (this.accounts.has(newAccountId)) throw new Error("AccountAlreadyExists");
    if (parent.balance < amount) throw new Error("not enough balance");
    parent.balance -= amount;
    this.addAccount(newAccountId, { balance: amount, keys: [{ publicKey, kind: "full" }] });
    return { txHash: `TX${this.calls.length}` };
  }
  async addFunctionCallKey({ accountId, signer, publicKey, contractId, methodNames, allowance }) {
    this._rec({ type: "addFunctionCallKey", accountId, publicKey, contractId, methodNames: [...methodNames], allowance });
    const a = this._asFull(accountId, signer);
    if (a.keys.some((k) => k.publicKey === publicKey)) throw new Error("AddKeyAlreadyExists");
    a.keys.push({ publicKey, kind: "function-call", receiverId: contractId, methodNames: [...methodNames], allowance });
    return { txHash: `TX${this.calls.length}` };
  }
  async addFullAccessKey({ accountId, signer, publicKey }) {
    this._rec({ type: "addFullAccessKey", accountId, publicKey });
    const a = this._asFull(accountId, signer);
    a.keys.push({ publicKey, kind: "full" });
    return { txHash: `TX${this.calls.length}` };
  }
  async deleteKey({ accountId, signer, publicKey }) {
    this._rec({ type: "deleteKey", accountId, publicKey });
    const a = this._asFull(accountId, signer);
    a.keys = a.keys.filter((k) => k.publicKey !== publicKey);
    return { txHash: `TX${this.calls.length}` };
  }
  _applyInit(accountId, initArgs) {
    if (this.views.get_config) throw new Error("The contract has already been initialized");
    this.views.get_config = {
      version: "fake", owner: initArgs.owner, operator: initArgs.operator, mode: initArgs.mode, paused: false,
      max_players: initArgs.max_players, player_suffix: String(initArgs.player_suffix).replace(/^\./, ""),
      operator_daily_cap: initArgs.operator_daily_cap, auto_ship: initArgs.auto_ship,
      merchant_accounts: Object.values(initArgs.merchant_accounts),
    };
    this.views.get_world = { tick: 0, mode: initArgs.mode, paused: false, player_count: 0, merchants: [{}, {}, {}, {}] };
  }
  async deployAndInit({ accountId, signer, code, initArgs }) {
    this._rec({ type: "deployAndInit", accountId, codeHash: codeHashOf(code), initArgs, actions: ["DeployContract", "FunctionCall:init"] });
    const a = this._asFull(accountId, signer);
    this._applyInit(accountId, initArgs); // throws before the deploy is applied: the batch is atomic
    a.codeHash = codeHashOf(code);
    return { txHash: `TX${this.calls.length}` };
  }
  async deploy({ accountId, signer, code }) {
    this._rec({ type: "deploy", accountId, codeHash: codeHashOf(code) });
    this._asFull(accountId, signer).codeHash = codeHashOf(code);
    return { txHash: `TX${this.calls.length}` };
  }
  async callInit({ accountId, signer, initArgs }) {
    this._rec({ type: "callInit", accountId, initArgs });
    this._asFull(accountId, signer);
    this._applyInit(accountId, initArgs);
    return { txHash: `TX${this.calls.length}` };
  }
  async view({ contractId, method }) {
    this.calls.push({ type: "view", contractId, method });
    const v = this.views[method];
    if (v === undefined) throw new Error(`The contract has not been initialized (${method})`);
    return typeof v === "function" ? v() : v;
  }
  /** Only the state-changing calls, in order, as compact strings. */
  mutations() { return this.calls.filter((c) => !["getAccount", "listKeys", "view"].includes(c.type)); }
}

/** A synthetic wasm that passes the host-import sanity check. */
export function fakeWasm(tag = "a") {
  return Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), Buffer.from(`storage_write predecessor_account_id ${tag}`)]);
}

/**
 * A throw-away repository root (under scripts/__tests__, i.e. on the project drive) with just what the script reads:
 * .gitignore, scripts/init-args.mjs and contracts/caravan/.cargo/config.toml, plus a key file for the fake root account.
 */
export function scenario({ rootBalance = 100, env = {}, rootExists = true } = {}) {
  const dir = mkdtempSync(join(HERE, ".tmp-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "contracts", "caravan", ".cargo"), { recursive: true });
  copyFileSync(join(REAL_REPO, ".gitignore"), join(dir, ".gitignore"));
  copyFileSync(join(REAL_REPO, "scripts", "init-args.mjs"), join(dir, "scripts", "init-args.mjs"));
  copyFileSync(join(REAL_REPO, "contracts", "caravan", ".cargo", "config.toml"), join(dir, "contracts", "caravan", ".cargo", "config.toml"));
  const keyFile = join(dir, "root-key.json");
  writeFileSync(keyFile, JSON.stringify({ account_id: ROOT, public_key: ROOT_PUBLIC, private_key: ROOT_SECRET }));

  const crypto = makeFakeCrypto();
  const chain = new FakeChain(crypto);
  if (rootExists) chain.addAccount(ROOT, { balance: near(rootBalance), keys: [{ publicKey: ROOT_PUBLIC, kind: "full" }] });
  const execCalls = [];
  const buildCalls = [];
  const out = [];
  const err = [];
  let chainCreated = 0;
  const processEnv = { ROOT_ACCOUNT_ID: ROOT, ROOT_KEY_FILE: keyFile, USERNAME: "tester", ...env };
  const exec = (command, args, opts = {}) => {
    execCalls.push({ command, args: [...args] });
    if (args[0] && String(args[0]).endsWith("init-args.mjs")) {
      const r = spawnSync(command, args, { encoding: "utf8", cwd: opts.cwd });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const s = {
    dir, chain, crypto, execCalls, buildCalls, out, err, processEnv,
    envPath: join(dir, ".env.local"),
    wasmPath: join(dir, "contracts", "caravan", "target", "wasm32-unknown-unknown", "release", "caravan.wasm"),
    get chainCreated() { return chainCreated; },
    readEnv() { try { return readFileSync(join(dir, ".env.local"), "utf8"); } catch { return null; } },
    envMap() { const m = new Map(); for (const l of (s.readEnv() ?? "").split(/\r?\n/)) { const x = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (x) m.set(x[1], x[2]); } return m; },
    all() { return [...out, ...err].join("\n"); },
    async run(args, extra = {}) {
      const before = { o: out.length, e: err.length };
      const code = await main(args, {
        repoRoot: dir, processEnv, exec, home: dir, platform: process.platform, crypto,
        createChain: () => { chainCreated++; return chain; },
        runBuild: (o) => {
          buildCalls.push(o);
          mkdirSync(dirname(s.wasmPath), { recursive: true });
          writeFileSync(s.wasmPath, fakeWasm("built"));
          return { status: 0 };
        },
        out: (l) => out.push(l), err: (l) => err.push(l), redact: false, ...extra,
      });
      return { code, out: out.slice(before.o), err: err.slice(before.e), text: [...out.slice(before.o), ...err.slice(before.e)].join("\n") };
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
  return s;
}
