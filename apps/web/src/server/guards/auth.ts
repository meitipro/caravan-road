// Session identity as the server sees it. Auth.js (auth/config.ts) produces it in production; tests
// inject a stub. Display names are sanitised before they are stored or shown to other players.

import { randomUUID } from "node:crypto";
import type { Repo, UserRow } from "../db/repo";

export interface SessionUser {
  provider: string;
  /** Stable id from the OAuth provider (Auth.js account.providerAccountId). */
  subject: string;
  email: string | null;
  name: string | null;
}

export type SessionResolver = (req: Request) => Promise<SessionUser | null>;

export function sanitizeName(raw: string | null | undefined, subject: string): string {
  const cleaned = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  if (cleaned) return cleaned;
  let h = 0;
  for (const ch of subject) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Caravaneer-${h.toString(16).padStart(4, "0").slice(-4)}`;
}

export async function resolveUser(repo: Repo, s: SessionUser, now: number): Promise<UserRow> {
  return repo.upsertUser({
    id: randomUUID(), provider: s.provider, subject: s.subject, email: s.email,
    name: sanitizeName(s.name, s.subject), now,
  });
}
