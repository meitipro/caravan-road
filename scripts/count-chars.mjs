#!/usr/bin/env node
// count-chars.mjs: exact character counts for the length-limited text drafted in docs/SUBMISSION.md,
// docs/X_POST.md and docs/DEMO_SCRIPT.md. It reads Markdown files, finds count markers and checks the fenced
// block that follows each marker. It never sends or posts anything and never touches the network.
//
// Marker syntax (an HTML comment on its own line, then the fenced block on the next non-empty lines):
//
//   <!-- count: NAME min=20 max=2000 -->
//   ```
//   text to measure (the block content between the fences, without the final newline)
//   ```
//
// Optional marker attributes:
//   tokens=DEMO_URL:23,REPO_URL:23   each occurrence of {DEMO_URL} counts as 23 characters (X counts every link as 23).
//
// Payload marker (the JSON for POST https://nearhackathon.com/api/applications):
//
//   <!-- payload: NAME max-bytes=12000 -->
//   ```json
//   { ... "idea": "@IDEA@" ... }
//   ```
//
// "@IDEA@" is replaced by the text of the block marked "count: idea" in the same file, JSON-escaped, so the byte
// size of the real body can be checked. The payload block is checked for: valid JSON, exactly the allowed field names,
// the field rules of https://nearhackathon.com/HACKATHON.md (read 2026-11-01), and the body size in UTF-8 bytes.
// Fields still holding TODO(owner) are reported as "TODO" (not as errors): the owner fills them in.
//
// Counting rules printed for each block:
//   chars  = number of Unicode code points (what a person counts; equals UTF-16 length when the text is ASCII)
//   utf16  = JavaScript string length (what a JS server-side check such as value.length would see)
//   bytes  = UTF-8 bytes
//   Line breaks are normalised to "\n" (1 character each). Non-ASCII characters are listed.
//
// Usage:  node scripts/count-chars.mjs [file ...]      (default: the three docs)
// Exit code: 0 all checks pass, 1 a limit is exceeded or a payload rule fails, 2 bad usage.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = ["docs/SUBMISSION.md", "docs/X_POST.md", "docs/DEMO_SCRIPT.md"].map((f) => resolve(root, f));
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => resolve(f)) : defaults;

const ALLOWED_FIELDS = ["requestId", "projectName", "leadName", "email", "size", "tracks", "nearAddress", "projectUrl", "demoUrl", "idea", "consent"];
const TRACKS = ["defi", "thesis", "privacy", "business", "swarms", "security", "agents", "realworld", "games", "nfts", "memecoins", "social", "open"];
const SIZES = ["1", "2 - 4", "4 - 6", "6 - 8", "8+"];
const NEAR_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTodo = (v) => typeof v === "string" && v.includes("TODO(owner)");

let failures = 0;
let todos = 0;
const fail = (m) => { failures++; console.log(`    FAIL  ${m}`); };
const note = (m) => console.log(`          ${m}`);

function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w-]+)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}

/** Returns [{ kind, name, attrs, body, line }] for every marker followed by a fenced block. */
function extract(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^<!--\s*(count|payload):\s*(\S+)\s*(.*?)\s*-->\s*$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const open = /^(`{3,})/.exec(lines[j] ?? "");
    if (!open) { fail(`${m[2]}: marker on line ${i + 1} is not followed by a fenced block`); continue; }
    const fence = open[1];
    const body = [];
    let k = j + 1;
    while (k < lines.length && !lines[k].startsWith(fence)) body.push(lines[k++]);
    if (k >= lines.length) { fail(`${m[2]}: fenced block from line ${j + 1} is never closed`); continue; }
    found.push({ kind: m[1], name: m[2], attrs: parseAttrs(m[3]), body: body.join("\n"), line: i + 1 });
    i = k;
  }
  return found;
}

function measure(text, tokens) {
  let weighted = null;
  if (tokens) {
    let t = text;
    let extra = 0;
    for (const [name, w] of Object.entries(tokens)) {
      const re = new RegExp(`\\{${name}\\}`, "g");
      const n = (t.match(re) || []).length;
      t = t.replace(re, "");
      extra += n * w;
    }
    weighted = [...t].length + extra;
  }
  return {
    chars: [...text].length,
    utf16: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    nonAscii: [...new Set([...text].filter((c) => c.codePointAt(0) > 127))],
    weighted,
  };
}

function checkCount(b) {
  const min = b.attrs.min ? Number(b.attrs.min) : 0;
  const max = b.attrs.max ? Number(b.attrs.max) : Infinity;
  let tokens = null;
  if (b.attrs.tokens) {
    tokens = {};
    for (const p of b.attrs.tokens.split(",")) { const [n, w] = p.split(":"); tokens[n] = Number(w); }
  }
  const m = measure(b.body, tokens);
  const counted = m.weighted ?? m.chars;
  const ok = counted >= min && counted <= max && m.utf16 <= (tokens ? Infinity : max);
  const limit = `${b.attrs.min ?? "-"}..${b.attrs.max ?? "-"}`;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${b.name.padEnd(22)} chars=${m.chars} utf16=${m.utf16} bytes=${m.bytes}${m.weighted !== null ? ` weighted=${m.weighted}` : ""}  limit ${limit}${m.nonAscii.length ? `  non-ASCII: ${m.nonAscii.join(" ")}` : ""}`);
  if (!ok) { failures++; }
  if (isTodo(b.body)) { todos++; note("contains TODO(owner): fill it in, then re-run this script"); }
}

