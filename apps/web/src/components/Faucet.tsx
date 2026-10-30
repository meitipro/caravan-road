"use client";

import { useEffect, useState } from "react";
import { PARAMS } from "@caravan/shared";
import { formatDinar } from "../ui/format";
import { usePersisted } from "../ui/persisted";
import { useActions, useGame } from "./GameProvider";
import { useToast } from "./Toast";

// ASSUMPTION(A7): the cooldown length is not in the spec; the mock uses 60 s. The UI starts a local
// 60 s countdown after a successful claim and otherwise trusts the server's RATE_LIMIT error.
const COOLDOWN_SEC = 60;

export function useFaucet() {
  const actions = useActions();
  const toast = useToast();
  const [, setClaimed] = usePersisted("caravan.claimed");
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (until <= 0) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [until]);

  const claim = async () => {
    setBusy(true);
    const r = await actions.faucet();
    setBusy(false);
    if (r.ok) {
      setClaimed("1");
      setUntil(Date.now() + COOLDOWN_SEC * 1000);
      toast.success(`+${formatDinar(String(PARAMS.FAUCET_FILS))} dinars added`);
    } else if (r.error.code === "RATE_LIMIT") {
      setUntil(Date.now() + COOLDOWN_SEC * 1000);
    }
  };

  return { claim, busy, left };
}

/** True for new PLAY players (never claimed) and for broke ones (under 50 dinars, spec 2.9). */
export function useNeedsFaucet(): boolean {
  const { me, mode } = useGame();
  const [claimed] = usePersisted("caravan.claimed");
  if (!me || mode !== "PLAY" || claimed === null) return false;
  return !claimed || BigInt(me.fils) < 5000n;
}

export function FaucetBanner() {
  const need = useNeedsFaucet();
  const { claim, busy, left } = useFaucet();
  if (!need) return null;
  return (
    <div className="panel faucet-banner">
      <div>
        <p className="empty-title">Free dinars for practice</p>
        <p className="muted small">PLAY mode is free. Claim {formatDinar(String(PARAMS.FAUCET_FILS))} dinars and start trading.</p>
      </div>
      <button type="button" className="btn btn-primary btn-lg" onClick={claim} disabled={busy || left > 0}>
        {busy ? "Claiming…" : left > 0 ? `Wait ${left}s` : `Claim ${formatDinar(String(PARAMS.FAUCET_FILS))} dinars`}
      </button>
    </div>
  );
}
