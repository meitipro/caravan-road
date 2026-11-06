// setup-steps.mjs: the subcommands of scripts/setup-testnet.mjs (plan, accounts, keys, deploy, verify, all).
//
// Everything here works against injected dependencies (ctx.chain, ctx.crypto, ctx.fs, ctx.exec, ctx.runBuild), so the
// test suite drives it with an in-memory fake and the real script wires near-api-js in (near-chain.mjs).
// Rules every step follows:
//  - key material is a `Secret` and is only revealed inside chain calls and the env-file writer, never logged;
//  - the env file is written BEFORE the first on-chain change that depends on a new key (a crash can strand an
//    unused account, never a key);
//  - every mutating step first looks at the chain and skips what already exists, so re-running is safe;
//  - balances are checked before transfers; a low root balance aborts with the numbers and what to do.

import { join, resolve } from "node:path";
import {
  CITIES, GAS_RESERVE_YOCTO, MERCHANT_METHODS, NO_CODE_HASH, RELAYER_LOW_YOCTO, SHAHR_EXTRA_METHODS, STORAGE_YOCTO_PER_BYTE,
  SetupError, Secret, codeHashOf, formatNear,
} from "./setup-core.mjs";
import {
  applyWrites, assertEnvFileIgnored, parseEnvText, planUpdates, readEnvText, writeEnvFileAtomic,
} from "./setup-env.mjs";
import { loadRootKeyCandidates, randomHexSecret } from "./setup-keys.mjs";

const fmt = (y) => `${formatNear(y)} NEAR`;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
const WASM_REL = join("contracts", "caravan", "target", "wasm32-unknown-unknown", "release", "caravan.wasm");
const CONTRACT_DIR_REL = join("contracts", "caravan");
const MAX_WASM_BYTES = 4 * 1024 * 1024;
const DEPLOY_MARGIN_YOCTO = 10n ** 24n; // 1 NEAR above the code storage, for the state `init` creates and early players

// ------------------------------------------------------------------------------------------------- context

/** Build the mutable per-run context. `deps` carries every side-effecting dependency (see setup-testnet.mjs). */
export function createContext({ cfg, flags, deps, envFilePath, envText }) {
  const ctx = {
    cfg, flags, dryRun: Boolean(flags.dryRun) || deps.forceDryRun === true, ...deps,
    envFilePath, envText,
    envLabel: deps.relativeEnvLabel ?? envFilePath,
    sim: { accounts: new Map(), generated: new Map() },
    fileMap() { return parseEnvText(ctx.envText); },
    get(name) {
      const p = ctx.processEnv[name];
      if (p && p.trim() !== "") return p.trim();
      const f = ctx.fileMap().get(name);
      return f ? f : undefined;
    },
    /** @returns {Secret | null} */
    secretOf(name) {
      const v = ctx.get(name);
      if (v) return new Secret(v);
      return ctx.dryRun ? ctx.sim.generated.get(name) ?? null : null;
    },
    writeEnv(writes) {
      const text = applyWrites(ctx.envText, writes);
      const r = writeEnvFileAtomic(ctx.envFilePath, text, { fs: ctx.fs, exec: ctx.exec, platform: ctx.platform, env: ctx.processEnv });
      ctx.envText = text;
      if (!r.restricted) ctx.log.warn(`could not restrict the permissions of ${ctx.envLabel}; protect it yourself (only your user should read it)`);
    },
    /** Probe: can the env file be (re)written atomically? Used before a rotation touches the chain. */
    assertEnvWritable() {
      writeEnvFileAtomic(ctx.envFilePath, ctx.envText === "" ? "# env\n" : ctx.envText, { fs: ctx.fs, exec: ctx.exec, platform: ctx.platform, env: ctx.processEnv });
    },
  };
  return ctx;
}

const title = (ctx, text) => ctx.log.info(`\n== ${text}${ctx.dryRun ? " [DRY RUN: nothing is changed, no file is written]" : ""}`);

async function accountState(ctx, id) {
  const s = ctx.sim.accounts.get(id);
  if (s) return { total: s.fund, available: s.fund, storageUsage: 0, codeHash: NO_CODE_HASH, simulated: true };
  return ctx.chain.getAccount(id);
}
async function keysOf(ctx, id) {
  const s = ctx.sim.accounts.get(id);
  return s ? s.keys : ctx.chain.listKeys(id);
}

/** Find which of the root-key candidates is a full-access key of the root account on chain. */
async function resolveRootKey(ctx) {
  const { cfg } = ctx;
  const found = loadRootKeyCandidates({
    get: ctx.get, fs: ctx.fs, home: ctx.home, network: cfg.network, rootId: cfg.root, platform: ctx.platform, warn: (m) => ctx.log.warn(m),
  });
  const keys = await ctx.chain.listKeys(cfg.root);
  for (const secret of found.secrets) {
    const pk = ctx.crypto.publicKeyOf(secret);
    if (keys.some((k) => k.publicKey === pk && k.kind === "full")) {
      ctx.log.info(`root key: read from ${found.source} (${found.path}); public key ${pk} is a full-access key of ${cfg.root}`);
      return secret;
    }
  }
  throw new SetupError(`the key read from ${found.source} is not a full-access key of ${cfg.root}. Check ROOT_KEY_FILE and ROOT_ACCOUNT_ID.`, 1);
}

