// Offline tests for scripts/setup-testnet.mjs. Run: node --test scripts/__tests__/setup-testnet.test.mjs
// No network, no real key: a fake chain and sentinel secrets (ed25519:FAKESECRET...) stand in for NEAR. The script's real
// main() runs end to end against them, including the real scripts/init-args.mjs as a child process.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import nodeFs, { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  FakeChain, REAL_REPO, ROOT, ROOT_PUBLIC, ROOT_SECRET, fakeWasm, makeFakeCrypto, near, scenario,
} from "./fakes.mjs";
import {
  Secret, SetupError, base58Encode, buildConfig, codeHashOf, createLogger, formatNear, looksLikeKeyMaterial,
  parseArgs, parseNear, redact, NO_CODE_HASH,
} from "../lib/setup-core.mjs";
import { applyWrites, parseEnvText, planUpdates, writeEnvFileAtomic } from "../lib/setup-env.mjs";
import { loadRootKeyCandidates, parseKeyFileText, randomHexSecret } from "../lib/setup-keys.mjs";
import { readOnlyChain, MUTATING_METHODS } from "../lib/near-chain.mjs";

const made = [];
const mk = (o) => { const s = scenario(o); made.push(s); return s; };
after(() => { for (const s of made) s.cleanup(); });

const ROLE_IDS = ["owner", "operator", "relayer", "dasht", "madan", "bandar", "shahr"].map((r) => `${r}.${ROOT}`);
const SECRET_VARS = ["OWNER_PRIVATE_KEY", "OPERATOR_PRIVATE_KEY", "RELAYER_PRIVATE_KEY", "KEY_DASHT", "KEY_MADAN", "KEY_BANDAR", "KEY_SHAHR", "KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"];

/** Every secret value this scenario has seen (root key, all generated keys, every secret in the env file). */
function secretsOf(s) {
  const vals = new Set([ROOT_SECRET]);
  for (const v of SECRET_VARS) { const x = s.envMap().get(v); if (x) vals.add(x); }
  for (let i = 1; i < 60; i++) vals.add(`ed25519:FAKESECRETGen${i}` + "x".repeat(30));
  return [...vals];
}
const assertNoSecrets = (s, extraText = "") => {
  const haystack = [s.all(), extraText, JSON.stringify(s.execCalls), JSON.stringify(s.buildCalls)].join("\n");
  for (const v of secretsOf(s)) assert.ok(!haystack.includes(v), "a secret value leaked into output or a child-process argument");
};
const callTypes = (s) => s.chain.mutations().map((c) => c.type);

async function fullSetup(s) {
  for (const cmd of ["accounts", "keys", "deploy"]) {
    const r = await s.run([cmd]);
    assert.equal(r.code, 0, `${cmd} failed:\n${r.text}`);
  }
}

// -------------------------------------------------------------------------------------------------- plan

test("plan: offline, derives every name from ROOT_ACCOUNT_ID, writes nothing, never builds a chain", async () => {
  const s = mk({ env: { ROOT_ACCOUNT_ID: "zzz-root.testnet" } });
  const r = await s.run(["plan"]);
  assert.equal(r.code, 0, r.text);
  assert.equal(s.chainCreated, 0, "plan must not construct a chain");
  assert.equal(s.chain.calls.length, 0);
  assert.equal(s.readEnv(), null, "plan must not write the env file");
  for (const role of ["owner", "operator", "relayer", "dasht", "madan", "bandar", "shahr"]) assert.match(r.text, new RegExp(`${role}\\.zzz-root\\.testnet`));
  assert.ok(!/caravan-road|example\.testnet/.test(r.text), "no hard-coded names");
  assert.match(r.text, /"player_suffix":"\.relayer\.zzz-root\.testnet"/);
  assert.match(r.text, /"operator_daily_cap":"200000"/);
  assert.match(r.text, /KEY_ENC_SECRET\s+will be generated/);
  assert.deepEqual(s.execCalls.map((c) => c.command), [process.execPath], "plan runs only scripts/init-args.mjs");
  assertNoSecrets(s);
});

test("plan reports which secret names are already set, by name only", async () => {
  const s = mk();
  writeFileSync(s.envPath, `KEY_ENC_SECRET=${"ab".repeat(32)}\nAUTH_SECRET=\n`);
  const r = await s.run(["plan"]);
  assert.match(r.text, /KEY_ENC_SECRET\s+already set/);
  assert.match(r.text, /AUTH_SECRET\s+will be generated/);
  assert.ok(!r.text.includes("ab".repeat(32)));
});

test("config validation: root required, testnet only, id length, contract placement", async () => {
  const bad = async (env, re) => {
    const s = mk({ env });
    const r = await s.run(["plan"]);
    assert.equal(r.code, 2, r.text);
    assert.match(r.text, re);
  };
  await bad({ ROOT_ACCOUNT_ID: "" }, /ROOT_ACCOUNT_ID is not set/);
  await bad({ ROOT_ACCOUNT_ID: "someone.near" }, /mainnet/);
  await bad({ ROOT_ACCOUNT_ID: ROOT, NEAR_NETWORK: "mainnet" }, /testnet-only/);
  await bad({ ROOT_ACCOUNT_ID: "Bad_Name.testnet" }, /not a valid NEAR account id/);
  await bad({ ROOT_ACCOUNT_ID: `${"a".repeat(45)}.testnet` }, /exceed 64|too long/);
  await bad({ CARAVAN_CONTRACT_ID: "elsewhere.testnet" }, /root account itself or a sub-account/);
  await bad({ FUND_RELAYER_NEAR: "lots" }, /plain decimal NEAR amount/);
  const s = mk({ env: { CARAVAN_CONTRACT_ID: `contract.${ROOT}` } });
  const ok = await s.run(["plan"]);
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /contract\.example\.testnet\s+fund 6 NEAR/);
});

// ----------------------------------------------------------------------------------------------- argv safety

