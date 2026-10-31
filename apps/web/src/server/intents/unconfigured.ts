// Used in production until the 1Click integration (Phase 7) is wired: every call fails closed.

import { ApiError } from "../errors";
import type { IntentsClient } from "./types";

const unavailable = (): never => {
  throw new ApiError("INTERNAL", "Deposits and withdrawals are not available yet.");
};

export const unconfiguredIntents: IntentsClient = {
  quote: async () => unavailable(),
  status: async () => unavailable(),
  withdraw: async () => unavailable(),
};