// ------------------------------------------------------------------------------------------------- init args

/** The init arguments come from scripts/init-args.mjs (single source of truth); it validates the contract's own rules. */
export function buildInitArgs(ctx) {
  const { cfg } = ctx;
  const a = cfg.byRole;
  const r = ctx.exec(process.execPath, [
    ctx.initArgsPath, "--mode", cfg.mode, "--owner", a.owner.id, "--operator", a.operator.id,
    "--dasht", a.dasht.id, "--madan", a.madan.id, "--bandar", a.bandar.id, "--shahr", a.shahr.id,
    "--relayer", a.relayer.id, "--max-players", cfg.maxPlayers, "--operator-daily-cap", cfg.operatorDailyCap,
  ], {});
  if (r.status !== 0) throw new SetupError(`scripts/init-args.mjs rejected the arguments: ${String(r.stderr).trim()}`, 2);
  try { return JSON.parse(String(r.stdout)); }
  catch { throw new SetupError("scripts/init-args.mjs did not print valid JSON", 1); }
}

// ------------------------------------------------------------------------------------------------- plan

export async function cmdPlan(ctx) {
  const { cfg, log } = ctx;
  log.info("Caravan Road testnet setup plan (offline: no network call, nothing is created, nothing is written)");
  log.info(`network:  ${cfg.network}   rpc: ${cfg.rpcUrl}`);
  log.info(`root:     ${cfg.root}   (created by you; its key is read from ROOT_KEY_FILE or ~/.near-credentials/${cfg.network}/)`);
  log.info(`contract: ${cfg.contractId}   (${cfg.contractIsRoot ? "the root account itself" : "a sub-account of the root, created by `accounts`"})`);
  log.info(`env file: ${ctx.envLabel}   (${ctx.envText === "" ? "does not exist yet" : "exists"})`);
  log.info("\naccounts (names derived from ROOT_ACCOUNT_ID):");
  for (const a of cfg.accounts) {
    const keyNote = a.kind === "merchant"
      ? `${a.keyVar} = function-call key (${a.methods.join(", ")}); full access: OWNER key`
      : a.kind === "contract" ? "full access: OWNER key (signs the deploy)" : `${a.keyVar} = full-access key`;
    log.info(`  ${a.role.padEnd(9)} ${a.id.padEnd(40)} fund ${fmt(a.fund).padEnd(12)} ${keyNote}`);
  }
  if (cfg.contractIsRoot) log.info(`  (the contract lives on the root: keep about ${fmt(cfg.funds.contract)} of it for code storage and game state)`);
  const creating = cfg.accounts.length;
  const total = cfg.accounts.reduce((s, a) => s + a.fund, 0n) + GAS_RESERVE_YOCTO * BigInt(creating) + (cfg.contractIsRoot ? cfg.funds.contract : 0n);
  log.info(`\nroot balance needed if nothing exists yet: ${fmt(total)} (transfers + gas reserve${cfg.contractIsRoot ? " + contract reserve" : ""}); \`accounts\` aborts if the root has less`);
  log.info("\nlocal secrets (generated on this machine; written only to the env file, never printed):");
  const secretNames = ["OWNER_PRIVATE_KEY", "OPERATOR_PRIVATE_KEY", "RELAYER_PRIVATE_KEY", ...cfg.merchants.map((m) => m.keyVar), "KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"];
  for (const n of secretNames) log.info(`  ${n.padEnd(22)} ${ctx.get(n) ? "already set (kept, never overwritten)" : "will be generated"}`);
  log.info("non-secret ids written to the env file: " + cfg.envIds.map((e) => e.name).join(", "));
  log.info(`\nkeys:   function-call keys on ${cfg.merchants.map((m) => m.role).join(", ")}; receiver ${cfg.contractId}; allowance ${fmt(cfg.allowance)} each`);
  log.info("        methods: set_policy, ship (shahr also world_tick: the worker sends world_tick from that key, docs/WORKER.md)");
  log.info(`deploy: cargo build --target wasm32-unknown-unknown --release (in ${CONTRACT_DIR_REL}; flags from .cargo/config.toml), then ONE transaction: DeployContract + init`);
  try { log.info(`        init args (from scripts/init-args.mjs): ${JSON.stringify(buildInitArgs(ctx))}`); }
  catch (e) { log.warn(`could not build the init arguments: ${e.message}`); }
  log.info("verify: get_config, get_world, wasm hash, merchant keys (read-only)");
  log.info("\norder:  accounts -> keys -> deploy -> verify   (or: all)");
  log.info("Nothing above has been done. Add --dry-run to any command to see what it would do against the live state (reads only).");
  return 0;
}

// ----------------------------------------------------------------------------------------------- accounts