test("argv: keys and secrets are refused, never echoed", async () => {
  const keyShaped = `ed25519:${"A1b2".repeat(22)}`;
  assert.ok(looksLikeKeyMaterial(keyShaped));
  assert.ok(looksLikeKeyMaterial("ab".repeat(32)));
  assert.ok(looksLikeKeyMaterial("one two three four five six seven eight nine ten eleven twelve"));
  for (const argv of [["accounts", "--private-key", "x"], ["accounts", "--root-key", "x"], ["accounts", "--seed-phrase", "x"], ["accounts", keyShaped], ["keys", "--rotate", keyShaped], ["accounts", "--env-file", keyShaped]]) {
    assert.throws(() => parseArgs(argv), (e) => e instanceof SetupError && e.exitCode === 2 && !e.message.includes(keyShaped));
  }
  const s = mk();
  const r = await s.run(["accounts", "--private-key", keyShaped]);
  assert.equal(r.code, 2);
  assert.ok(!r.text.includes(keyShaped));
  assert.equal(s.chain.calls.length, 0);
  assert.throws(() => parseArgs(["nope"]), /unknown command/);
  assert.throws(() => parseArgs(["accounts", "--rotate", "dasht"]), /only valid with the keys/);
  assert.deepEqual(parseArgs(["accounts", "--dry-run", "--force"]).flags, { dryRun: true, force: true });
});

// ------------------------------------------------------------------------------------------------- accounts

test("accounts: exact action sequence; keys are saved before the first transfer; merchants share the owner admin key", async () => {
  const s = mk();
  let envAtFirstCreate = null;
  s.chain.onCall = (c) => { if (c.type === "createSubAccount" && envAtFirstCreate === null) envAtFirstCreate = s.readEnv(); };
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 0, r.text);

  assert.deepEqual(s.chain.mutations().map((c) => [c.type, c.parentId, c.newAccountId, c.amount]), [
    ["createSubAccount", ROOT, `owner.${ROOT}`, near(0.5)],
    ["createSubAccount", ROOT, `operator.${ROOT}`, near(1)],
    ["createSubAccount", ROOT, `relayer.${ROOT}`, near(3)],
    ...["dasht", "madan", "bandar", "shahr"].map((c) => ["createSubAccount", ROOT, `${c}.${ROOT}`, near(2)]),
  ]);
  const env = s.envMap();
  for (const v of SECRET_VARS) assert.ok(env.get(v), `${v} written`);
  assert.ok(envAtFirstCreate && /OWNER_PRIVATE_KEY=ed25519:FAKESECRET/.test(envAtFirstCreate), "owner key saved before the first on-chain change");
  assert.ok(/KEY_DASHT=/.test(envAtFirstCreate) && /KEY_ENC_SECRET=/.test(envAtFirstCreate));

  const pk = (v) => s.crypto.publicKeyOf(new Secret(env.get(v)));
  const create = (id) => s.chain.calls.find((c) => c.type === "createSubAccount" && c.newAccountId === id);
  assert.equal(create(`owner.${ROOT}`).publicKey, pk("OWNER_PRIVATE_KEY"));
  assert.equal(create(`operator.${ROOT}`).publicKey, pk("OPERATOR_PRIVATE_KEY"));
  assert.equal(create(`relayer.${ROOT}`).publicKey, pk("RELAYER_PRIVATE_KEY"));
  for (const c of ["dasht", "madan", "bandar", "shahr"]) assert.equal(create(`${c}.${ROOT}`).publicKey, pk("OWNER_PRIVATE_KEY"), "merchant admin key is the owner key");
  assert.equal(new Set(SECRET_VARS.slice(0, 7).map((v) => env.get(v))).size, 7, "all keys differ");

  for (const v of ["KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"]) assert.match(env.get(v), /^[0-9a-f]{64}$/, `${v} is 64 hex`);
  assert.equal(new Set(["KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"].map((v) => env.get(v))).size, 3);
  assert.equal(env.get("OPERATOR_ACCOUNT_ID"), `operator.${ROOT}`);
  assert.equal(env.get("RELAYER_ACCOUNT_ID"), `relayer.${ROOT}`);
  assert.equal(env.get("MERCHANT_ACCOUNT_SHAHR"), `shahr.${ROOT}`);
  assert.equal(env.get("OWNER_ACCOUNT_ID"), `owner.${ROOT}`);
  assert.equal(env.get("CARAVAN_CONTRACT_ID"), ROOT);
  assert.equal(env.get("GAME_MODE"), "PLAY");
  assert.equal(env.get("NEAR_NETWORK"), "testnet");
  assert.ok(s.execCalls.some((c) => c.command === "git" && c.args[0] === "check-ignore" && c.args.includes(".env.local")), "git-ignore verified");
  if (process.platform !== "win32") assert.equal(statSync(s.envPath).mode & 0o777, 0o600);
  else assert.ok(s.execCalls.some((c) => c.command === "icacls" && c.args.includes("/inheritance:r")), "ACL restricted on Windows");
  assert.deepEqual(readdirSync(s.dir).filter((f) => f.includes(".tmp-")), [], "no temp file left behind");
  assertNoSecrets(s);
});

test("accounts: re-running is idempotent (no transfers, env file byte-identical)", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const before = s.readEnv();
  const n = s.chain.mutations().length;
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 0, r.text);
  assert.equal(s.chain.mutations().length, n, "nothing created the second time");
  assert.equal(s.readEnv(), before);
  assert.match(r.text, /accounts done: 0 created, 7 already existed/);
});

