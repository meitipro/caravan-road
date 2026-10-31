// Mode gating (spec 2.10): PLAY closes every money route; LIVE closes the faucet. PAUSE_ALL (a row in
// the flags table) closes every state-changing route in both modes.

import type { Mode } from "@caravan/shared";
import { ApiError } from "../errors";
import type { Repo } from "../db/repo";

export type ModeRule = "ANY" | "PLAY_ONLY" | "LIVE_ONLY";

export function checkMode(mode: Mode, rule: ModeRule): void {
  if (rule === "PLAY_ONLY" && mode !== "PLAY") throw new ApiError("MODE_NOT_ALLOWED", "This only works in PLAY mode.");
  if (rule === "LIVE_ONLY" && mode !== "LIVE") throw new ApiError("MODE_NOT_ALLOWED", "This is only available in LIVE mode.");
}

export async function isPaused(repo: Repo): Promise<boolean> {
  return (await repo.getFlag("PAUSE_ALL")) === "true";
}

export async function checkNotPaused(repo: Repo): Promise<void> {
  if (await isPaused(repo)) throw new ApiError("PAUSED", "The game is paused for maintenance.");
}
