// setup-env.mjs: read, plan and write the local env file (.env.local) that holds the generated secrets.
//
//  - Existing non-empty values are never overwritten unless --force is given (`planUpdates` reports conflicts).
//  - The file is replaced atomically: a temporary file is created empty with restrictive permissions, locked down,
//    filled, then renamed over the target. A crash never leaves a half-written secret file.
//  - Permissions: POSIX mode 0600; on Windows `icacls` removes inherited access and grants only the current user.
//  - The file must be git-ignored before anything is written to it (`git check-ignore`, with a .gitignore fallback).
// Values are never returned in `changes`, only names and actions, so callers can print them safely.

import { SetupError } from "./setup-core.mjs";
import { dirname, basename, join, relative, resolve, sep, isAbsolute } from "node:path";

const LINE_RE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** @returns {Map<string, string>} name -> value (last assignment wins; quotes stripped; empty string allowed) */
export function parseEnvText(text) {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    let v = m[3].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map.set(m[2], v.trim());
  }
  return map;
}

function assertSafeValue(name, value) {
  if (!/^[^\s#"'`$\\]+$/.test(value)) throw new SetupError(`value for ${name} contains characters that are not safe in an env file`, 2);
}

/**
 * Decide, per desired value, what to do with the existing file content.
 * @param {Map<string,string>} existing
 * @param {{name: string, value: string}[]} desired
 * @param {{force?: boolean}} opts
 * @returns {{changes: {name: string, action: "add"|"fill"|"keep"|"replace"}[], conflicts: string[], toWrite: {name: string, value: string}[]}}
 */
export function planUpdates(existing, desired, { force = false } = {}) {
  const changes = [];
  const conflicts = [];
  const toWrite = [];
  for (const { name, value } of desired) {
    assertSafeValue(name, value);
    const cur = existing.get(name);
    if (cur === undefined) { changes.push({ name, action: "add" }); toWrite.push({ name, value }); }
    else if (cur === "") { changes.push({ name, action: "fill" }); toWrite.push({ name, value }); }
    else if (cur === value) changes.push({ name, action: "keep" });
    else if (force) { changes.push({ name, action: "replace" }); toWrite.push({ name, value }); }
    else conflicts.push(name);
  }
  return { changes, conflicts, toWrite };
}

const FILE_HEADER = [
  "# Local secrets and ids for the Caravan Road testnet setup. Written by scripts/setup-testnet.mjs.",
  "# NEVER commit this file (it is git-ignored) and never paste its values into chat, logs or tickets.",
  "# OWNER_PRIVATE_KEY stays on this machine only; do not copy it to any host.",
  "",
].join("\n");

/** Apply writes to existing text: replace the existing assignment (any prefix kept) or append. */
export function applyWrites(text, toWrite) {
  let out = text;
  if (out === "") out = FILE_HEADER;
  for (const { name, value } of toWrite) {
    const re = new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=).*$`, "m");
    if (re.test(out)) out = out.replace(re, (_m, p1) => `${p1}${value}`);
    else out += `${out.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
  }
  return out;
}

/**
 * Restrict a file to the current user. Best effort on Windows: returns false when it could not be done.
 * @param {string} path
 * @param {{platform: string, exec: Function, env: Record<string,string|undefined>, fs: any}} deps
 */
export function restrictPermissions(path, { platform, exec, env, fs }) {
  if (platform !== "win32") {
    fs.chmodSync(path, 0o600);
    return true;
  }
  const user = env.USERNAME;
  if (!user) return false;
  // `icacls <file> /inheritance:r /grant:r <user>:F` removes inherited ACLs and leaves full control to the current user only.
  const r = exec("icacls", [path, "/inheritance:r", "/grant:r", `${user}:F`], {});
  return r.status === 0;
}

/** @returns {Promise<boolean|null>} true ignored, false not ignored, null unknown */
export function gitIgnoreStatus(path, { exec, cwd }) {
  const r = exec("git", ["check-ignore", "-q", path], { cwd });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

/** Fallback when git is unavailable: a `.gitignore` in the repository root that contains `.env*` or `.env.local`. */
export function gitignoreFileCovers(gitignoreText) {
  return gitignoreText.split(/\r?\n/).map((l) => l.trim()).some((l) => l === ".env*" || l === ".env.local" || l === ".env.*" || l === "*.local");
}

/**
 * Atomic write with restrictive permissions. `deps.fs` is node:fs (or a test double with the same methods).
 * @returns {{restricted: boolean}}
 */
export function writeEnvFileAtomic(path, text, deps) {
  const { fs } = deps;
  const dir = dirname(path);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  let restricted = false;
  try {
    fs.writeFileSync(tmp, "", { mode: 0o600, flag: "wx" });
    restricted = restrictPermissions(tmp, deps);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, path);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw new SetupError(`could not write the env file (${e instanceof Error ? e.code ?? e.message : "error"}); nothing was changed`, 1);
  }
  return { restricted };
}

/** Throws when the env file is inside the repository and not git-ignored. */
export function assertEnvFileIgnored(path, { exec, repoRoot, fs }) {
  const abs = resolve(path);
  const rel = relative(repoRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "outside-repo"; // not inside this repository
  const relPosix = rel.split(sep).join("/");
  const st = gitIgnoreStatus(relPosix, { exec, cwd: repoRoot });
  if (st === true) return "ignored";
  if (st === null) {
    let giText = "";
    try { giText = fs.readFileSync(join(repoRoot, ".gitignore"), "utf8"); } catch { /* no .gitignore */ }
    if (gitignoreFileCovers(giText)) return "ignored";
  }
  throw new SetupError(`${relPosix} is not git-ignored. Refusing to write secrets into it. Add it to .gitignore first.`, 1);
}

/** Read the env file into text (empty string when it does not exist). */
export function readEnvText(path, fs) {
  try { return fs.readFileSync(path, "utf8"); }
  catch (e) {
    if (e && e.code === "ENOENT") return "";
    throw new SetupError(`could not read the env file (${e?.code ?? "error"})`, 1);
  }
}