test("accounts: a crash half way is resumed with the same keys", async () => {
  const s = mk();
  s.chain.failOn = (c) => c.type === "createSubAccount" && c.newAccountId === `relayer.${ROOT}`;
  const r1 = await s.run(["accounts"]);
  assert.equal(r1.code, 1);
  assert.deepEqual([...s.chain.accounts.keys()].sort(), [ROOT, `operator.${ROOT}`, `owner.${ROOT}`].sort());
  const keysAfterCrash = new Map(s.envMap());
  s.chain.failOn = null;
  const r2 = await s.run(["accounts"]);
  assert.equal(r2.code, 0, r2.text);
  for (const v of SECRET_VARS) assert.equal(s.envMap().get(v), keysAfterCrash.get(v), `${v} unchanged after resume`);
  assert.equal(s.chain.accounts.size, 8);
  assert.deepEqual(s.chain.calls.filter((c) => c.type === "createSubAccount").map((c) => c.newAccountId), [
    `owner.${ROOT}`, `operator.${ROOT}`, `relayer.${ROOT}`, // the third attempt failed
    `relayer.${ROOT}`, ...["dasht", "madan", "bandar", "shahr"].map((c) => `${c}.${ROOT}`),
  ], "the second run created only what was missing");
  assertNoSecrets(s);
});

test("accounts: refuses to overwrite differing values without --force, keeps existing secrets always", async () => {
  const s = mk();
  const keepSecret = "cd".repeat(32);
  const initial = `RELAYER_ACCOUNT_ID=other.testnet\nKEY_ENC_SECRET=${keepSecret}\n`;
  writeFileSync(s.envPath, initial);
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /refusing to overwrite/);
  assert.match(r.text, /RELAYER_ACCOUNT_ID/);
  assert.ok(!r.text.includes(keepSecret));
  assert.equal(s.readEnv(), initial, "file untouched");
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.chain.calls.length, 0, "refused before any chain access");

  const forced = await s.run(["accounts", "--force"]);
  assert.equal(forced.code, 0, forced.text);
  assert.equal(s.envMap().get("RELAYER_ACCOUNT_ID"), `relayer.${ROOT}`);
  assert.equal(s.envMap().get("KEY_ENC_SECRET"), keepSecret, "an existing secret is never regenerated, even with --force");
  assert.match(forced.text, /--force: replacing existing value\(s\) of RELAYER_ACCOUNT_ID/);
});

test("accounts: existing secrets are reused, empty template values are filled", async () => {
  const s = mk();
  writeFileSync(s.envPath, `AUTH_SECRET=${"12".repeat(32)}\nCRON_SECRET=\nRELAYER_PRIVATE_KEY=\n`);
  assert.equal((await s.run(["accounts"])).code, 0);
  assert.equal(s.envMap().get("AUTH_SECRET"), "12".repeat(32));
  assert.match(s.envMap().get("CRON_SECRET"), /^[0-9a-f]{64}$/);
  assert.match(s.envMap().get("RELAYER_PRIVATE_KEY"), /^ed25519:FAKESECRET/);
  assert.equal((s.readEnv().match(/^CRON_SECRET=/gm) ?? []).length, 1, "the empty line was filled, not duplicated");
});

test("accounts: an existing account without a matching local key aborts instead of guessing", async () => {
  const s = mk();
  s.chain.addAccount(`operator.${ROOT}`, { balance: near(1), keys: [{ publicKey: "ed25519:FAKEPUBLICStranger", kind: "full" }] });
  let r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /operator\.example\.testnet already exists but OPERATOR_PRIVATE_KEY is not set/);
  assert.equal(s.chain.mutations().length, 0);
  writeFileSync(s.envPath, `OPERATOR_PRIVATE_KEY=ed25519:FAKESECRETOther${"x".repeat(30)}\n`);
  r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /not one of its full-access keys/);
  assert.equal(s.chain.mutations().length, 0);
});

test("accounts: low root balance aborts before anything is written or created", async () => {
  const s = mk({ rootBalance: 5 });
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /root balance is too low/);
  assert.match(r.text, /short by/);
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.readEnv(), null, "no env file written");
});

test("accounts: the root balance is re-checked before every transfer", async () => {
  const s = mk();
  const orig = s.chain.createSubAccount.bind(s.chain);
  s.chain.createSubAccount = async (a) => {
    const res = await orig(a);
    if (a.newAccountId.startsWith("owner.")) s.chain.accounts.get(ROOT).balance = near(0.001);
    return res;
  };
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /dropped below what is needed for operator\.example\.testnet/);
  assert.equal(s.chain.accounts.size, 2, "only the owner was created");
});

test("accounts: the root account must exist and its key must be a full-access key of it", async () => {
  let s = mk({ rootExists: false });
  let r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /root account example\.testnet does not exist/);
  s = mk();
  s.chain.accounts.get(ROOT).keys = [{ publicKey: "ed25519:FAKEPUBLICSomeone", kind: "full" }];
  r = await s.run(["accounts"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /not a full-access key of example\.testnet/);
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.readEnv(), null);
});

test("accounts: refuses to write secrets into a file that is not git-ignored", async () => {
  const s = mk();
  const exec = (command, args) => ({ status: command === "git" ? 1 : 0, stdout: "", stderr: "" });
  const r = await s.run(["accounts"], { exec });
  assert.equal(r.code, 1);
  assert.match(r.text, /not git-ignored/);
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.readEnv(), null);
});

test("accounts --dry-run: no file, no mutation, reads only; low balance still reported", async () => {
  const s = mk();
  const r = await s.run(["accounts", "--dry-run"]);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/would create/g) ?? []).length, 7);
  assert.match(r.text, /DRY RUN/);
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.readEnv(), null);
  assert.ok(s.chain.calls.every((c) => ["getAccount", "listKeys", "view"].includes(c.type)), "reads only");
  const low = mk({ rootBalance: 3 });
  const r2 = await low.run(["accounts", "--dry-run"]);
  assert.equal(r2.code, 1);
  assert.match(r2.text, /too low/);
  assertNoSecrets(s);
});

// ------------------------------------------------------------------------------------------------ chain guard