function checkPayload(b, blocks) {
  console.log(`  ----  payload ${b.name}`);
  const idea = blocks.find((x) => x.kind === "count" && x.name === "idea");
  let raw = b.body;
  if (raw.includes("@IDEA@")) {
    if (!idea) { fail("payload uses @IDEA@ but no 'count: idea' block exists in this file"); return; }
    raw = raw.replace('"@IDEA@"', JSON.stringify(idea.body));
  }
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { fail(`payload is not valid JSON: ${e.message}`); return; }
  const keys = Object.keys(obj);
  for (const k of keys) if (!ALLOWED_FIELDS.includes(k)) fail(`field not allowed by the API: ${k}`);
  for (const k of ALLOWED_FIELDS) if (!(k in obj)) fail(`field missing: ${k}`);
  const str = (k, lo, hi) => {
    const v = obj[k];
    if (typeof v !== "string") return fail(`${k} must be a string`);
    if (isTodo(v)) { todos++; return note(`${k}: TODO(owner)`); }
    const n = [...v].length;
    if (n < lo || n > hi) fail(`${k}: ${n} chars, allowed ${lo}..${hi}`); else note(`${k}: ${n} chars (allowed ${lo}..${hi}) ok`);
  };
  str("projectName", 2, 80);
  str("leadName", 2, 80);
  str("email", 3, 160);
  str("projectUrl", 1, 300);
  str("demoUrl", 1, 300);
  str("idea", 20, 2000);
  for (const k of ["projectUrl", "demoUrl"]) if (!isTodo(obj[k]) && !/^https?:\/\//.test(obj[k] ?? "")) fail(`${k} must start with http:// or https://`);
  if (!isTodo(obj.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(obj.email ?? "")) fail("email does not look valid");
  if (isTodo(obj.requestId)) { todos++; note("requestId: TODO(owner) (generate once with node -e 'console.log(crypto.randomUUID())')"); }
  else if (!UUID_RE.test(obj.requestId ?? "")) fail("requestId is not a UUID");
  if (isTodo(obj.size)) { todos++; note("size: TODO(owner)"); } else if (!SIZES.includes(obj.size)) fail(`size must be one of ${SIZES.join(" | ")}`);
  if (!Array.isArray(obj.tracks) || obj.tracks.length < 1) fail("tracks must be a non-empty array");
  else {
    const seen = new Set();
    for (const t of obj.tracks) { if (!TRACKS.includes(t)) fail(`unknown track id: ${t}`); if (seen.has(t)) fail(`track listed twice: ${t}`); seen.add(t); }
    note(`tracks: ${obj.tracks.join(", ")}`);
  }
  if (isTodo(obj.nearAddress)) { todos++; note("nearAddress: TODO(owner) (mainnet; 2-64 chars, lowercase, regex checked once filled)"); }
  else {
    const a = obj.nearAddress ?? "";
    if (a.length < 2 || a.length > 64 || !NEAR_RE.test(a)) fail("nearAddress fails 2-64 chars / regex"); else note(`nearAddress: ${a.length} chars ok`);
  }
  if (typeof obj.consent !== "boolean") fail("consent must be a boolean"); else note(`consent: ${obj.consent} (must be true only after the owner agreed to the notice)`);
  if ("website" in obj) fail("'website' is a spam trap and must not be sent");
  const body = JSON.stringify(obj);
  const bytes = Buffer.byteLength(body, "utf8");
  const max = Number(b.attrs["max-bytes"] ?? 12000);
  if (bytes > max) fail(`body is ${bytes} bytes, limit ${max}`); else note(`body: ${bytes} bytes of ${max} (with the real idea text and current placeholders; filled-in values add a little) ok`);
}

for (const file of files) {
  if (!existsSync(file)) { console.log(`missing file: ${file}`); process.exitCode = 2; continue; }
  console.log(`\n${file.replace(root, "").replace(/^[\\/]/, "")}`);
  const blocks = extract(readFileSync(file, "utf8"));
  if (!blocks.length) console.log("  (no count markers)");
  for (const b of blocks) (b.kind === "count" ? checkCount(b) : checkPayload(b, blocks));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}${todos ? `; ${todos} field(s) still hold TODO(owner)` : ""}`);
process.exit(failures ? 1 : process.exitCode ?? 0);
