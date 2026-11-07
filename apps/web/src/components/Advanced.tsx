"use client";

// The "Advanced" drawer: the only normal-flow place where chain vocabulary is allowed.

import type { Mode } from "@caravan/shared";
import { IS_MOCK } from "../ui/api";
import { shortId } from "../ui/format";
import { useGame } from "./GameProvider";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export function AdvancedDrawer({ open, onClose, accountId, mode }: { open: boolean; onClose: () => void; accountId: string; mode: Mode }) {
  const { events } = useGame();
  const toast = useToast();
  const explorer = mode === "LIVE" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const txs = events
    .map((e) => ({ id: e.id, type: e.type, tx: typeof e.data.tx_hash === "string" ? e.data.tx_hash : null }))
    .filter((e): e is { id: number; type: typeof e.type; tx: string } => e.tx !== null);

  return (
    <Sheet open={open} onClose={onClose} title="Advanced" variant="drawer">
      <div className="stack">
        <p className="muted small">Technical details for the curious. You never need them to play.</p>
        <dl className="kv">
          <dt>Account id</dt>
          <dd>
            <code>{accountId}</code>{" "}
            <button type="button" className="btn btn-small" onClick={async () => {
              try { await navigator.clipboard.writeText(accountId); toast.success("Copied"); } catch { toast.info("Copy failed"); }
            }}>Copy</button>
          </dd>
          <dt>Network</dt><dd>{IS_MOCK ? "None (demo)" : mode === "LIVE" ? "NEAR mainnet" : "NEAR testnet"}</dd>
          <dt>No wallet needed</dt>
          <dd>{IS_MOCK ? "This demo runs in your browser. Nothing is sent to any network." : "The game pays network fees for you and signs on your behalf."}</dd>
        </dl>
        {IS_MOCK ? (
          <p className="muted small">Mock mode: this is a simulated account, so there is nothing to look up in an explorer.</p>
        ) : (
          <a className="link" href={`${explorer}/address/${encodeURIComponent(accountId)}`} target="_blank" rel="noreferrer">Open account in explorer</a>
        )}
        <h3 className="h3">Recent transactions</h3>
        {txs.length === 0 ? (
          <p className="muted small">No transaction links yet.</p>
        ) : (
          <ul className="stack-sm">
            {txs.map((t) => (
              <li key={t.id} className="small">
                {t.type}:{" "}
                {IS_MOCK ? <code>{shortId(t.tx, 8, 6)}</code> : <a className="link" href={`${explorer}/txns/${encodeURIComponent(t.tx)}`} target="_blank" rel="noreferrer">{shortId(t.tx, 8, 6)}</a>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