test("readOnlyChain turns every mutating method into a hard failure", async () => {
  const chain = readOnlyChain(new FakeChain(makeFakeCrypto()));
  for (const m of MUTATING_METHODS) await assert.rejects(() => chain[m]({}), /BUG: mutating call/);
  assert.deepEqual(await chain.getAccount("nobody.testnet"), null);
});

// ------------------------------------------------------------------------------------------------------ keys

test("keys: function-call keys restricted to the contract and the methods, signed by the owner, idempotent", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const created = s.chain.mutations().length;
  const r = await s.run(["keys", "--allowance", "0.25"]);
  assert.equal(r.code, 0, r.text);
  const adds = s.chain.mutations().slice(created);
  assert.deepEqual(adds.map((c) => c.type), Array(4).fill("addFunctionCallKey"));
  const env = s.envMap();
  for (const [i, city] of ["dasht", "madan", "bandar", "shahr"].entries()) {
    const c = adds[i];
    assert.equal(c.accountId, `${city}.${ROOT}`);
    assert.equal(c.contractId, ROOT);
    assert.equal(c.allowance, near(0.25));
    assert.equal(c.publicKey, s.crypto.publicKeyOf(new Secret(env.get(`KEY_${city.toUpperCase()}`))));
    assert.deepEqual([...c.methodNames].sort(), city === "shahr" ? ["set_policy", "ship", "world_tick"] : ["set_policy", "ship"]);
  }
  const again = await s.run(["keys"]);
  assert.equal(again.code, 0, again.text);
  assert.equal(s.chain.mutations().length, created + 4, "second run adds nothing");
  assert.match(again.text, /keys done: 0 added, 4 already present/);
  assertNoSecrets(s);
});

test("keys: needs the accounts step first; dry-run changes nothing", async () => {
  const s = mk();
  let r = await s.run(["keys"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /OWNER_PRIVATE_KEY is not set/);
  assert.equal((await s.run(["accounts"])).code, 0);
  const n = s.chain.mutations().length;
  r = await s.run(["keys", "--dry-run"]);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/would add/g) ?? []).length, 4);
  assert.equal(s.chain.mutations().length, n);
});

test("keys: a key with the wrong receiver is refused, replaced with --force (delete, then add)", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const pk = s.crypto.publicKeyOf(new Secret(s.envMap().get("KEY_MADAN")));
  s.chain.accounts.get(`madan.${ROOT}`).keys.push({ publicKey: pk, kind: "function-call", receiverId: "wrong.testnet", methodNames: ["trade"], allowance: near(1) });
  const n = s.chain.mutations().length;
  let r = await s.run(["keys"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /different receiver or method list/);
  assert.equal(s.chain.mutations().length, n, "nothing changed on refusal");
  r = await s.run(["keys", "--force"]);
  assert.equal(r.code, 0, r.text);
  const tail = s.chain.mutations().slice(n).filter((c) => c.accountId === `madan.${ROOT}`).map((c) => c.type);
  assert.deepEqual(tail, ["deleteKey", "addFunctionCallKey"]);
  const k = s.chain.accounts.get(`madan.${ROOT}`).keys.find((x) => x.publicKey === pk);
  assert.equal(k.receiverId, ROOT);
});

test("keys --rotate: add new, save it, then delete the old key (merchant and relayer)", async () => {
  const s = mk();
  await fullSetup(s);
  const oldDasht = s.envMap().get("KEY_DASHT");
  const oldRelayer = s.envMap().get("RELAYER_PRIVATE_KEY");
  const oldDashtPk = s.crypto.publicKeyOf(new Secret(oldDasht));
  const oldRelayerPk = s.crypto.publicKeyOf(new Secret(oldRelayer));
  const n = s.chain.mutations().length;
  const envAtDelete = {};
  s.chain.onCall = (c) => { if (c.type === "deleteKey") envAtDelete[c.accountId] = s.readEnv(); };
  const r = await s.run(["keys", "--rotate", "dasht,relayer"]);
  assert.equal(r.code, 0, r.text);
  const seq = s.chain.mutations().slice(n).map((c) => `${c.type}:${c.accountId}`);
  assert.deepEqual(seq, [`addFunctionCallKey:dasht.${ROOT}`, `deleteKey:dasht.${ROOT}`, `addFullAccessKey:relayer.${ROOT}`, `deleteKey:relayer.${ROOT}`]);
  const env = s.envMap();
  assert.notEqual(env.get("KEY_DASHT"), oldDasht);
  assert.notEqual(env.get("RELAYER_PRIVATE_KEY"), oldRelayer);
  assert.ok(envAtDelete[`dasht.${ROOT}`].includes(env.get("KEY_DASHT")), "the new key was saved before the old one was deleted");
  assert.ok(envAtDelete[`relayer.${ROOT}`].includes(env.get("RELAYER_PRIVATE_KEY")));
  const dashtKeys = s.chain.accounts.get(`dasht.${ROOT}`).keys.map((k) => k.publicKey);
  assert.ok(!dashtKeys.includes(oldDashtPk));
  assert.ok(dashtKeys.includes(s.crypto.publicKeyOf(new Secret(env.get("KEY_DASHT")))));
  assert.ok(!s.chain.accounts.get(`relayer.${ROOT}`).keys.some((k) => k.publicKey === oldRelayerPk));
  assertNoSecrets(s);
  for (const v of [oldDasht, oldRelayer]) assert.ok(!s.all().includes(v), "the old key value is not printed either");
  const bad = await s.run(["keys", "--rotate", "owner"]);
  assert.equal(bad.code, 2);
});