export async function cmdAccounts(ctx) {
  const { cfg, log } = ctx;
  title(ctx, `accounts: sub-accounts of ${cfg.root}`);

  // 1. Refuse to overwrite differing non-secret values before any chain access.
  const idPlan = planUpdates(ctx.fileMap(), cfg.envIds, { force: ctx.flags.force });
  if (idPlan.conflicts.length > 0) {
    throw new SetupError(
      `refusing to overwrite existing values in ${ctx.envLabel}: ${idPlan.conflicts.join(", ")}\n` +
      "These names already hold a different value. Fix the file by hand, or pass --force to replace them.", 1);
  }
  // 2. The env file must be git-ignored before it receives secrets.
  try { assertEnvFileIgnored(ctx.envFilePath, { exec: ctx.exec, repoRoot: ctx.repoRoot, fs: ctx.fs }); log.info(`env file ${ctx.envLabel}: git-ignored`); }
  catch (e) { if (!ctx.dryRun) throw e; log.warn(e.message); }

  // 3. Root preflight.
  const root = await ctx.chain.getAccount(cfg.root);
  if (!root) throw new SetupError(`root account ${cfg.root} does not exist on ${cfg.network}. Create it first (docs/DEPLOY.md, step 1), then run again.`, 1);
  log.info(`root ${cfg.root}: balance ${fmt(root.total)}, available ${fmt(root.available)}`);
  let rootSecret = null;
  if (!ctx.dryRun) rootSecret = await resolveRootKey(ctx);

  // 4. Stage key material (in memory) and look at the chain.
  const staged = new Map(); // variable name -> Secret generated now
  const stage = (name) => {
    if (!staged.has(name)) {
      const kp = ctx.crypto.generateKeyPair();
      staged.set(name, kp.secret);
      if (ctx.dryRun) ctx.sim.generated.set(name, kp.secret);
    }
    return staged.get(name);
  };
  const secretFor = (name) => ctx.secretOf(name) ?? staged.get(name) ?? stage(name);

  const rows = [];
  for (const a of cfg.accounts) {
    const state = await accountState(ctx, a.id);
    if (state) {
      const adminSecret = ctx.secretOf(a.adminVar);
      if (!adminSecret) {
        throw new SetupError(
          `${a.id} already exists but ${a.adminVar} is not set in ${ctx.envLabel}. This script cannot recover a key it does not have: ` +
          "restore the key into that variable, or delete the account and run again.", 1);
      }
      const pk = ctx.crypto.publicKeyOf(adminSecret);
      const keys = await keysOf(ctx, a.id);
      if (!keys.some((k) => k.publicKey === pk && k.kind === "full")) {
        throw new SetupError(`${a.id} exists, but the key in ${a.adminVar} (public key ${pk}) is not one of its full-access keys. Not touching it.`, 1);
      }
      if (a.kind === "merchant") secretFor(a.keyVar); // the function-call key pair is generated even if the account exists
      rows.push({ a, action: "exists" });
    } else {
      secretFor(a.adminVar);
      if (a.kind === "merchant") secretFor(a.keyVar);
      rows.push({ a, action: "create" });
    }
  }
  for (const name of ["KEY_ENC_SECRET", "AUTH_SECRET", "CRON_SECRET"]) {
    if (!ctx.secretOf(name) && !staged.has(name)) {
      const s = randomHexSecret();
      staged.set(name, s);
      if (ctx.dryRun) ctx.sim.generated.set(name, s);
    }
  }

  // 5. Balance check (before any write or transfer).
  const creating = rows.filter((r) => r.action === "create");
  const contractReserve = cfg.contractIsRoot && root.codeHash === NO_CODE_HASH ? cfg.funds.contract : 0n;
  const needed = creating.reduce((s, r) => s + r.a.fund + GAS_RESERVE_YOCTO, 0n) + contractReserve;
  for (const { a, action } of rows) {
    log.info(`  ${action === "create" ? (ctx.dryRun ? "would create" : "will create ") : "exists      "} ${a.id.padEnd(40)} ${action === "create" ? `fund ${fmt(a.fund)}` : "skipped"}`);
  }
  if (contractReserve > 0n) log.info(`  contract reserve kept on the root for code storage and state: ${fmt(contractReserve)}`);
  log.info(`root balance needed: ${fmt(needed)}   available: ${fmt(root.available)}`);
  if (root.available < needed) {
    throw new SetupError(
      `the root balance is too low: ${cfg.root} has ${fmt(root.available)} available but this run needs ${fmt(needed)} (short by ${fmt(needed - root.available)}).\n` +
      "Fund the root account from the testnet faucet (or lower FUND_*_NEAR) and run again. Nothing was created and no file was written.", 1);
  }

  // 6. Plan the env writes.
  const secretWrites = [...staged].map(([name, s]) => ({ name, value: s.reveal() }));
  const writes = [...idPlan.toWrite, ...secretWrites];
  const idChanges = idPlan.changes.filter((c) => c.action !== "keep");
  log.info(`env file ${ctx.envLabel}: ${writes.length === 0 ? "nothing to write" : `${ctx.dryRun ? "would write" : "writing"} ${writes.length} value(s): ${writes.map((w) => w.name).join(", ")}`}`);
  if (idChanges.some((c) => c.action === "replace")) log.warn(`--force: replacing existing value(s) of ${idChanges.filter((c) => c.action === "replace").map((c) => c.name).join(", ")}`);

  if (ctx.dryRun) {
    for (const { a } of creating) {
      ctx.sim.accounts.set(a.id, { fund: a.fund, keys: [{ publicKey: ctx.crypto.publicKeyOf(secretFor(a.adminVar)), kind: "full" }] });
    }
    log.info(`dry run done: ${creating.length} account(s) would be created, ${rows.length - creating.length} already exist.`);
    return 0;
  }

  // 7. Persist keys first, then change the chain.
  if (writes.length > 0) ctx.writeEnv(writes);
  let spent = 0;
  for (const { a } of creating) {
    const live = await ctx.chain.getAccount(cfg.root);
    const need = a.fund + GAS_RESERVE_YOCTO;
    if (!live || live.available < need) {
      throw new SetupError(
        `the root balance dropped below what is needed for ${a.id}: available ${live ? fmt(live.available) : "unknown"}, needed ${fmt(need)}. ` +
        `${spent} account(s) were created in this run; the keys are saved in ${ctx.envLabel}, so fund the root and run again.`, 1);
    }
    const pk = ctx.crypto.publicKeyOf(secretFor(a.adminVar));
    const r = await ctx.chain.createSubAccount({ parentId: cfg.root, signer: rootSecret, newAccountId: a.id, publicKey: pk, amount: a.fund });
    spent++;
    log.info(`created ${a.id} with ${fmt(a.fund)}; full-access public key ${pk}; tx ${r.txHash}`);
  }
  log.info(`accounts done: ${creating.length} created, ${rows.length - creating.length} already existed.`);
  log.info(`secrets are in ${ctx.envLabel} (names only here): ${secretWrites.map((w) => w.name).join(", ") || "none new"}`);
  log.info("next: node scripts/setup-testnet.mjs keys");
  return 0;
}

