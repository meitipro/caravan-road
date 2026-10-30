"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GOODS, GOOD_IDS, PARAMS, findRoute, type CityId, type GoodId, type Merchant, type Player, type Side } from "@caravan/shared";
import { basisCost } from "../ui/basis";
import { formatBp, formatDinar, formatDinarDelta, formatEta } from "../ui/format";
import { CITY_META, GOOD_META } from "../ui/game-meta";
import {
  cargoUnits, limitWithSlippage, maxBuyQty, maxSellQty, previewTrade, priceBand, riskWithGuards,
} from "../ui/trade-math";
import { EmptyState, ErrorState, GoodIcon, LoadingBlock, Money, MoodChip, Page, StockBar } from "./Bits";
import { useActions, useGame } from "./GameProvider";
import { useLang } from "./Lang";
import { useMind } from "./Mind";
import { PixelImage } from "./PixelImage";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

const SLIPPAGE_OPTIONS = [50, 100, 200, 500] as const; // basis points; default 2%

export function CityScreen({ id }: { id: CityId }) {
  const { world, me, status, refresh, trend } = useGame();
  const { lang } = useLang();
  const mind = useMind();
  const [trade, setTrade] = useState<{ good: GoodId; side: Side } | null>(null);

  if (status === "error" && !world) return <ErrorState onRetry={() => void refresh()}>The market could not be loaded.</ErrorState>;
  if (!world || !me) return <LoadingBlock label="Loading the market" rows={6} />;
  const m = world.merchants.find((x) => x.id === id);
  if (!m) return <EmptyState title="Unknown city" action={<Link className="btn" href="/play">Back to the map</Link>} />;

  const meta = CITY_META[id];
  const traveling = !!me.journey && me.journey.status !== "CLAIMED";
  const here = !traveling && me.location === id;
  const route = findRoute(me.location, id);
  const line = m.last_line ? (lang === "fa" ? m.last_line.fa : m.last_line.en) : null;

  return (
    <Page
      title={meta.name}
      subtitle={`${meta.role}. Merchant ${meta.merchant}.`}
      actions={
        <Link className="btn" href="/play/journey">
          {traveling ? "See caravan" : "Plan a journey"}
        </Link>
      }
    >
      {!here && (
        <div className="panel notice" role="status">
          {traveling ? (
            <p>Your caravan is on the road, so you cannot trade right now. You can still look at prices here.</p>
          ) : (
            <p>
              You are in <strong>{CITY_META[me.location].name}</strong>. Prices here are for looking only. To trade in {meta.name}, travel there
              {route && <> ({formatEta(route.durationSec)}, {formatBp(riskWithGuards(me.location, id, 0))} ambush risk)</>}.
            </p>
          )}
          <div className="row">
            <Link className="btn btn-small btn-primary" href={traveling ? "/play/journey" : `/play/journey?to=${id}`}>
              {traveling ? "See caravan" : `Travel to ${meta.name}`}
            </Link>
            {!traveling && <Link className="btn btn-small" href={`/play/city/${me.location}`}>Back to {CITY_META[me.location].name}</Link>}
          </div>
        </div>
      )}

      <div className="market-top">
        <div className="panel merchant-card">
          <div className="only-narrow"><PixelImage slot={`cities/${id}`} w={320} h={180} scale={1} alt={`${meta.name} skyline`} color="var(--dune)" label={meta.name} className="city-art" /></div>
          <div className="only-wide"><PixelImage slot={`cities/${id}`} w={320} h={180} scale={2} alt={`${meta.name} skyline`} color="var(--dune)" label={meta.name} className="city-art" /></div>
          <div className="merchant-row">
            <PixelImage slot={`merchants/${meta.portrait}`} w={96} h={96} alt={meta.merchant} color="var(--terracotta)" label={meta.merchant[0]} />
            <div className="bubble" lang={lang} dir={lang === "fa" ? "rtl" : "ltr"}>
              <p>{line ? `“${line}”` : lang === "fa" ? "…" : "The merchant is watching the market."}</p>
              <div className="row bubble-meta">
                <MoodChip mood={m.mood} lang={lang} />
                <button type="button" className="btn btn-small" onClick={() => mind.open(id)}>Why this price?</button>
              </div>
            </div>
          </div>
        </div>
        <div className="panel stack-sm purse">
          <p className="muted small">Your dinars</p>
          <p className="purse-amount"><Money fils={me.fils} /></p>
          <p className="muted small">Cargo {cargoUnits(me.inventory)} of {PARAMS.CARGO_CAP} units</p>
          <p className="muted small">Merchant treasury <Money fils={m.treasury} /></p>
        </div>
      </div>

      <section aria-labelledby="goods-h" className="stack-sm">
        <h2 id="goods-h" className="h3">Goods</h2>
        <ul className="goods">
          {GOOD_IDS.map((g) => {
            const q = m.quotes[g];
            const band = priceBand(BigInt(q.mid), g);
            const t = trend(id, g);
            const owned = me.inventory[g];
            const spec = GOODS[g];
            return (
              <li key={g} className="panel good-row">
                <div className="good-main">
                  <GoodIcon good={g} />
                  <div className="good-name">
                    <p className="strong">{GOOD_META[g].name}</p>
                    {band !== "fair" && <span className={`chip chip-${band}`}>{band === "cheap" ? "Cheap" : "Dear"}</span>}
                  </div>
                </div>
                <div className="good-stock">
                  <StockBar stock={m.stock[g]} target={spec.target} cap={spec.cap} color={GOOD_META[g].color === "var(--cloth)" ? "var(--sky)" : GOOD_META[g].color} />
                  <p className="muted small"><span className="num">{m.stock[g]}</span> in stock, target {spec.target}</p>
                </div>
                <div className="good-prices">
                  <div>
                    <p className="muted small">Buy at</p>
                    <p className="num price">
                      <Money fils={q.ask} />
                      {t !== "flat" && <span className={`trend trend-${t}`} aria-label={t === "up" ? "price rising" : "price falling"}>{t === "up" ? "▲" : "▼"}</span>}
                    </p>
                  </div>
                  <div>
                    <p className="muted small">Sell at</p>
                    <p className="num price"><Money fils={q.bid} /></p>
                  </div>
                </div>
                <div className="good-actions">
                  <p className="muted small">You hold <span className="num">{owned}</span></p>
                  <div className="row">
                    <button type="button" className="btn btn-good" disabled={!here} onClick={() => setTrade({ good: g, side: "buy" })} aria-label={`Buy ${GOOD_META[g].name}`}>Buy</button>
                    <button type="button" className="btn" disabled={!here || owned === 0} onClick={() => setTrade({ good: g, side: "sell" })} aria-label={`Sell ${GOOD_META[g].name}`}>Sell</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Prices include a small spread. Each trade pays a 1% fee and moves the price a little.</p>
      </section>

      <TradeSheet city={id} merchant={m} me={me} trade={trade} onClose={() => setTrade(null)} />
    </Page>
  );
}

function TradeSheet({ city, merchant, me, trade, onClose }: {
  city: CityId; merchant: Merchant; me: Player; trade: { good: GoodId; side: Side } | null; onClose: () => void;
}) {
  const actions = useActions();
  const { basis } = useGame();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [slip, setSlip] = useState<number>(200);
  const [busy, setBusy] = useState(false);
  const open = trade !== null;
  const good = trade?.good ?? "grain";
  const side = trade?.side ?? "buy";

  const fils = BigInt(me.fils);
  const carried = cargoUnits(me.inventory);
  const maxQty = useMemo(
    () => (side === "buy" ? maxBuyQty(merchant, good, fils, carried) : maxSellQty(merchant, good, me.inventory[good])),
    [side, merchant, good, fils, carried, me.inventory],
  );

  // Choose a sensible starting quantity every time the sheet opens.
  useEffect(() => {
    if (!trade) return;
    const start = trade.side === "buy" ? Math.min(10, maxBuyQty(merchant, trade.good, fils, carried)) : maxSellQty(merchant, trade.good, me.inventory[trade.good]);
    setQty(Math.max(1, start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.good, trade?.side]);

  const q = Math.min(Math.max(1, qty), Math.max(1, PARAMS.MAX_QTY_PER_TRADE));
  const p = open ? previewTrade(merchant, good, side, q) : null;

  let problem: string | null = null;
  if (open && p) {
    if (side === "buy") {
      if (merchant.stock[good] < q) problem = "The merchant does not have that much.";
      else if (carried + q > PARAMS.CARGO_CAP) problem = "Your caravan holds 40 units at most.";
      else if (p.net > fils) problem = "Not enough dinars.";
    } else if (me.inventory[good] < q) problem = "You do not have that much.";
    else if (merchant.stock[good] + q > GOODS[good].cap) problem = "The merchant's warehouse is full.";
    else if (BigInt(merchant.treasury) < p.total) problem = `${CITY_META[city].merchant} can only pay for ${maxQty} unit${maxQty === 1 ? "" : "s"} right now. Tap Max.`;
  }

  const confirm = async () => {
    if (!p || problem) return;
    setBusy(true);
    const limit = limitWithSlippage(side, p.net, slip);
    const cost = side === "sell" ? basisCost(basis, good, q) : null;
    const r = await actions.trade({ merchant: city, good, side, qty: q, limit_total: limit.toString() });
    setBusy(false);
    if (r.ok) {
      const total = BigInt(r.data.total);
      const fee = BigInt(r.data.fee);
      if (side === "buy") {
        toast.success(`Bought ${q} ${GOOD_META[good].name}: ${formatDinarDelta(-(total + fee))} dinars`);
      } else {
        const gain = total - fee;
        const profit = cost !== null ? ` (${formatDinarDelta(gain - cost)} profit)` : "";
        toast.success(`Sold ${q} ${GOOD_META[good].name}: ${formatDinarDelta(gain)} dinars${profit}`);
      }
      onClose();
    }
  };

  const owned = me.inventory[good];
  const paid = side === "sell" && p ? basisCost(basis, good, q) : null;
  const profit = paid !== null && p ? p.net - paid : null;
  const limit = p ? limitWithSlippage(side, p.net, slip) : 0n;
  const title = `${side === "buy" ? "Buy" : "Sell"} ${GOOD_META[good].name}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className={`btn btn-lg ${side === "buy" ? "btn-good" : "btn-primary"} grow`} disabled={!p || !!problem || busy} onClick={confirm}>
            {busy ? "Working…" : side === "buy" ? `Buy for ${p ? formatDinar(p.net) : "0.00"}` : `Sell for ${p ? formatDinar(p.net) : "0.00"}`}
          </button>
          <button type="button" className="btn btn-lg" onClick={onClose}>Cancel</button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <GoodIcon good={good} scale={2} />
          <div>
            <p className="strong">{GOOD_META[good].name} in {CITY_META[city].name}</p>
            <p className="muted small">
              {side === "buy" ? `${merchant.stock[good]} in stock. You have room for ${Math.max(0, PARAMS.CARGO_CAP - carried)}.` : `You hold ${owned}.`}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="qty" className="strong">Quantity</label>
          <div className="stepper">
            <button type="button" className="btn btn-icon" onClick={() => setQty(Math.max(1, q - 1))} aria-label="Fewer" disabled={q <= 1}>−</button>
            <input
              id="qty"
              className="qty-input num"
              inputMode="numeric"
              value={q}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                setQty(Number.isFinite(n) ? Math.min(n, PARAMS.MAX_QTY_PER_TRADE) : 1);
              }}
              aria-describedby="qty-help"
            />
            <button type="button" className="btn btn-icon" onClick={() => setQty(Math.min(PARAMS.MAX_QTY_PER_TRADE, q + 1))} aria-label="More" disabled={q >= PARAMS.MAX_QTY_PER_TRADE}>+</button>
            <button type="button" className="btn" onClick={() => setQty(Math.max(1, maxQty))} disabled={maxQty < 1}>Max ({maxQty})</button>
          </div>
          <p id="qty-help" className="muted small">1 to {PARAMS.MAX_QTY_PER_TRADE} units per trade.</p>
        </div>

        {p && (
          <dl className="kv cost">
            <dt>Price each (at this size)</dt><dd className="num"><Money fils={p.unit} /></dd>
            <dt>Subtotal</dt><dd className="num"><Money fils={p.total} /></dd>
            <dt>Fee (1%)</dt><dd className="num"><Money fils={p.fee} /></dd>
            <dt className="strong">{side === "buy" ? "You pay" : "You receive"}</dt><dd className="num strong"><Money fils={p.net} /></dd>
            {side === "buy" && (<><dt>Dinars left</dt><dd className="num"><Money fils={p.net > fils ? 0n : fils - p.net} /></dd></>)}
            {profit !== null && (<><dt>Profit on these units</dt><dd className="num"><Money fils={profit} sign /></dd></>)}
          </dl>
        )}

        <fieldset className="slip">
          <legend className="strong">Allowed price change</legend>
          <div className="row">
            {SLIPPAGE_OPTIONS.map((o) => (
              <label key={o} className={`pill ${slip === o ? "on" : ""}`}>
                <input type="radio" name="slip" className="sr-only" checked={slip === o} onChange={() => setSlip(o)} />
                {formatBp(o)}
              </label>
            ))}
          </div>
          <p className="muted small">
            {side === "buy" ? "You will never pay more than " : "You will never receive less than "}
            <strong>{formatDinar(limit)}</strong> dinars. If the price moves further, the trade is cancelled.
          </p>
        </fieldset>

        {problem && <p className="loss strong" role="alert">{problem}</p>}
      </div>
    </Sheet>
  );
}
