// The one place that creates the api-client. Components never call fetch against /api themselves.
// NEXT_PUBLIC_MOCK=1 makes the shared client serve the simulated in-memory world.

import { safeRemove } from "./storage";
import { createApiClient, type ApiClient, type ApiResult, type ErrorCode } from "@caravan/shared";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (!client) client = createApiClient();
  return client;
}

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

// MOCK only: the simulated world lives in memory and is rebuilt by every page load, but a few flags describing
// "what this player did in the world" live in localStorage. They are tied to the world instance here: a new
// page load means a new world, so the flags are dropped with it (otherwise a reload leaves 500 coins and no
// Claim button). Login and onboarding flags are about the person, not the world, and stay.
export const WORLD_BOUND_KEYS = ["caravan.claimed", "caravan.basis.v1"] as const;

export function resetWorldBoundFlags(): void {
  if (!IS_MOCK || typeof window === "undefined") return;
  const g = globalThis as { __caravanMockWorld?: boolean };
  if (g.__caravanMockWorld) return; // same page load (hot reload, client navigation): the world is still the same
  g.__caravanMockWorld = true;
  for (const k of WORLD_BOUND_KEYS) safeRemove(k);
}
resetWorldBoundFlags();

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Turn an ApiResult into data or throw an ApiError (for SWR fetchers). */
export function unwrap<T>(r: ApiResult<T>): T {
  if (r.ok) return r.data;
  throw new ApiError(r.error.code, r.error.message);
}

/** Dev-only preview of the LIVE cash screens against canned data: /play/cash?live=1 (mock mode only). */
export const CAN_PREVIEW_LIVE = IS_MOCK;