// -------------------------------------------------------------------------------------------------- keys

export async function cmdKeys(ctx) {
  if (ctx.flags.rotate) return cmdRotate(ctx);
  const { cfg, log } = ctx;
  title(ctx, `keys: function-call keys on the merchants, receiver ${cfg.contractId}`);
  const ownerSecret = ctx.secretOf("OWNER_PRIVATE_KEY");
  if (!ownerSecret) throw new SetupError(`OWNER_PRIVATE_KEY is not set in ${ctx.envLabel}. Run the accounts step first.`, 1);
  const ownerPk = ctx.crypto.publicKeyOf(ownerSecret);

  const plan = [];
  for (const m of cfg.merchants) {
    const fc = ctx.secretOf(m.keyVar);
    if (!fc) throw new SetupError(`${m.keyVar} is not set in ${ctx.envLabel}. Run the accounts step first.`, 1);
    const pk = ctx.crypto.publicKeyOf(fc);
    const state = await accountState(ctx, m.id);
    if (!state) throw new SetupError(`${m.id} does not exist. Run the accounts step first.`, 1);
    if (state.available < GAS_RESERVE_YOCTO) throw new SetupError(`${m.id} has only ${fmt(state.available)} available: not enough to pay for the AddKey transaction.`, 1);
    const keys = await keysOf(ctx, m.id);
    if (!keys.some((k) => k.publicKey === ownerPk && k.kind === "full")) {
      throw new SetupError(`the OWNER key (public key ${ownerPk}) is not a full-access key of ${m.id}, so it cannot add keys there.`, 1);
    }
    const ex = keys.find((k) => k.publicKey === pk);
    let action = "add";
    if (ex) {
      const ok = ex.kind === "function-call" && ex.receiverId === cfg.contractId && sameSet(ex.methodNames ?? [], m.methods);
      action = ok ? "skip" : ctx.flags.force ? "replace" : "mismatch";
    }
    plan.push({ m, pk, action, existing: ex });
  }
  for (const p of plan) {
    const verb = { add: ctx.dryRun ? "would add" : "will add", skip: "present", replace: ctx.dryRun ? "would replace" : "will replace", mismatch: "MISMATCH" }[p.action];
    log.info(`  ${verb.padEnd(12)} ${p.m.id.padEnd(40)} key ${p.pk}  methods ${p.m.methods.join(",")}  allowance ${fmt(cfg.allowance)}`);
  }
  const bad = plan.filter((p) => p.action === "mismatch");
  if (bad.length > 0) {
    throw new SetupError(
      `the key already on ${bad.map((p) => p.m.id).join(", ")} has a different receiver or method list than expected (${cfg.contractId}). ` +
      "Pass --force to replace it (the key is deleted and added again), or use --rotate.", 1);
  }
  if (ctx.dryRun) {
    for (const p of plan) {
      if (p.action === "add") ctx.sim.accounts.get(p.m.id)?.keys.push({ publicKey: p.pk, kind: "function-call", receiverId: cfg.contractId, methodNames: p.m.methods });
    }
    log.info(`dry run done: ${plan.filter((p) => p.action !== "skip").length} key(s) would be added.`);
    return 0;
  }
  let n = 0;
  for (const p of plan) {
    if (p.action === "skip") continue;
    if (p.action === "replace") {
      const d = await ctx.chain.deleteKey({ accountId: p.m.id, signer: ownerSecret, publicKey: p.pk });
      log.info(`deleted mismatching key ${p.pk} on ${p.m.id}; tx ${d.txHash}`);
    }
    const r = await ctx.chain.addFunctionCallKey({
      accountId: p.m.id, signer: ownerSecret, publicKey: p.pk, contractId: cfg.contractId, methodNames: p.m.methods, allowance: cfg.allowance,
    });
    n++;
    log.info(`added function-call key ${p.pk} to ${p.m.id}; tx ${r.txHash}`);
  }
  log.info(`keys done: ${n} added, ${plan.length - n} already present. The allowance pays gas for the key's calls and the key stops working when it is used up: \`verify\` shows what is left.`);
  log.info(`next: copy ${cfg.merchants.map((m) => m.keyVar).join(", ")} into the worker host's environment (see docs/DEPLOY.md).`);
  return 0;
}

