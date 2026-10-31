// Text hygiene for anything that crosses a trust boundary.
//
// 1. Model output (`line`, `reason`) is untrusted: it is shown to players and stored. We strip
//    control characters, bidi controls, markup, links and emoji, collapse whitespace and cut to length.
//    Instruction-like words ("ignore previous instructions") are NOT removed: they are plain text,
//    cannot trigger anything (no tools, no free-text input to the model) and are rendered as text.
// 2. Player text (haggling, optional, not implemented in this worker) must go through
//    `fenceUntrusted`, which returns a bounded, JSON-embeddable string for a `player_message` field.
//    It must never be placed in the system prompt.

const MAX_SCAN = 4000; // never run the regexes over more than this (bounded work on huge strings)

const CONTROL = /[\p{Cc}\u2028\u2029]/gu;
// zero-width / bidi controls. U+200C (ZWNJ) is kept: it is part of normal Persian spelling.
const INVISIBLE = /[\u200B\u200D\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u20E3]/gu;
const SCHEME_URL = /\b(?:https?|ftp|wss?|data|javascript|file|mailto):[^\s]*/gi;
const WWW_URL = /\bwww\.[^\s]*/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|xyz|ir|near|app|dev|co|me|info|ly|gg|tk)\b[^\s]*/gi;
const MARKUP = /[<>`]/g;

export const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/u;

/** Cut to at most `max` UTF-16 code units without splitting a surrogate pair. */
export function cutTo(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trim();
}

function cleanBase(input: string): string {
  return input
    .slice(0, MAX_SCAN)
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .replace(EMOJI, "")
    .replace(SCHEME_URL, " ")
    .replace(WWW_URL, " ")
    .replace(BARE_DOMAIN, " ")
    .replace(MARKUP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sanitise a model-written display string. May return "" (caller substitutes a fallback). */
export function sanitizeDisplayText(input: string, maxLen: number): string {
  return cutTo(cleanBase(input), maxLen);
}

export const PLAYER_MESSAGE_MAX = 200;

/**
 * Fence for untrusted player text (haggling only). Output is a plain bounded string; the caller
 * must embed it as the value of a `player_message` JSON field in the USER turn (JSON.stringify
 * escapes quotes and newlines), never in the system prompt, and give the model no tools.
 */
export function fenceUntrusted(input: string, maxLen = PLAYER_MESSAGE_MAX): string {
  return cutTo(cleanBase(input), maxLen);
}
