"use client";

// "Merchant mind": drawer with the last 10 decisions of a merchant, why they were made, which model
// produced them, and whether the private-inference evidence is attested.

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { PARAMS, type CityId, type Decision, type Merchant } from "@caravan/shared";
import { getApi, IS_MOCK, unwrap } from "../ui/api";
import { formatAgo, shortId } from "../ui/format";
import { CITY_META } from "../ui/game-meta";
import { EmptyState, ErrorState, LoadingBlock, MoodChip } from "./Bits";
import { useGame, useNow } from "./GameProvider";
import { useLang } from "./Lang";
import { Sheet } from "./Sheet";
import { PixelImage } from "./PixelImage";
import { useToast } from "./Toast";

interface MindApi { open: (city: CityId) => void }
const Ctx = createContext<MindApi>({ open: () => {} });
export const useMind = () => useContext(Ctx);

export function MindProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<CityId | null>(null);
  const open = useCallback((c: CityId) => setCity(c), []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={city !== null} onClose={() => setCity(null)} title={city ? `${CITY_META[city].merchant}'s mind` : "Merchant mind"} variant="drawer">
        {city && <MindBody city={city} onNavigate={() => setCity(null)} />}
      </Sheet>
    </Ctx.Provider>
  );
}

/** The badge text. "verified" appears only when attested is true. */
export function evidenceBadge(attested: boolean | null, sample = false): { text: string; tone: "ok" | "plain"; hint: string } {
  // `sample` marks fixture evidence from the demo world: the label says so and still never claims more than attested.
  const tag = sample ? " (sample data)" : "";
  if (attested === true) return { text: `Private AI (TEE) verified${tag}`, tone: "ok", hint: sample ? "Sample record from the demo world, not a real check." : "The inference attestation was checked." };
  return { text: `Private AI (TEE)${tag}`, tone: "plain", hint: sample ? "Sample record from the demo world." : "evidence recorded" };
}

function SpreadBar({ spread }: { spread: number }) {
  const pct = ((spread - PARAMS.SPREAD_MIN_BP) * 100) / (PARAMS.SPREAD_MAX_BP - PARAMS.SPREAD_MIN_BP);
  return (
    <span className="meter" role="img" aria-label={`Spread ${spread / 100} percent`}>
      <span className="meter-fill" style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
    </span>
  );
}

function BiasBar({ bias }: { bias: number }) {
  const half = (Math.abs(bias) * 50) / PARAMS.BIAS_MAX_BP;
  return (
    <span className="meter meter-bias" role="img" aria-label={`Price bias ${bias / 100} percent`}>
      <span className="meter-zero" />
      <span
        className={`meter-fill ${bias < 0 ? "neg" : "pos"}`}
        style={bias < 0 ? { right: "50%", width: `${half}%` } : { left: "50%", width: `${half}%` }}
      />
    </span>
  );
}

function sourceLabel(d: Decision): string {
  if (d.source === "llm") return IS_MOCK ? "AI decision (sample)" : "AI decision";
  if (d.source === "baseline") return "Rule-based";
  return "Kept as is";
}

function MindBody({ city, onNavigate }: { city: CityId; onNavigate: () => void }) {
  const { world } = useGame();
  const now = useNow();
  const { lang } = useLang();
  const toast = useToast();
  const merchant: Merchant | undefined = world?.merchants.find((m) => m.id === city);

  const { data, error, isLoading, mutate } = useSWR(
    ["decisions", city],
    async () => unwrap(await getApi().npcDecisions(city)),
    { refreshInterval: 10000 },
  );

  const rows = (data?.rows ?? []).slice().sort((a, b) => b.ts - a.ts).slice(0, 10);
  const lastLlm = rows.find((d) => d.source === "llm");
  const model = merchant?.verified?.model ?? lastLlm?.model ?? null;
  const requestId = merchant?.verified?.request_id ?? lastLlm?.request_id ?? null;
  const attested = merchant?.verified ? merchant.verified.attested : lastLlm ? lastLlm.attested : null;
  const hasEvidence = model !== null;
  const badge = evidenceBadge(attested, IS_MOCK);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.info("Copy failed. Select the text instead.");
    }
  };

  return (
    <div className="stack">
      <div className="mind-head">
        <PixelImage slot={`merchants/${CITY_META[city].portrait}`} w={96} h={96} alt={CITY_META[city].merchant} color="var(--dune)" label={CITY_META[city].merchant[0]} />
        <div className="stack-sm">
          <p className="strong">{CITY_META[city].merchant}, merchant of {CITY_META[city].name}</p>
          {merchant && <MoodChip mood={merchant.mood} lang={lang} />}
        </div>
      </div>

      {hasEvidence ? (
        <div className="panel-dim stack-sm">
          <span className={`badge ${badge.tone === "ok" ? "badge-ok" : ""}`} title={badge.hint}>
            {badge.text}
          </span>
          {IS_MOCK && <p className="muted small">Sample data from the demo world. No AI was called.</p>}
          {attested !== true && <p className="muted small">Evidence recorded, not yet attested.</p>}
          <dl className="kv">
            <dt>Model</dt>
            <dd>{model}</dd>
            {requestId && (
              <>
                <dt>Request id</dt>
                <dd>
                  <code title={requestId}>{shortId(requestId, 8, 6)}</code>{" "}
                  <button type="button" className="btn btn-small" onClick={() => copy(requestId)}>Copy</button>
                </dd>
              </>
            )}
          </dl>
          <Link href={`/play/proof/${city}`} className="link" onClick={onNavigate}>View raw evidence</Link>
        </div>
      ) : (
        <p className="muted small">No AI evidence yet. This merchant is following the basic pricing rules.</p>
      )}

      <h3 className="h3">Last decisions</h3>
      {isLoading && <LoadingBlock label="Loading decisions" rows={4} />}
      {error && !data && <ErrorState title="Could not load decisions" onRetry={() => void mutate()} />}
      {data && rows.length === 0 && <EmptyState title="No decisions yet">The merchant has not changed its prices since the game started.</EmptyState>}
      <ol className="decisions">
        {rows.map((d) => (
          <li key={`${d.ts}-${d.request_id ?? d.source}`} className="decision">
            <div className="decision-top">
              <span className="muted small">{now ? formatAgo(now, d.ts) : ""}</span>
              <MoodChip mood={d.mood} lang={lang} />
              <span className="chip">{sourceLabel(d)}</span>
            </div>
            <div className="decision-bars">
              <span className="small">Spread</span> <SpreadBar spread={d.spread_bp} />
              <span className="small">Bias</span> <BiasBar bias={d.bias_bp} />
            </div>
            <p className="decision-reason">{d.reason}</p>
            <p className="decision-line" lang={lang} dir={lang === "fa" ? "rtl" : "ltr"}>
              “{lang === "fa" ? d.line.fa : d.line.en}”
            </p>
            {d.ship && (
              <p className="muted small">Shipped {d.ship.qty} {d.ship.good} to {CITY_META[d.ship.to].name}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
