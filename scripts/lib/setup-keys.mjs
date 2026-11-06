// setup-keys.mjs: where key material comes from. Nothing here prints a value.
//
// Root key sources (never argv, never chat):
//  1. the file named by ROOT_KEY_FILE: either the bare key string (`ed25519:...`) or a JSON file with a
//     `private_key` (near-cli) or `secret_key` field. A JSON file that only holds a seed phrase is refused;
//     the seed phrase field is never read.
//  2. the standard near-cli credentials directory (legacy keychain), as documented in
//     https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md :
//       ~/.near-credentials/<network>/<account>.json
//       ~/.near-credentials/<network>/<account>/<ed25519_public-key>.json
//     Keys stored only in the OS keychain (near-cli-rs `save-to-keychain`, the default) cannot be read by this
//     script; export the key to a file you control (see docs/DEPLOY.md).

import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Secret, SetupError } from "./setup-core.mjs";

const KEY_RE = /^(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}$/;
const KEY_FIELDS = ["private_key", "secret_key", "secretKey"];

/** @returns {Secret | null} the key in a credentials file, or null. Never throws with file content in the message. */
export function parseKeyFileText(text) {
  const t = String(text).trim();
  if (KEY_RE.test(t)) return new Secret(t);
  let obj;
  try { obj = JSON.parse(t); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  for (const f of KEY_FIELDS) {
    const v = obj[f];
    if (typeof v === "string" && KEY_RE.test(v.trim())) return new Secret(v.trim());
  }
  return null;
}

/**
 * @param {{get: (n: string) => string | undefined, fs: any, home: string, network: string, rootId: string, platform: string, warn: (m: string) => void}} deps
 * @returns {{source: string, path: string, secrets: Secret[]}}
 */
export function loadRootKeyCandidates({ get, fs, home, network, rootId, platform, warn }) {
  const fileVar = get("ROOT_KEY_FILE");
  const checkMode = (p) => {
    if (platform === "win32") return;
    try { if ((fs.statSync(p).mode & 0o077) !== 0) warn(`${p} is readable by other users; run chmod 600 on it`); } catch { /* ignore */ }
  };
  if (fileVar) {
    const p = resolve(fileVar);
    if (!fs.existsSync(p)) throw new SetupError(`ROOT_KEY_FILE points to a file that does not exist: ${p}`, 2);
    checkMode(p);
    const secret = parseKeyFileText(fs.readFileSync(p, "utf8"));
    if (!secret) {
      throw new SetupError(`${p} does not contain a private key (expected the key string, or JSON with a private_key field). Seed phrases are never read by this script.`, 2);
    }
    return { source: "ROOT_KEY_FILE", path: p, secrets: [secret] };
  }
  const base = join(home, ".near-credentials", network);
  const paths = [join(base, `${rootId}.json`)];
  const dir = join(base, rootId);
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) paths.push(join(dir, f));
    }
  } catch { /* unreadable directory: treated as not present */ }
  const secrets = [];
  const used = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    checkMode(p);
    const s = parseKeyFileText(fs.readFileSync(p, "utf8"));
    if (s) { secrets.push(s); used.push(p); }
  }
  if (secrets.length === 0) {
    throw new SetupError(
      `no usable root key found. Set ROOT_KEY_FILE to a file holding the private key of ${rootId}, or save the key where near-cli can find it:\n` +
      `  ${join(base, `${rootId}.json`)}  (see docs/DEPLOY.md, step "export the root key").\n` +
      "Keys kept only in the OS keychain cannot be read by this script.", 2);
  }
  return { source: "credentials directory", path: used.join(", "), secrets };
}

/** 32 random bytes as 64 hex characters (the format apps/web/src/server/env.ts requires for KEY_ENC_SECRET). */
export function randomHexSecret(bytes = randomBytes) { return new Secret(bytes(32).toString("hex")); }
