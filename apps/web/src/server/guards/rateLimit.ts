// Fixed-window rate limiting backed by the rate_limits table (shared by all server instances).

import type { Repo } from "../db/repo";

export interface RateResult { allowed: boolean; count: number; limit: number; retryAfter: number }

export interface RateLimiter {
  /** Counts one hit for `key` and tells whether it is within `limit` per `windowSeconds`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateResult>;
}

export const LIMITS = {
  USER_ACTIONS_PER_MINUTE: 30,
  RELAYER_ACTIONS_PER_DAY: 1000,
  READS_PER_MINUTE: 180,
} as const;

export function createRateLimiter(repo: Repo, now: () => number): RateLimiter {
  let lastPurge = 0;
  return {
    async hit(key, limit, windowSeconds) {
      const t = now();
      const windowStart = Math.floor(t / windowSeconds) * windowSeconds;
      const count = await repo.hit(key, windowStart);
      if (t - lastPurge > 3600) {
        lastPurge = t;
        void repo.purgeRateLimits(t - 2 * 86400).catch(() => undefined);
      }
      return { allowed: count <= limit, count, limit, retryAfter: windowStart + windowSeconds - t };
    },
  };
}