test("keys --rotate: a chain failure leaves the old key and the file untouched; an unwritable file aborts before the chain", async () => {
  const s = mk();
  await fullSetup(s);
  const envBefore = s.readEnv();
  s.chain.failOn = (c) => c.type === "addFunctionCallKey";
  let r = await s.run(["keys", "--rotate", "shahr"]);
  assert.equal(r.code, 1);
  assert.equal(s.readEnv(), envBefore);
  s.chain.failOn = null;

  let blocked = false;
  const fsBlocked = { ...nodeFs, renameSync: (...a) => { if (blocked) throw Object.assign(new Error("denied"), { code: "EPERM" }); return nodeFs.renameSync(...a); } };
  blocked = true;
  const n = s.chain.mutations().length;
  r = await s.run(["keys", "--rotate", "shahr"], { fs: fsBlocked });
  assert.equal(r.code, 1);
  assert.equal(s.chain.mutations().length, n, "probe failed before any chain change");

  blocked = false;
  const orig = s.chain.addFunctionCallKey.bind(s.chain);
  s.chain.addFunctionCallKey = async (a) => { const res = await orig(a); blocked = true; return res; };
  r = await s.run(["keys", "--rotate", "shahr"], { fs: fsBlocked });
  assert.equal(r.code, 1);
  assert.match(r.text, /could not be saved/);
  assert.match(r.text, /OLD key is still active/);
  assert.ok(!s.chain.mutations().slice(n).some((c) => c.type === "deleteKey"), "old key not deleted when the new one is not saved");
  assert.equal(s.readEnv(), envBefore);
  assertNoSecrets(s);
});

// ----------------------------------------------------------------------------------------------------- deploy

test("deploy: builds with the repository flags, then ONE batch (deploy + init) signed by the root; init args come from init-args.mjs", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const n = s.chain.mutations().length;
  const r = await s.run(["deploy"]);
  assert.equal(r.code, 0, r.text);
  assert.equal(s.buildCalls.length, 1);
  assert.deepEqual(s.buildCalls[0].args, ["build", "--target", "wasm32-unknown-unknown", "--release"]);
  assert.equal(s.buildCalls[0].command, "cargo");
  assert.equal(s.buildCalls[0].cwd, join(s.dir, "contracts", "caravan"));
  const tx = s.chain.mutations().slice(n);
  assert.equal(tx.length, 1, "a single transaction");
  assert.equal(tx[0].type, "deployAndInit");
  assert.deepEqual(tx[0].actions, ["DeployContract", "FunctionCall:init"]);
  assert.equal(tx[0].accountId, ROOT);
  assert.equal(tx[0].codeHash, codeHashOf(readFileSync(s.wasmPath)));
  assert.deepEqual(tx[0].initArgs, {
    owner: `owner.${ROOT}`, operator: `operator.${ROOT}`, mode: "PLAY",
    merchant_accounts: { dasht: `dasht.${ROOT}`, madan: `madan.${ROOT}`, bandar: `bandar.${ROOT}`, shahr: `shahr.${ROOT}` },
    max_players: 1000, player_suffix: `.relayer.${ROOT}`, operator_daily_cap: "200000", auto_ship: false,
  });
  const initCall = s.execCalls.find((c) => c.args[0]?.endsWith("init-args.mjs"));
  assert.ok(initCall, "the real scripts/init-args.mjs produced the arguments");
  assert.match(r.text, /get_config: mode PLAY, paused false/);
  assertNoSecrets(s);
});

test("deploy: --max-players and --operator-daily-cap are passed to init", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const r = await s.run(["deploy", "--max-players", "50", "--operator-daily-cap", "1234"]);
  assert.equal(r.code, 0, r.text);
  const c = s.chain.calls.find((x) => x.type === "deployAndInit");
  assert.equal(c.initArgs.max_players, 50);
  assert.equal(c.initArgs.operator_daily_cap, "1234");
});

test("deploy: idempotent; init-only when the code is there but init was not called", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  assert.equal((await s.run(["deploy"])).code, 0);
  const n = s.chain.mutations().length;
  const again = await s.run(["deploy"]);
  assert.equal(again.code, 0, again.text);
  assert.equal(s.chain.mutations().length, n);
  assert.match(again.text, /already deployed and initialised/);

  const t = mk();
  assert.equal((await t.run(["accounts"])).code, 0);
  t.chain.accounts.get(ROOT).codeHash = codeHashOf(fakeWasm("built"));
  const r = await t.run(["deploy"]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(t.chain.mutations().slice(-1).map((c) => c.type), ["callInit"]);
});

test("deploy: different initialised code is refused; --force deploys code only (no init)", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  assert.equal((await s.run(["deploy"])).code, 0);
  writeFileSync(s.wasmPath, fakeWasm("changed"));
  const n = s.chain.mutations().length;
  let r = await s.run(["deploy", "--skip-build"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /different initialised contract/);
  assert.equal(s.chain.mutations().length, n);
  r = await s.run(["deploy", "--skip-build", "--force"]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(s.chain.mutations().slice(n).map((c) => c.type), ["deploy"]);
});

test("deploy: balance, wasm sanity, cargo flags and build failures abort before any transaction", async () => {
  // not enough balance for the code storage (1,000,000 bytes x 1E19 yocto = 10 NEAR + margin)
  let s = mk({ rootBalance: 20 });
  assert.equal((await s.run(["accounts"])).code, 0); // the root keeps about 7.5 NEAR, below the 11 NEAR the big wasm needs
  const bigWasm = join(s.dir, "big.wasm");
  writeFileSync(bigWasm, Buffer.concat([fakeWasm(), Buffer.alloc(1_000_000)]));
  let r = await s.run(["deploy", "--wasm", bigWasm]);
  assert.equal(r.code, 1);
  assert.match(r.text, /needs .* NEAR for the code storage/);
  assert.equal(s.chain.mutations().filter((c) => c.type.startsWith("deploy")).length, 0);

  // not a wasm / built without host imports
  s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const junk = join(s.dir, "junk.wasm");
  writeFileSync(junk, Buffer.from("not wasm at all"));
  r = await s.run(["deploy", "--wasm", junk]);
  assert.equal(r.code, 1);
  assert.match(r.text, /not a WebAssembly module/);
  const noHost = join(s.dir, "nohost.wasm");
  writeFileSync(noHost, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, 2, 3]));
  r = await s.run(["deploy", "--wasm", noHost]);
  assert.equal(r.code, 1);
  assert.match(r.text, /--cfg near/);

  // cargo config lost its flags
  writeFileSync(join(s.dir, "contracts", "caravan", ".cargo", "config.toml"), "[env]\nA = \"1\"\n");
  r = await s.run(["deploy"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /no longer passes `--cfg near`/);
  assert.equal(s.buildCalls.length, 0);

  // build failure
  s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  r = await s.run(["deploy"], { runBuild: () => ({ status: 101 }) });
  assert.equal(r.code, 1);
  assert.match(r.text, /build failed/);
  assert.equal(s.chain.mutations().filter((c) => c.type.startsWith("deploy")).length, 0);
});