const ROTATABLE = ["dasht", "madan", "bandar", "shahr", "relayer", "operator"];

/**
 * Rotation order (safe at every point): add the new key on chain -> save it in the env file -> delete the old key.
 * If saving fails the old key still works and the new key is an unused extra key on the account.
 */
export async function cmdRotate(ctx) {
  const { cfg, log } = ctx;
  const roles = String(ctx.flags.rotate).split(",").map((s) => s.trim()).filter(Boolean);
  if (roles.length === 0 || roles.some((r) => !ROTATABLE.includes(r))) {
    throw new SetupError(`--rotate takes a comma list of: ${ROTATABLE.join(", ")}`, 2);
  }
  title(ctx, `keys --rotate ${roles.join(",")}`);
  const ownerSecret = ctx.secretOf("OWNER_PRIVATE_KEY");
  for (const role of roles) {
    const a = cfg.byRole[role];
    const old = ctx.secretOf(a.keyVar);
    if (!old) throw new SetupError(`${a.keyVar} is not set in ${ctx.envLabel}; nothing to rotate.`, 1);
    const oldPk = ctx.crypto.publicKeyOf(old);
    const state = await accountState(ctx, a.id);
    if (!state) throw new SetupError(`${a.id} does not exist.`, 1);
    if (state.available < GAS_RESERVE_YOCTO) throw new SetupError(`${a.id} has only ${fmt(state.available)} available: not enough to pay for the transactions.`, 1);
    const keys = await keysOf(ctx, a.id);
    if (!keys.some((k) => k.publicKey === oldPk)) throw new SetupError(`the key in ${a.keyVar} (public key ${oldPk}) is not on ${a.id}; refusing to rotate blindly.`, 1);
    let signer = old;
    if (a.kind === "merchant") {
      if (!ownerSecret) throw new SetupError(`OWNER_PRIVATE_KEY is not set in ${ctx.envLabel}; it signs merchant key changes.`, 1);
      const ownerPk = ctx.crypto.publicKeyOf(ownerSecret);
      if (!keys.some((k) => k.publicKey === ownerPk && k.kind === "full")) throw new SetupError(`the OWNER key is not a full-access key of ${a.id}.`, 1);
      signer = ownerSecret;
    }
    log.info(`  ${ctx.dryRun ? "would rotate" : "rotating    "} ${a.keyVar} on ${a.id}: ${a.kind === "merchant" ? "new function-call key" : "new full-access key"}; old public key ${oldPk}`);
    if (ctx.dryRun) continue;

    ctx.assertEnvWritable(); // before the chain changes: a rotation must never end with an unsaved key
    const kp = ctx.crypto.generateKeyPair();
    const add = a.kind === "merchant"
      ? await ctx.chain.addFunctionCallKey({ accountId: a.id, signer, publicKey: kp.publicKey, contractId: cfg.contractId, methodNames: a.methods, allowance: cfg.allowance })
      : await ctx.chain.addFullAccessKey({ accountId: a.id, signer, publicKey: kp.publicKey });
    log.info(`    added new key ${kp.publicKey}; tx ${add.txHash}`);
    try { ctx.writeEnv([{ name: a.keyVar, value: kp.secret.reveal() }]); }
    catch (e) {
      throw new SetupError(
        `the new key (public key ${kp.publicKey}) was added to ${a.id} but could not be saved to ${ctx.envLabel}: ${e.message}\n` +
        "The OLD key is still active and still in the file. The new key is an unused extra key on the account: run the rotation again after fixing the file.", 1);
    }
    log.info(`    saved the new ${a.keyVar} in ${ctx.envLabel}`);
    const del = await ctx.chain.deleteKey({ accountId: a.id, signer: a.kind === "merchant" ? ownerSecret : kp.secret, publicKey: oldPk });
    log.info(`    deleted old key ${oldPk}; tx ${del.txHash}`);
    log.info(`    now update ${a.keyVar} in the host environment that uses it and redeploy/restart that service.`);
  }
  if (ctx.dryRun) log.info("dry run done: nothing was rotated.");
  return 0;
}

