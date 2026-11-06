#!/usr/bin/env node
// setup-testnet.mjs: owner-run testnet setup and deploy tooling for Caravan Road.
//
//   node scripts/setup-testnet.mjs plan                 offline: what would be done (no network, nothing written)
//   node scripts/setup-testnet.mjs accounts [--dry-run] create owner/operator/relayer/merchant sub-accounts, write .env.local
//   node scripts/setup-testnet.mjs keys     [--dry-run] function-call keys on the merchants (--rotate <roles> to rotate)
//   node scripts/setup-testnet.mjs deploy   [--dry-run] build the wasm, deploy + init in one transaction
//   node scripts/setup-testnet.mjs verify               read-only checks
//   node scripts/setup-testnet.mjs all      [--dry-run] accounts, keys, deploy, verify
//
// The OWNER runs this on their own machine with their own root testnet account. Environment (names only, see .env.example):
//   ROOT_ACCOUNT_ID  the root testnet account you created (all other account ids are derived from it)
//   ROOT_KEY_FILE    path to a local file with the root account's private key (or leave unset to use ~/.near-credentials)
// The root key is read from that local file only; it is never accepted as an argument, never printed, never written
// anywhere. Generated keys go only into .env.local (git-ignored, created with restrictive permissions).
// Testnet only: mainnet is always a manual owner action (master plan 0.3).
//
// Layout: scripts/lib/setup-core.mjs (pure helpers, config, argv), setup-env.mjs (.env.local), setup-keys.mjs (root key,
// secrets), setup-steps.mjs (the subcommands), near-chain.mjs (the only module that talks to NEAR). Tests:
// scripts/__tests__/setup-testnet.test.mjs (node --test, offline, fake chain).

import nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SetupError, USAGE, buildConfig, createLogger, parseArgs } from "./lib/setup-core.mjs";
import { parseEnvText, readEnvText } from "./lib/setup-env.mjs";
import { COMMAND_TABLE, createContext } from "./lib/setup-steps.mjs";

const SECRET_ENV_RE = /(PRIVATE_KEY|_SECRET$|^KEY_|^AUTH_|JWT|API_KEY|DATABASE_URL|TOKEN|ROOT_KEY_FILE)/i;

/** Child processes (git, cargo, icacls, node init-args) get an environment without secrets. */
function scrubbedEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_ENV_RE.test(k)));
}

function defaultExec(command, args, opts = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", cwd: opts.cwd, env: scrubbedEnv(process.env), windowsHide: true });
  return { status: r.status ?? (r.error ? -1 : 1), stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function defaultRunBuild({ cwd, command, args }) {
  const r = spawnSync(command, args, { cwd, stdio: "inherit", env: scrubbedEnv(process.env), windowsHide: true });
  return { status: r.status ?? (r.error ? -1 : 1) };
}

const offline = new Proxy({}, { get: (_t, name) => () => { throw new Error(`BUG: ${String(name)} needs the network but this command is offline`); } });

/**
 * @param {string[]} argv  command line without node and script
 * @param {object} [deps]  injection points for tests: repoRoot, processEnv, fs, exec, runBuild, home, platform,
 *                         createChain(cfg), crypto, out, err, redact
 * @returns {Promise<number>} process exit code
 */
export async function main(argv, deps = {}) {
  const repoRoot = deps.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const processEnv = deps.processEnv ?? process.env;
  const fs = deps.fs ?? nodeFs;
  const out = deps.out ?? ((l) => process.stdout.write(`${l}\n`));
  const err = deps.err ?? ((l) => process.stderr.write(`${l}\n`));
  const log = createLogger({ out, err, redact: deps.redact !== false });
  try {
    const { command, flags } = parseArgs(argv);
    if (command === "help") { out(USAGE); return 0; }

    const envFilePath = flags.envFile ? resolve(flags.envFile) : join(repoRoot, ".env.local");
    const envText = readEnvText(envFilePath, fs);
    const fileMap = parseEnvText(envText);
    const cfg = buildConfig((n) => (processEnv[n] && processEnv[n].trim() !== "" ? processEnv[n].trim() : fileMap.get(n) || undefined), flags);

    const isPlan = command === "plan";
    const dryRun = isPlan || Boolean(flags.dryRun);
    const needsChain = !isPlan && !(command === "verify" && dryRun);
    let chain = offline;
    let crypto = deps.crypto ?? offline;
    if (needsChain) {
      const { createNearChain, createCrypto, readOnlyChain } = await import("./lib/near-chain.mjs");
      chain = deps.createChain ? await deps.createChain(cfg) : createNearChain({ repoRoot, rpcUrl: cfg.rpcUrl });
      if (!deps.crypto) crypto = createCrypto(repoRoot);
      if (dryRun) chain = readOnlyChain(chain);
    }
    const rel = relative(repoRoot, envFilePath);
    const ctx = createContext({
      cfg, flags, envFilePath, envText,
      deps: {
        chain, crypto, log, fs, processEnv, repoRoot,
        exec: deps.exec ?? defaultExec,
        runBuild: deps.runBuild ?? defaultRunBuild,
        home: deps.home ?? homedir(),
        platform: deps.platform ?? process.platform,
        initArgsPath: join(repoRoot, "scripts", "init-args.mjs"),
        relativeEnvLabel: rel && !rel.startsWith("..") ? rel : envFilePath,
        forceDryRun: dryRun,
      },
    });
    return await COMMAND_TABLE[command](ctx);
  } catch (e) {
    if (e instanceof SetupError) { log.error(e.message); return e.exitCode; }
    log.error(`unexpected failure: ${String(e?.message ?? e).slice(0, 500)}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // Piping into `head` or `less` closes stdout early: that is not an error.
  process.stdout.on("error", (e) => { if (e && e.code === "EPIPE") process.exit(0); throw e; });
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
