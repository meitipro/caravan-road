"use client";

// Session handling for the UI.
// MOCK (NEXT_PUBLIC_MOCK=1): a FAKE session kept in localStorage; no providers, no secrets.
// Real mode: the server session decides (the state call returns `me: null` when logged out). The login
// buttons navigate to the Auth.js endpoint; Phase 3 can swap `startLogin` for next-auth's signIn().

import { IS_MOCK } from "./api";
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