// ------------------------------------------------------------------------------------------------- deploy

export function validateWasm(bytes) {
  if (bytes.length === 0) throw new SetupError("the wasm file is empty", 1);
  if (bytes.length > MAX_WASM_BYTES) throw new SetupError(`the wasm is ${bytes.length} bytes, above the ${MAX_WASM_BYTES} byte sanity limit`, 1);
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new SetupError("the file is not a WebAssembly module", 1);
  // near-sdk compiled WITHOUT `--cfg near` (DECISIONS D26) has no host-function imports: refuse to deploy it.
  const b = Buffer.from(bytes);
  if (!b.includes("storage_write") || !b.includes("predecessor_account_id")) {
    throw new SetupError("the wasm does not import the NEAR host functions (storage_write, predecessor_account_id). It was probably built without `--cfg near` (contracts/caravan/DECISIONS.md D26). Rebuild with the repository's .cargo/config.toml.", 1);
  }
}

function checkCargoConfig(ctx) {
  let text;
  try { text = ctx.fs.readFileSync(join(ctx.repoRoot, CONTRACT_DIR_REL, ".cargo", "config.toml"), "utf8"); }
  catch { throw new SetupError("contracts/caravan/.cargo/config.toml is missing; it carries the wasm build flags (`--cfg near`).", 1); }
  if (!/rustflags\s*=\s*\[[^\]]*"--cfg"\s*,\s*"near"/.test(text)) {
    throw new SetupError("contracts/caravan/.cargo/config.toml no longer passes `--cfg near` for wasm32-unknown-unknown; refusing to build a contract that cannot be deployed (D26).", 1);
  }
}

async function viewConfig(ctx) {
  try { return await ctx.chain.view({ contractId: ctx.cfg.contractId, method: "get_config", args: {} }); }
  catch { return null; }
}

