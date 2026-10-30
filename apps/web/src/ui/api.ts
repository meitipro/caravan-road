// The one place that creates the api-client. Components never call fetch against /api themselves.
// NEXT_PUBLIC_MOCK=1 makes the shared client serve the simulated in-memory world.

import { createApiClient, type ApiClient, type ApiResult, type ErrorCode } from "@caravan/shared";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (!client) client = createApiClient();
  return client;
}

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

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
