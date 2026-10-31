// Mode gating (spec 2.10): PLAY closes every money route; LIVE closes the faucet. PAUSE_ALL (a row in
// the flags table) closes every state-changing route in both modes.
//
// PAUSE_ALL fails closed in LIVE: only an explicit false-like value opens the game; a missing row or an
// unknown value counts as paused. In PLAY only an explicit true-like value pauses (a fresh dev database).

import type { Mode } from "@caravan/shared";
import { ApiError } from "../errors";
import type { Repo } from "../db/repo";
import type { Services } from "../services";

export type ModeRule = "ANY" | "PLAY_ONLY" | "LIVE_ONLY";

export function checkMode(mode: Mode, rule: ModeRule): void {
  if (rule === "PLAY_ONLY" && mode !== "PLAY") throw new ApiError("MODE_NOT_ALLOWED", "This only works in PLAY mode.");
  if (rule === "LIVE_ONLY" && mode !== "LIVE") throw new ApiError("MODE_NOT_ALLOWED", "This is only available in LIVE mode.");
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

export function parsePauseFlag(value: string | null, mode: Mode): boolean {
  const v = value?.trim().toLowerCase() ?? null;
  if (v !== null && TRUE_VALUES.has(v)) return true;
  if (v !== null && FALSE_VALUES.has(v)) return false;
  return mode === "LIVE"; // missing or unknown
}

export async function isPaused(repo: Repo, mode: Mode): Promise<boolean> {
  return parsePauseFlag(await repo.getFlag("PAUSE_ALL"), mode);
}

export async function checkNotPaused(repo: Repo, mode: Mode): Promise<void> {
  if (await isPaused(repo, mode)) throw new ApiError("PAUSED", "The game is paused for maintenance.");
}

/** The contract's own mode must equal GAME_MODE before any mode-specific (money or faucet) route runs. */
export async function assertContractMode(svc: Pick<Services, "mode" | "contract" | "configCache" | "log">): Promise<void> {
  const cfg = (await svc.configCache.get(() => svc.contract.getConfig())) as { mode: Mode };
  if (cfg.mode !== svc.mode) {
    svc.log.error("ALERT: GAME_MODE differs from the contract mode; refusing mode-specific routes");
    throw new ApiError("MODE_NOT_ALLOWED", "This is not available right now.");
  }
}