export async function cmdDeploy(ctx) {
  const { cfg, log } = ctx;
  title(ctx, `deploy: ${cfg.contractId}`);
  const initArgs = buildInitArgs(ctx);
  log.info(`init args (scripts/init-args.mjs): ${JSON.stringify(initArgs)}`);

  const wasmPath = ctx.flags.wasm ? resolve(ctx.flags.wasm) : join(ctx.repoRoot, WASM_REL);
  const buildArgs = ["build", "--target", "wasm32-unknown-unknown", "--release"];
  if (!ctx.flags.wasm && !ctx.flags.skipBuild) {
    checkCargoConfig(ctx);
    if (ctx.dryRun) log.info(`would run: cargo ${buildArgs.join(" ")}   (in ${CONTRACT_DIR_REL}; flags from .cargo/config.toml)`);
    else {
      log.info(`building: cargo ${buildArgs.join(" ")}   (in ${CONTRACT_DIR_REL})`);
      const r = ctx.runBuild({ cwd: join(ctx.repoRoot, CONTRACT_DIR_REL), command: "cargo", args: buildArgs });
      if (r.status !== 0) throw new SetupError("the contract build failed (see the cargo output above). Nothing was deployed.", 1);
    }
  }
  let wasm = null;
  try { wasm = ctx.fs.readFileSync(wasmPath); } catch { /* handled below */ }
  if (!wasm) {
    if (ctx.dryRun) log.info(`wasm: ${wasmPath} does not exist yet (the build would create it)`);
    else throw new SetupError(`wasm not found at ${wasmPath}. Build it first or pass --wasm <path>.`, 1);
  }
  let localHash = null;
  if (wasm) {
    validateWasm(wasm);
    localHash = codeHashOf(wasm);
    log.info(`wasm: ${wasm.length} bytes, code hash ${localHash}`);
  }

  const state = await accountState(ctx, cfg.contractId);
  if (!state) throw new SetupError(`contract account ${cfg.contractId} does not exist. Run the accounts step first.`, 1);
  const hasCode = state.codeHash !== NO_CODE_HASH;
  const config = state.simulated ? null : await viewConfig(ctx);
  const initialised = config !== null;

  let action;
  if (hasCode && localHash && state.codeHash === localHash) action = initialised ? "skip" : "init-only";
  else if (hasCode && initialised) action = ctx.flags.force ? "upgrade" : "refuse";
  else action = "deploy+init";
  if (!localHash && action !== "refuse") action = hasCode ? "unknown" : "deploy+init";
  log.info(`contract account ${cfg.contractId}: balance ${fmt(state.total)}, available ${fmt(state.available)}, code ${hasCode ? state.codeHash : "none"}${initialised ? ", initialised" : ""}`);

  if (action === "refuse") {
    throw new SetupError(
      `${cfg.contractId} already runs a different initialised contract (on-chain hash ${state.codeHash}, local ${localHash}). ` +
      "Replacing code over live state is not done automatically: pass --force to deploy the new code WITHOUT calling init (no state migration is performed).", 1);
  }
  if (action === "deploy+init" && wasm) {
    const needed = BigInt(wasm.length) * STORAGE_YOCTO_PER_BYTE + DEPLOY_MARGIN_YOCTO;
    log.info(`balance needed: ${fmt(needed)} (${wasm.length} bytes x 1E19 yoctoNEAR + ${fmt(DEPLOY_MARGIN_YOCTO)} for state)   available: ${fmt(state.available)}`);
    if (state.available < needed) {
      throw new SetupError(
        `the contract account ${cfg.contractId} has ${fmt(state.available)} available but needs ${fmt(needed)} for the code storage (short by ${fmt(needed - state.available)}). ` +
        `Fund it from the root account or the faucet and run again. Nothing was deployed.`, 1);
    }
  }
  const w = ctx.dryRun ? "would" : "will";
  const verb = { skip: "nothing to do: this exact code is already deployed and initialised", "init-only": `the code is already deployed but init was not called: ${w} call init only`, upgrade: `${w} deploy the new code only (--force), no init`, "deploy+init": `${w} deploy and call init in ONE transaction (atomic: if init fails the deploy is rolled back)`, unknown: `${w} deploy` }[action];
  log.info(`decision: ${action} (${verb})`);
  if (ctx.dryRun || action === "skip") { if (action === "skip") log.info("deploy done: already deployed and initialised."); return 0; }

  const signer = cfg.contractIsRoot ? await resolveRootKey(ctx) : ctx.secretOf("OWNER_PRIVATE_KEY");
  if (!signer) throw new SetupError(`OWNER_PRIVATE_KEY is not set in ${ctx.envLabel}; it signs for ${cfg.contractId}.`, 1);
  if (!cfg.contractIsRoot) {
    const pk = ctx.crypto.publicKeyOf(signer);
    const keys = await ctx.chain.listKeys(cfg.contractId);
    if (!keys.some((k) => k.publicKey === pk && k.kind === "full")) throw new SetupError(`the OWNER key is not a full-access key of ${cfg.contractId}.`, 1);
  }
  let r;
  if (action === "deploy+init") r = await ctx.chain.deployAndInit({ accountId: cfg.contractId, signer, code: wasm, initArgs });
  else if (action === "init-only") r = await ctx.chain.callInit({ accountId: cfg.contractId, signer, initArgs });
  else r = await ctx.chain.deploy({ accountId: cfg.contractId, signer, code: wasm });
  log.info(`${action === "deploy+init" ? "deployed and initialised" : action === "init-only" ? "initialised" : "upgraded code of"} ${cfg.contractId}; tx ${r.txHash}`);
  const after = await viewConfig(ctx);
  if (after) log.info(`get_config: mode ${after.mode}, paused ${after.paused}, owner ${after.owner}, operator ${after.operator}, player_suffix ${after.player_suffix}, max_players ${after.max_players}, operator_daily_cap ${after.operator_daily_cap}`);
  else log.warn("get_config could not be read right after the transaction; run `verify`.");
  log.info("next: node scripts/setup-testnet.mjs verify");
  return 0;
}

// -------------------------------------------------------------------------------------------------- verify