test("deploy --dry-run: shows the init arguments, builds nothing, changes nothing", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  const n = s.chain.mutations().length;
  const r = await s.run(["deploy", "--dry-run"]);
  assert.equal(r.code, 0, r.text);
  assert.equal(s.buildCalls.length, 0);
  assert.equal(s.chain.mutations().length, n);
  assert.match(r.text, /would run: cargo build --target wasm32-unknown-unknown --release/);
  assert.match(r.text, /"player_suffix":"\.relayer\.example\.testnet"/);
  assert.match(r.text, /decision: deploy\+init/);
});

test("contract as a sub-account: created by accounts, deployed with the owner key", async () => {
  const s = mk({ env: { CARAVAN_CONTRACT_ID: `contract.${ROOT}` } });
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 0, r.text);
  assert.ok(s.chain.accounts.has(`contract.${ROOT}`));
  assert.equal(s.chain.accounts.get(`contract.${ROOT}`).balance, near(6));
  assert.equal(s.envMap().get("CARAVAN_CONTRACT_ID"), `contract.${ROOT}`);
  assert.equal((await s.run(["keys"])).code, 0);
  assert.ok(s.chain.calls.filter((c) => c.type === "addFunctionCallKey").every((c) => c.contractId === `contract.${ROOT}`));
  const d = await s.run(["deploy"]);
  assert.equal(d.code, 0, d.text);
  assert.equal(s.chain.calls.find((c) => c.type === "deployAndInit").accountId, `contract.${ROOT}`);
  assert.equal((await s.run(["verify"])).code, 0);
});

// ----------------------------------------------------------------------------------------------------- verify

