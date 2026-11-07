"use client";

import { useEffect, useState } from "react";
import { PARAMS } from "@caravan/shared";
import { IS_MOCK } from "../ui/api";
import { faucetBlockReason, faucetCooldownSec, faucetEligible, faucetWorthFils } from "../ui/faucet-rules";
import { formatCoins } from "../ui/format";
import { usePersisted } from "../ui/persisted";
import { useActions, useGame } from "./GameProvider";
import { useToast } from "./Toast";

// Cooldown and eligibility. The real contract waits 3600 s between claims and refuses once the player's worth (coins,
// goods, stall goods and cargo on the road, at base prices) reaches 50 coins; see ui/faucet-rules.ts. The browser demo
// (NEXT_PUBLIC_MOCK=1) keeps its own rule: a 60 s wait and no wealth limit. The server does not tell us when the last
// claim was, so the wait is remembered here: after a claim, or after the server answers RATE_LIMIT (then as the full
// cooldown, which is an upper bound: the label says "about").

/** Can this player get free coins by the contract's wealth rule? The demo has no such rule. */
function useFaucetEligible(): boolean {
  const { me, world } = useGame();
  return IS_MOCK || (!!me && !!world && faucetEligible(faucetWorthFils(me, world.stalls)));
}

export function useFaucet() {
  const actions = useActions();
  const toast = useToast();
  const { me, mode } = useGame();
  const eligible = useFaucetEligible();
  const [, setClaimed] = usePersisted("caravan.claimed");
  // Real mode keeps the wait across reloads (per account); the demo world resets on reload, so its wait stays in memory.
  const [storedUntil, setStoredUntil] = usePersisted(`caravan.faucet.until.${me?.account_id ?? "-"}`);
  const [localUntil, setLocalUntil] = useState(0);
  const until = IS_MOCK ? localUntil : Number(storedUntil) || 0;
  const setUntil = (ms: number) => (IS_MOCK ? setLocalUntil(ms) : setStoredUntil(String(ms)));
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (until <= 0) {
      setLeft(0);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [until]);

  const reason = mode === "PLAY" && me ? faucetBlockReason({ eligible, waitLeftSec: left }) : null;
  const cooldownMs = faucetCooldownSec(IS_MOCK) * 1000;

  const claim = async () => {
    if (reason) return;
    setBusy(true);
    const r = await actions.faucet(); // shows the honest refusal text itself (faucetRefusalText)
    setBusy(false);
    if (r.ok) {
      setClaimed("1");
      setUntil(Date.now() + cooldownMs);
      toast.success(`+${formatCoins(String(PARAMS.FAUCET_FILS))} coins added`);
    } else if (r.error.code === "RATE_LIMIT") {
      setUntil(Date.now() + cooldownMs);
    }
  };

  return { claim, busy, left, eligible, reason };
}

/** Button text: a short wait counts down, a long one just says so (the reason line gives the time). */
export function claimLabel(busy: boolean, left: number): string {
  if (busy) return "Claiming…";
  const amount = `Claim ${formatCoins(String(PARAMS.FAUCET_FILS))} coins`;
  if (left <= 0) return amount;
  return left <= 90 ? `Wait ${left}s` : amount;
}

/**
 * Whether to show the free-coins banner. Real PLAY game: only when the player can actually get them (worth under 50
 * coins; the wait is shown on the banner itself). Demo: new players (never claimed) and broke ones (under 50 coins).
 */
export function useNeedsFaucet(): boolean {
  const { me, mode } = useGame();
  const eligible = useFaucetEligible();
  const [claimed] = usePersisted("caravan.claimed");
  if (!me || mode !== "PLAY") return false;
  if (!IS_MOCK) return eligible;
  if (claimed === null) return false;
  return !claimed || BigInt(me.fils) < 5000n;
}

export function FaucetBanner() {
  const need = useNeedsFaucet();
  const { claim, busy, left, reason } = useFaucet();
  if (!need) return null;
  return (
    <div className="panel faucet-banner">
      <div>
        <p className="empty-title">Free coins for practice</p>
        <p className="muted small">PLAY mode is free. Claim {formatCoins(String(PARAMS.FAUCET_FILS))} coins and start trading.</p>
        {reason && !IS_MOCK && <p className="small" role="status">{reason}</p>}
      </div>
      <button type="button" className="btn btn-primary btn-lg" onClick={claim} disabled={busy || reason !== null}>
        {claimLabel(busy, left)}
      </button>
    </div>
  );
}