export async function cmdVerify(ctx) {
  const { cfg, log } = ctx;
  title(ctx, `verify: ${cfg.contractId}`);
  if (ctx.dryRun) {
    log.info("would run these read-only checks:");
    for (const t of ["root and role accounts exist (balances; relayer above the 2 NEAR cron alert)", "merchant function-call keys: receiver, methods, remaining allowance",
      "contract has code and its hash equals the local wasm", "get_config: mode, paused, owner, operator, merchants, player_suffix", "get_world: four merchants, tick"]) log.info(`  - ${t}`);
    return 0;
  }
  const checks = [];
  const add = (status, name, detail = "") => { checks.push({ status, name, detail }); log.info(`  ${status.padEnd(4)} ${name}${detail ? `: ${detail}` : ""}`); };

  for (const id of [cfg.root, ...cfg.accounts.map((a) => a.id)].filter((v, i, arr) => arr.indexOf(v) === i)) {
    const s = await ctx.chain.getAccount(id);
    if (!s) { add("FAIL", `account ${id} exists`, "not found"); continue; }
    const low = id === cfg.byRole.relayer.id && s.available < RELAYER_LOW_YOCTO;
    add(low ? "WARN" : "PASS", `account ${id}`, `available ${fmt(s.available)}${low ? " (below the 2 NEAR alert threshold of /api/cron/health)" : ""}`);
  }
  for (const m of cfg.merchants) {
    const keys = await ctx.chain.listKeys(m.id);
    const fc = ctx.secretOf(m.keyVar);
    const wanted = fc ? ctx.crypto.publicKeyOf(fc) : null;
    const ex = wanted ? keys.find((k) => k.publicKey === wanted) : keys.find((k) => k.kind === "function-call" && k.receiverId === cfg.contractId && sameSet(k.methodNames ?? [], m.methods));
    if (!ex) add("FAIL", `merchant key ${m.role}`, wanted ? `${m.keyVar} is not a key of ${m.id}` : "no function-call key for the contract found");
    else if (ex.kind !== "function-call" || ex.receiverId !== cfg.contractId || !sameSet(ex.methodNames ?? [], m.methods)) add("FAIL", `merchant key ${m.role}`, "wrong receiver or methods (a restricted key is required)");
    else add(ex.allowance !== null && ex.allowance !== undefined && ex.allowance < GAS_RESERVE_YOCTO * 5n ? "WARN" : "PASS", `merchant key ${m.role}`, `function-call, ${ex.methodNames.join(",")}, allowance left ${ex.allowance == null ? "unlimited" : fmt(ex.allowance)}${wanted ? "" : " (local key not set: matched by shape)"}`);
  }
  const contract = await ctx.chain.getAccount(cfg.contractId);
  if (!contract || contract.codeHash === NO_CODE_HASH) add("FAIL", "contract has code", "no contract deployed");
  else {
    add("PASS", "contract has code", contract.codeHash);
    const wasmPath = ctx.flags.wasm ? resolve(ctx.flags.wasm) : join(ctx.repoRoot, WASM_REL);
    let wasm = null;
    try { wasm = ctx.fs.readFileSync(wasmPath); } catch { /* none */ }
    if (!wasm) add("WARN", "wasm hash matches", `no local wasm at ${wasmPath}: hash not compared`);
    else {
      const h = codeHashOf(wasm);
      add(h === contract.codeHash ? "PASS" : "FAIL", "wasm hash matches", h === contract.codeHash ? h : `on chain ${contract.codeHash}, local ${h}`);
    }
  }
  let config = null;
  try { config = await ctx.chain.view({ contractId: cfg.contractId, method: "get_config", args: {} }); }
  catch (e) { add("FAIL", "get_config", `view failed (${String(e.message).slice(0, 80)}): is init done?`); }
  if (config) {
    const strip = (s) => String(s).replace(/^\./, "");
    const eq = (name, got, want) => add(String(got) === String(want) ? "PASS" : "FAIL", `config.${name}`, String(got) === String(want) ? String(got) : `got ${got}, expected ${want}`);
    eq("mode", config.mode, cfg.mode);
    eq("paused", config.paused, false);
    eq("owner", config.owner, cfg.byRole.owner.id);
    eq("operator", config.operator, cfg.byRole.operator.id);
    eq("player_suffix", strip(config.player_suffix), strip(`.${cfg.byRole.relayer.id}`));
    const got = [...(config.merchant_accounts ?? [])].sort().join(",");
    const want = cfg.merchants.map((m) => m.id).sort().join(",");
    add(got === want ? "PASS" : "FAIL", "config.merchant_accounts", got === want ? "four merchant accounts match" : "do not match the planned merchants");
    const pinned = (n, v, explicit) => explicit ? eq(n, v, explicit) : add("PASS", `config.${n}`, `${v} (not compared)`);
    pinned("max_players", config.max_players, ctx.flags.maxPlayers);
    pinned("operator_daily_cap", config.operator_daily_cap, ctx.flags.operatorDailyCap);
  }
  try {
    const world = await ctx.chain.view({ contractId: cfg.contractId, method: "get_world", args: {} });
    add(Array.isArray(world.merchants) && world.merchants.length === 4 ? "PASS" : "FAIL", "world.merchants", `${world.merchants?.length ?? 0} merchants`);
    add(world.mode === cfg.mode ? "PASS" : "FAIL", "world.mode", String(world.mode));
    add(world.paused === false ? "PASS" : "FAIL", "world.paused", String(world.paused));
    add("PASS", "world.tick", `tick ${world.tick}, players ${world.player_count ?? "?"}`);
  } catch (e) { add("FAIL", "get_world", `view failed (${String(e.message).slice(0, 80)})`); }

  const failed = checks.filter((c) => c.status === "FAIL").length;
  const warned = checks.filter((c) => c.status === "WARN").length;
  log.info(`verify: ${checks.length - failed - warned} passed, ${warned} warning(s), ${failed} failed.`);
  return failed === 0 ? 0 : 1;
}

// ----------------------------------------------------------------------------------------------------- all

export async function cmdAll(ctx) {
  for (const [name, fn] of [["accounts", cmdAccounts], ["keys", cmdKeys], ["deploy", cmdDeploy], ["verify", cmdVerify]]) {
    const code = await fn(ctx);
    if (code !== 0) { ctx.log.error(`stopped after ${name}`); return code; }
  }
  ctx.log.info(`\nall done${ctx.dryRun ? " (dry run: nothing was changed)" : ""}.`);
  return 0;
}

export const COMMAND_TABLE = { plan: cmdPlan, accounts: cmdAccounts, keys: cmdKeys, deploy: cmdDeploy, verify: cmdVerify, all: cmdAll };
export { CITIES, MERCHANT_METHODS, SHAHR_EXTRA_METHODS };
