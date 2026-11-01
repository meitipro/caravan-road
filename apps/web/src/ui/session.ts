"use client";

// Session handling for the UI.
// MOCK (NEXT_PUBLIC_MOCK=1): a FAKE session kept in localStorage; no providers, no secrets.
// Real mode: the server session decides (the state call returns `me: null` when logged out). The login
// buttons navigate to the Auth.js endpoint; Phase 3 can swap `startLogin` for next-auth's signIn().

import { IS_MOCK } from "./api";
import { useEffect, useState } from "react";
import { usePersisted } from "./persisted";

export type Provider = "google" | "discord";
export type SessionStatus = "unknown" | "out" | "in";

const KEY = "caravan.mock.session";

export function useMockSession(): { status: SessionStatus; login: (p: Provider) => void; logout: () => void } {
  const [raw, set] = usePersisted(KEY);
  const status: SessionStatus = raw === null ? "unknown" : raw ? "in" : "out";
  return {
    status,
    login: (p) => set(p),
    logout: () => set(null),
  };
}

/** Where the real login starts. Auth.js is wired by the server phase; until then this just navigates. */
export function startLogin(provider: Provider, onMock: (p: Provider) => void): void {
  if (IS_MOCK) {
    onMock(provider);
    return;
  }
  window.location.assign(`/api/auth/signin?provider=${provider}&callbackUrl=${encodeURIComponent("/play")}`);
}

// ---------- local dev login (SERVER_BACKEND=dev, DEV_LOGIN=1) ----------
// The server route /api/dev/login answers 404 unless dev login is on (never in production), so one probe
// request decides which login to show. These two helpers live here (not in components) because they are the
// only direct calls to a non-game route; the game itself goes through the api-client only.

let probe: Promise<boolean> | null = null;
/** One request per page load, shared by every component that asks. */
function probeDevLogin(): Promise<boolean> {
  // Without a name the route answers 400 when it is on and 404 when it is off.
  probe ??= fetch("/api/dev/login", { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.status !== 404 && r.status !== 405)
    .catch(() => false);
  return probe;
}

/** null while probing, then true (dev login is on) or false (use the OAuth buttons). Always false in mock mode. */
export function useDevLoginAvailable(): boolean | null {
  const [on, setOn] = useState<boolean | null>(IS_MOCK ? false : null);
  useEffect(() => {
    if (IS_MOCK) return;
    let alive = true;
    void probeDevLogin().then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

/** Signs in through the dev route. Returns an error text, or null on success (then the page reloads). */
export async function devLogin(name: string): Promise<string | null> {
  try {
    const r = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
    if (!r.ok || !j?.ok) return j?.error?.message ?? "Could not enter. Try another name.";
    window.location.assign("/play");
    return null;
  } catch {
    return "Cannot reach the server. Try again.";
  }
}

export async function devLogout(): Promise<void> {
  try {
    await fetch("/api/dev/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* the cookie is cleared by the next successful call; reload anyway */
  }
  window.location.assign("/play");
}