test("verify: read-only; PASS on a consistent deployment, FAIL on drift", async () => {
  const s = mk();
  await fullSetup(s);
  const n = s.chain.mutations().length;
  let r = await s.run(["verify"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /PASS config\.mode: PLAY/);
  assert.match(r.text, /PASS wasm hash matches/);
  assert.match(r.text, /PASS world\.merchants: 4 merchants/);
  assert.match(r.text, /verify: \d+ passed, \d+ warning\(s\), 0 failed/);
  assert.equal(s.chain.mutations().length, n, "verify changes nothing");

  writeFileSync(s.wasmPath, fakeWasm("different"));
  r = await s.run(["verify"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /FAIL wasm hash matches/);
  writeFileSync(s.wasmPath, fakeWasm("built"));

  s.chain.views.get_config = { ...s.chain.views.get_config, paused: true, operator: "someone.testnet" };
  r = await s.run(["verify"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /FAIL config\.paused/);
  assert.match(r.text, /FAIL config\.operator/);
  s.chain.views.get_config = { ...s.chain.views.get_config, paused: false, operator: `operator.${ROOT}` };

  s.chain.accounts.get(`bandar.${ROOT}`).keys = s.chain.accounts.get(`bandar.${ROOT}`).keys.filter((k) => k.kind === "full");
  r = await s.run(["verify"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /FAIL merchant key bandar/);
  assertNoSecrets(s);
});

test("verify: warns about a low relayer, fails when nothing is deployed, --dry-run is offline", async () => {
  const s = mk();
  assert.equal((await s.run(["accounts"])).code, 0);
  let r = await s.run(["verify"]);
  assert.equal(r.code, 1);
  assert.match(r.text, /FAIL contract has code/);
  assert.match(r.text, /FAIL merchant key dasht/);
  const t = mk();
  await fullSetup(t);
  t.chain.accounts.get(`relayer.${ROOT}`).balance = near(1);
  r = await t.run(["verify"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /WARN account relayer\.example\.testnet/);
  const u = mk();
  r = await u.run(["verify", "--dry-run"]);
  assert.equal(r.code, 0);
  assert.equal(u.chainCreated, 0);
  assert.equal(u.chain.calls.length, 0);
});

// -------------------------------------------------------------------------------------------------------- all

test("all --dry-run simulates the whole flow on an empty chain without changing anything", async () => {
  const s = mk();
  const r = await s.run(["all", "--dry-run"]);
  assert.equal(r.code, 0, r.text);
  assert.equal(s.chain.mutations().length, 0);
  assert.equal(s.readEnv(), null);
  assert.equal(s.buildCalls.length, 0);
  const idx = ["== accounts", "== keys", "== deploy", "== verify"].map((h) => r.text.indexOf(h));
  assert.ok(idx.every((i) => i >= 0) && [...idx].sort((a, b) => a - b).join() === idx.join(), "sections in order");
  assert.equal((r.text.match(/would add/g) ?? []).length, 4);
  assert.match(r.text, /all done \(dry run: nothing was changed\)/);
  assertNoSecrets(s);
});

test("all: accounts, keys, deploy, verify in order; the whole run leaks no secret", async () => {
  const s = mk();
  const r = await s.run(["all"]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(callTypes(s), [...Array(7).fill("createSubAccount"), ...Array(4).fill("addFunctionCallKey"), "deployAndInit"]);
  assertNoSecrets(s);
  // and a second `all` is a no-op
  const n = s.chain.mutations().length;
  const r2 = await s.run(["all"]);
  assert.equal(r2.code, 0, r2.text);
  assert.equal(s.chain.mutations().length, n);
  assertNoSecrets(s);
  for (const c of s.execCalls) for (const a of c.args) assert.ok(!looksLikeKeyMaterial(a) && !/FAKESECRET/.test(a), "no key in any child-process argv");
});

// ------------------------------------------------------------------------------------------ redaction layers

test("redaction: Secret never prints, the logger masks leaks, public keys stay visible", () => {
  const sec = new Secret("ed25519:FAKESECRET_LEAKCHECK_xxxxxxxxxxxxxxxx");
  assert.equal(String(sec), "[secret]");
  assert.equal(JSON.stringify({ k: sec }), '{"k":"[secret]"}');
  assert.ok(!require_inspect(sec).includes("LEAKCHECK"));
  assert.ok(!`${sec}`.includes("LEAKCHECK"));
  const lines = [];
  const log = createLogger({ out: (l) => lines.push(l), err: (l) => lines.push(l) });
  log.info(`oops ${sec.reveal()} oops`);
  log.error(`oops ${sec.reveal()}`);
  const realShaped = `ed25519:${"B3c4".repeat(22)}`;
  log.info(`shape ${realShaped}`);
  log.info("public ed25519:FAKEPUBLICRoot stays");
  assert.ok(lines.every((l) => !l.includes("LEAKCHECK") && !l.includes(realShaped)));
  assert.ok(lines[3].includes("ed25519:FAKEPUBLICRoot"));
  const pubLike = `ed25519:${"C5d6".repeat(11)}`;
  assert.equal(redact(pubLike), pubLike, "a 44-character public key is not redacted");
});
function require_inspect(v) { return createRequire(import.meta.url)("node:util").inspect(v, { depth: 5 }); }

// ------------------------------------------------------------------------------------------------ units

test("amounts: exact decimal parsing and formatting", () => {
  assert.equal(parseNear("1.5"), 15n * 10n ** 23n);
  assert.equal(parseNear("0.000000000000000000000001"), 1n);
  assert.throws(() => parseNear("1e3"), /plain decimal/);
  assert.throws(() => parseNear("-1"), /plain decimal/);
  assert.throws(() => parseNear("0"), /greater than zero/);
  assert.equal(formatNear(near(12.5)), "12.5");
  assert.equal(formatNear(near(3)), "3");
  assert.equal(formatNear(1n), "<0.0001");
  assert.equal(formatNear(-near(2)), "-2");
});

test("base58 and code hash match near-api-js and the zero hash", () => {
  assert.equal(base58Encode(Buffer.alloc(32)), NO_CODE_HASH);
  assert.equal(codeHashOf(Buffer.alloc(0)), "GKot5hBsd81kMupNCXHaqbhv3huEbxAFMLnpcX2hniwn");
  let nearApi = null;
  try { nearApi = createRequire(join(REAL_REPO, "apps", "web", "package.json"))("near-api-js"); } catch { /* not installed here */ }
  if (nearApi) {
    for (const b of [Buffer.from("caravan"), Buffer.from([0, 0, 1, 2, 3]), Buffer.alloc(40, 255)]) assert.equal(base58Encode(b), nearApi.baseEncode(b));
  }
});

test("buildConfig: derived names, player id length guard, contract placement", () => {
  const get = (m) => (n) => m[n];
  const c = buildConfig(get({ ROOT_ACCOUNT_ID: "a.testnet" }), {});
  assert.deepEqual(c.accounts.map((x) => x.id), ["owner", "operator", "relayer", "dasht", "madan", "bandar", "shahr"].map((r) => `${r}.a.testnet`));
  assert.equal(c.contractId, "a.testnet");
  assert.ok(c.maxPlayerIdLength <= 64);
  const long = `${"x".repeat(40)}.testnet`; // relayer id = 8 + 1 + 48 = 57 chars: players would exceed 64
  assert.throws(() => buildConfig(get({ ROOT_ACCOUNT_ID: long }), {}), SetupError);
  assert.throws(() => buildConfig(get({ ROOT_ACCOUNT_ID: "a.testnet", CARAVAN_CONTRACT_ID: "relayer.a.testnet" }), {}), /collide/);
});

// -------------------------------------------------------------------------------------------------- env file

test("env file: conflicts, fills, atomic write with restricted permissions", () => {
  const existing = parseEnvText("A=1\nB=\nexport C='3'\n# D=4\n");
  assert.deepEqual([...existing], [["A", "1"], ["B", ""], ["C", "3"]]);
  const plan = planUpdates(existing, [{ name: "A", value: "1" }, { name: "B", value: "2" }, { name: "C", value: "9" }, { name: "E", value: "5" }]);
  assert.deepEqual(plan.changes.map((c) => c.action), ["keep", "fill", "add"], "conflicts are reported separately");
  assert.deepEqual(plan.conflicts, ["C"]);
  assert.equal(planUpdates(existing, [{ name: "C", value: "9" }], { force: true }).changes[0].action, "replace");
  assert.throws(() => planUpdates(existing, [{ name: "X", value: "a b" }]), /not safe/);
  assert.equal(applyWrites("A=1\nB=\n", [{ name: "B", value: "2" }, { name: "N", value: "n" }]), "A=1\nB=2\nN=n\n");
  assert.ok(applyWrites("", [{ name: "N", value: "n" }]).startsWith("# Local secrets"));

  const dir = mkdtempSync(join(REAL_REPO, "scripts", "__tests__", ".tmp-"));
  made.push({ cleanup: () => rmSync(dir, { recursive: true, force: true }) });
  const file = join(dir, ".env.local");
  const execs = [];
  const deps = { fs: nodeFs, platform: process.platform, env: { USERNAME: "tester" }, exec: (c, a) => { execs.push([c, a]); return { status: 0 }; } };
  const res = writeEnvFileAtomic(file, "A=1\n", deps);
  assert.equal(res.restricted, true);
  assert.equal(readFileSync(file, "utf8"), "A=1\n");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  else assert.deepEqual(execs[0][1].slice(1), ["/inheritance:r", "/grant:r", "tester:F"]);
  writeEnvFileAtomic(file, "A=2\n", deps);
  assert.equal(readFileSync(file, "utf8"), "A=2\n");
  assert.deepEqual(readdirSync(dir), [".env.local"]);
  assert.throws(() => writeEnvFileAtomic(file, "x", { ...deps, fs: { ...nodeFs, renameSync: () => { throw Object.assign(new Error("no"), { code: "EPERM" }); } } }), /nothing was changed/);
  assert.equal(readFileSync(file, "utf8"), "A=2\n");
  assert.deepEqual(readdirSync(dir), [".env.local"], "temp file cleaned up after a failure");
});

test(".env.local is git-ignored in this repository and .env.example lists names only", () => {
  const r = spawnSync("git", ["check-ignore", "-q", ".env.local"], { cwd: REAL_REPO });
  assert.equal(r.status, 0, ".env.local must be git-ignored");
  const lines = readFileSync(join(REAL_REPO, ".env.example"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  assert.ok(lines.every((l) => /^[A-Z0-9_]+=$/.test(l)), "names only, no values");
  const names = new Set(lines.map((l) => l.slice(0, -1)));
  for (const n of ["ROOT_ACCOUNT_ID", "ROOT_KEY_FILE", "OWNER_ACCOUNT_ID", "OWNER_PRIVATE_KEY", "FUND_OWNER_NEAR", "FUND_OPERATOR_NEAR", "FUND_RELAYER_NEAR", "FUND_MERCHANT_NEAR", "FUND_CONTRACT_NEAR", "KEY_ALLOWANCE_NEAR",
    "RELAYER_PRIVATE_KEY", "OPERATOR_PRIVATE_KEY", "KEY_DASHT", "KEY_MADAN", "KEY_BANDAR", "KEY_SHAHR", "KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"]) assert.ok(names.has(n), `${n} listed`);
});

// ------------------------------------------------------------------------------------------------- root key

test("root key: file formats, credentials directory, seed phrases and keychain-only are not accepted", () => {
  const dir = mkdtempSync(join(REAL_REPO, "scripts", "__tests__", ".tmp-"));
  made.push({ cleanup: () => rmSync(dir, { recursive: true, force: true }) });
  const warn = () => {};
  const base = { fs: nodeFs, home: dir, network: "testnet", rootId: ROOT, platform: "win32", warn };

  writeFileSync(join(dir, "raw.txt"), `${ROOT_SECRET}\n`);
  let c = loadRootKeyCandidates({ ...base, get: (n) => (n === "ROOT_KEY_FILE" ? join(dir, "raw.txt") : undefined) });
  assert.equal(c.secrets[0].reveal(), ROOT_SECRET);
  assert.ok(!JSON.stringify(c).includes(ROOT_SECRET), "the loader result never serialises the key");

  writeFileSync(join(dir, "seed.json"), JSON.stringify({ account_id: ROOT, master_seed_phrase: "one two three four five six seven eight nine ten eleven twelve" }));
  assert.throws(() => loadRootKeyCandidates({ ...base, get: (n) => (n === "ROOT_KEY_FILE" ? join(dir, "seed.json") : undefined) }), (e) => /does not contain a private key/.test(e.message) && !e.message.includes("one two three"));
  assert.throws(() => loadRootKeyCandidates({ ...base, get: (n) => (n === "ROOT_KEY_FILE" ? join(dir, "missing.json") : undefined) }), /does not exist/);

  assert.throws(() => loadRootKeyCandidates({ ...base, get: () => undefined }), /no usable root key found/);
  mkdirSync(join(dir, ".near-credentials", "testnet", ROOT), { recursive: true });
  writeFileSync(join(dir, ".near-credentials", "testnet", `${ROOT}.json`), JSON.stringify({ account_id: ROOT, public_key: ROOT_PUBLIC, private_key: ROOT_SECRET }));
  writeFileSync(join(dir, ".near-credentials", "testnet", ROOT, "ed25519_FAKE.json"), JSON.stringify({ public_key: "x", private_key: "ed25519:FAKESECRETAnotherKey" + "x".repeat(30) }));
  c = loadRootKeyCandidates({ ...base, get: () => undefined });
  assert.equal(c.source, "credentials directory");
  assert.equal(c.secrets.length, 2);
  assert.equal(parseKeyFileText("not json"), null);
  assert.match(randomHexSecret().reveal(), /^[0-9a-f]{64}$/);
});

test("the root key must come from a file: a fake chain run never saw it in argv or logs", async () => {
  const s = mk();
  const r = await s.run(["accounts"]);
  assert.equal(r.code, 0, r.text);
  assert.ok(!JSON.stringify(s.execCalls).includes(ROOT_SECRET));
  assert.ok(!s.all().includes(ROOT_SECRET));
  const none = mk({ env: { ROOT_KEY_FILE: "" } });
  const r2 = await none.run(["accounts"]);
  assert.equal(r2.code, 2, r2.text);
  assert.match(r2.text, /no usable root key found/);
  assert.equal(none.chain.mutations().length, 0);
});

test("main() reports unexpected failures without a stack or secrets", async () => {
  const s = mk();
  new Secret(ROOT_SECRET); // as in a real run, the loaded root key is a registered Secret
  const r = await s.run(["verify"], { createChain: () => { throw new Error(`boom ${ROOT_SECRET}`); }, redact: true });
  assert.equal(r.code, 1);
  assert.match(r.text, /unexpected failure: boom/);
  assert.ok(!r.text.includes(ROOT_SECRET));
});

