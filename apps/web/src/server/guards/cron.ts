// Cron routes accept only `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is not configured
// every request is rejected.

import { timingSafeEqual, createHash } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function cronAuthorized(req: Request, secret: string | null): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!), digest(secret));
}
