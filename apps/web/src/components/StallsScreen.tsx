"use client";

// Screen 9: player stalls. Players sell goods to each other in the same city at their own price.
// The buyer pays exactly qty x unit price; the SELLER pays the 2% market fee (contracts/caravan DECISIONS D5).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GOOD_IDS, PARAMS, type CityId, type GoodId, type Merchant, type Player, type Stall } from "@caravan/shared";
import { formatDinar, formatDinarDelta } from "../ui/format";
import { CITY_META, GOOD_META } from "../ui/game-meta";
import {
  MAX_OPEN_STALLS, buyProblem, createBlockReason, createHint, feeNote, maxStallBuyQty, myStalls, parseUnitPrice,
  plainDinar, priceVsMerchant, sellerLabel, sellerProceeds, stallErrorText, stallFee, stallPrice, stallsForSale, validateCreate,
} from "../ui/stall-math";
import { cargoUnits, maxSellQty, previewTrade } from "../ui/trade-math";
import { EmptyState, ErrorState, GoodIcon, LoadingBlock, Money, Page } from "./Bits";
import { useActions, useGame } from "./GameProvider";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

const goodsHeld = (me: Player): GoodId[] => GOOD_IDS.filter((g) => me.inventory[g] > 0);

/**
 * Whole-number box that can be emptied while typing (it never snaps back mid-edit), clamps to 1..max as digits are
 * typed and shows the clamped value again when it loses focus. Stepper buttons change `value` from outside.
 */
function QtyInput({ id, value, max, onChange, describedBy }: {
  id: string; value: number; max: number; onChange: (n: number) => void; describedBy?: string;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);
  return (
    <input
      id={id}
      className="qty-input num"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setText(String(value));
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/D/g, "").slice(0, 4);
        const n = parseInt(digits, 10);
        if (!Number.isFinite(n) || n < 1) {
          setText(digits);
          onChange(1);
          return;
        }
        const clamped = Math.min(n, Math.max(1, max));
        setText(String(clamped));
        onChange(clamped);
      }}
      aria-describedby={describedBy}
    />
  );
}

export function StallsScreen({ id }: { id: CityId }) {
  const { world, me, status, refresh } = useGame();
  const actions = useActions();
  const toast = useToast();
  const [buyId, setBuyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);

  if (status === "error" && !world) return <ErrorState onRetry={() => void refresh()}>The stalls could not be loaded.</ErrorState>;
  if (!world || !me) return <LoadingBlock label="Loading the stalls" rows={6} />;
  const merchant = world.merchants.find((x) => x.id === id);
  if (!merchant) return <EmptyState title="Unknown city" action={<Link className="btn" href="/play">Back to the map</Link>} />;

  const meta = CITY_META[id];
  const travelling = !!me.journey && me.journey.status !== "CLAIMED";
  const here = !travelling && me.location === id;
  const forSale = stallsForSale(world.stalls, id, me.account_id);
  const mine = myStalls(world.stalls, me.account_id);
  const buying = buyId === null ? null : (forSale.find((s) => s.id === buyId) ?? null);
  const blockReason = createBlockReason({
    travelling, here, hereName: CITY_META[me.location].name, hasGoods: goodsHeld(me).length > 0, openStalls: mine.length,
  });

  const cancel = async (s: Stall) => {
    setCancelling(s.id);
    const r = await actions.stallCancel({ stall_id: s.id });
    setCancelling(null);
    if (r.ok) toast.success(`Stall closed: ${s.qty} ${GOOD_META[s.good].name} back in your caravan.`);
  };

  return (
    <Page
      title={`Stalls in ${meta.name}`}
      subtitle="Players sell goods to each other at their own prices."
      actions={
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={blockReason !== null}
            aria-describedby={blockReason ? "create-block" : undefined}
            onClick={() => setCreating(true)}
          >
            Create a stall
          </button>
          <Link className="btn" href={`/play/city/${id}`}>Back to the market</Link>
        </div>
      }
    >
      {!here && (
        <div className="panel notice" role="status">
          {travelling ? (
            <p>Your caravan is on the road, so you cannot buy or open a stall right now. You can still look at what is for sale.</p>
          ) : (
            <p>
              You are in <strong>{CITY_META[me.location].name}</strong>. You can only buy from stalls in the city where you stand. Stalls here are for looking only.
            </p>
          )}
          <div className="row">
            {travelling ? (
              <Link className="btn btn-small btn-primary" href="/play/journey">See caravan</Link>
            ) : (
              <>
                <Link className="btn btn-small btn-primary" href={`/play/city/${me.location}/stalls`}>Stalls in {CITY_META[me.location].name}</Link>
                <Link className="btn btn-small" href={`/play/journey?to=${id}`}>Travel to {meta.name}</Link>
              </>
            )}
          </div>
        </div>
      )}

      <section aria-labelledby="forsale-h" className="stack-sm">
        <h2 id="forsale-h" className="h3">For sale in {meta.name}</h2>
        {forSale.length === 0 ? (
          <EmptyState title="No stalls here yet">
            Nobody else is selling in {meta.name} right now. Open a stall to sell your goods to other players, or trade with the merchant at the market.
          </EmptyState>
        ) : (
          <ul className="stalls">
            {forSale.map((s) => {
              const seller = sellerLabel(s.seller, me.account_id);
              const vs = priceVsMerchant(s.unit_price, merchant.quotes[s.good]);
              return (
                <li key={s.id} className="panel stall-row">
                  <div className="stall-main">
                    <GoodIcon good={s.good} />
                    <div className="stall-name">
                      <p className="strong">{GOOD_META[s.good].name}</p>
                      <p className="muted small">Sold by {seller}</p>
                    </div>
                  </div>
                  <div className="stall-qty">
                    <p><span className="num strong">{s.qty}</span> <span className="muted small">for sale</span></p>
                    {vs !== "same" && (
                      <span className={`chip ${vs === "below" ? "chip-cheap" : "chip-dear"}`}>{vs === "below" ? "Below merchant price" : "Above merchant price"}</span>
                    )}
                    <p className="muted small">Merchant asks <span className="num"><Money fils={merchant.quotes[s.good].ask} /></span></p>
                  </div>
                  <div className="stall-price">
                    <p className="muted small">Price each</p>
                    <p className="num price"><Money fils={s.unit_price} /></p>
                    <p className="muted small">All {s.qty}: <span className="num"><Money fils={stallPrice(s.unit_price, s.qty)} /></span></p>
                  </div>
                  <div className="stall-actions">
                    <button
                      type="button"
                      className="btn btn-good"
                      disabled={!here}
                      onClick={() => setBuyId(s.id)}
                      aria-label={`Buy ${GOOD_META[s.good].name} from ${seller}`}
                    >
                      Buy
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">The price shown is the whole price for the buyer. The seller pays the 2% market fee.</p>
      </section>

      <section aria-labelledby="mine-h" className="stack-sm">
        <h2 id="mine-h" className="h3">Your stalls ({mine.length} of {MAX_OPEN_STALLS})</h2>
        {blockReason && <p id="create-block" className="muted small">{blockReason}</p>}
        {mine.length === 0 ? (
          <EmptyState title="You have no stalls">
            Goods you list leave your caravan until they sell or you close the stall. Open one when you hold goods you want to sell to players.
          </EmptyState>
        ) : (
          <ul className="stalls">
            {mine.map((s) => {
              const price = stallPrice(s.unit_price, s.qty);
              const at = CITY_META[s.city].name;
              const away = travelling || me.location !== s.city;
              const closing = cancelling === s.id;
              return (
                <li key={s.id} className="panel stall-row stall-mine">
                  <div className="stall-main">
                    <GoodIcon good={s.good} />
                    <div className="stall-name">
                      <p className="strong">{GOOD_META[s.good].name}</p>
                      <p className="muted small">In {at}</p>
                    </div>
                  </div>
                  <div className="stall-qty">
                    <p><span className="num strong">{s.qty}</span> <span className="muted small">listed</span></p>
                  </div>
                  <div className="stall-price">
                    <p className="muted small">Price each</p>
                    <p className="num price"><Money fils={s.unit_price} /></p>
                    <p className="muted small">You get if all sell: <span className="num"><Money fils={sellerProceeds(price)} /></span></p>
                  </div>
                  <div className="stall-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={away || closing}
                      onClick={() => void cancel(s)}
                      aria-label={`Cancel your stall: ${s.qty} ${GOOD_META[s.good].name} in ${at}`}
                    >
                      {closing ? "Closing…" : "Cancel stall"}
                    </button>
                  </div>
                  {away && (
                    <p className="stall-note muted small">
                      {travelling
                        ? `Your caravan is on the road. Buyers can only buy while you are in ${at}. You can close this stall once you are back there.`
                        : <>You are in {CITY_META[me.location].name}. Buyers can only buy while you are in {at}, and you can only close the stall there. <Link className="link" href={`/play/journey?to=${s.city}`}>Travel to {at}</Link></>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BuySheet stallId={buyId} stall={buying} me={me} merchant={merchant} city={id} onClose={() => setBuyId(null)} />
      <CreateSheet open={creating} me={me} merchant={merchant} city={id} openStalls={mine.length} onClose={() => setCreating(false)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ buy */

function BuySheet({ stallId, stall, me, merchant, city, onClose }: {
  stallId: number | null; stall: Stall | null; me: Player; merchant: Merchant; city: CityId; onClose: () => void;
}) {
  const actions = useActions();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = stall !== null;

  useEffect(() => {
    setQty(1);
    setErr(null);
    setBusy(false);
  }, [stallId]);

  // The stall sold out or was closed while the sheet was open.
  useEffect(() => {
    if (stallId !== null && stall === null) {
      if (!err) toast.info("That stall is gone: it sold out or the seller closed it.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stallId, stall]);

  const fils = BigInt(me.fils);
  const carried = cargoUnits(me.inventory);
  const maxQty = stall ? maxStallBuyQty(stall, fils, carried) : 0;
  const q = Math.min(Math.max(1, qty), Math.max(1, stall?.qty ?? 1));
  const price = stall ? stallPrice(stall.unit_price, q) : 0n;
  const problem = stall ? buyProblem(stall, q, fils, carried) : null;
  const good = stall?.good ?? "grain";
  const seller = stall ? sellerLabel(stall.seller, me.account_id) : "";

  // an old server message goes away as soon as the player changes the amount
  useEffect(() => setErr(null), [q]);

  const confirm = async () => {
    if (!stall || problem || busy) return;
    setBusy(true);
    setErr(null);
    const r = await actions.stallBuy({ stall_id: stall.id, qty: q, good: stall.good, price });
    setBusy(false);
    if (r.ok) {
      toast.success(`Bought ${q} ${GOOD_META[good].name} from ${seller}: ${formatDinarDelta(-price)} dinars`);
      onClose();
    } else {
      setErr(stallErrorText("buy", r.error.code));
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Buy ${GOOD_META[good].name}`}
      footer={
        <>
          {(err ?? problem) && <p className="loss strong sheet-alert" role="alert">{err ?? problem}</p>}
          <button type="button" className="btn btn-lg btn-good grow" disabled={!stall || !!problem || busy} onClick={confirm}>
            {busy ? "Working…" : `Buy for ${formatDinar(price)}`}
          </button>
          <button type="button" className="btn btn-lg" onClick={onClose}>Cancel</button>
        </>
      }
    >
      {stall && (
        <div className="stack">
          <div className="row">
            <GoodIcon good={good} scale={2} />
            <div>
              <p className="strong">{GOOD_META[good].name} from {seller} in {CITY_META[city].name}</p>
              <p className="muted small">
                <span className="num">{stall.qty}</span> for sale. You have room for <span className="num">{Math.max(0, PARAMS.CARGO_CAP - carried)}</span>.
              </p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="stall-qty" className="strong">Quantity</label>
            <div className="stepper">
              <button type="button" className="btn btn-icon" onClick={() => setQty(Math.max(1, q - 1))} aria-label="Fewer" disabled={q <= 1}>−</button>
              <QtyInput id="stall-qty" value={q} max={stall.qty} onChange={setQty} describedBy="stall-qty-help" />
              <button type="button" className="btn btn-icon" onClick={() => setQty(Math.min(stall.qty, q + 1))} aria-label="More" disabled={q >= stall.qty}>+</button>
              <button type="button" className="btn" onClick={() => setQty(Math.max(1, maxQty))} disabled={maxQty < 1}>Max ({maxQty})</button>
            </div>
            <p id="stall-qty-help" className="muted small">{stall.qty === 1 ? "Only 1 unit is for sale." : `1 to ${stall.qty} units. Max is what you can afford and carry.`}</p>
          </div>

          <dl className="kv cost">
            <dt>Price each</dt><dd className="num"><Money fils={stall.unit_price} /></dd>
            <dt>Quantity</dt><dd className="num">{q}</dd>
            <dt className="strong">You pay</dt><dd className="num strong"><Money fils={price} /></dd>
            <dt>Dinars left</dt><dd className="num"><Money fils={price > fils ? 0n : fils - price} /></dd>
            <dt>Merchant asks</dt><dd className="num"><Money fils={merchant.quotes[good].ask} /></dd>
          </dl>
          <p className="panel-dim small" id="stall-fee-note">{feeNote(price)}</p>

        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ create */

function CreateSheet({ open, me, merchant, city, openStalls, onClose }: {
  open: boolean; me: Player; merchant: Merchant; city: CityId; openStalls: number; onClose: () => void;
}) {
  const actions = useActions();
  const toast = useToast();
  const held = useMemo(() => goodsHeld(me), [me]);
  const [good, setGood] = useState<GoodId>(held[0] ?? "grain");
  const [qty, setQty] = useState(1);
  const [priceInput, setPriceInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Every time the form opens: first good held, all of it, priced at the merchant's middle price.
  useEffect(() => {
    if (!open) return;
    const g = held[0] ?? "grain";
    setGood(g);
    setQty(Math.max(1, me.inventory[g]));
    setPriceInput(plainDinar(merchant.quotes[g].mid));
    setErr(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickGood = (g: GoodId) => {
    setGood(g);
    setQty(Math.max(1, me.inventory[g]));
    setPriceInput(plainDinar(merchant.quotes[g].mid));
    setErr(null);
  };

  const owned = me.inventory[good];
  const q = Math.min(Math.max(1, qty), Math.max(1, owned));
  const quote = merchant.quotes[good];
  const check = validateCreate({ good, qty: q, held: owned, priceInput, openStalls });
  const unit = check.unit;
  const total = unit !== null ? stallPrice(unit, q) : null;
  const fee = total !== null ? stallFee(total) : null;
  const hint = unit !== null ? createHint(unit, quote) : null;
  const cmpQty = Math.min(q, PARAMS.MAX_QTY_PER_TRADE);
  const canSell = maxSellQty(merchant, good, cmpQty);
  const viaMerchant = canSell > 0 ? previewTrade(merchant, good, "sell", canSell) : null;

  useEffect(() => setErr(null), [q, priceInput, good]);

  const confirm = async () => {
    if (check.problem || unit === null || busy) return;
    setBusy(true);
    setErr(null);
    const r = await actions.stallCreate({ good, qty: q, unit_price: unit.toString() });
    setBusy(false);
    if (r.ok) {
      toast.success(`Stall open: ${q} ${GOOD_META[good].name} at ${formatDinar(unit)} each`);
      onClose();
    } else {
      setErr(stallErrorText("create", r.error.code));
    }
  };

  const quick: Array<{ key: string; label: string; fils: string }> = [
    { key: "bid", label: "Merchant pays", fils: quote.bid },
    { key: "mid", label: "Middle", fils: quote.mid },
    { key: "ask", label: "Merchant asks", fils: quote.ask },
  ];
  const priceCheck = parseUnitPrice(priceInput);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Create a stall"
      footer={
        <>
          {(err ?? check.problem) && <p className="loss strong sheet-alert" role="alert">{err ?? check.problem}</p>}
          <button type="button" className="btn btn-lg btn-primary grow" disabled={!!check.problem || busy} onClick={confirm}>
            {busy ? "Working…" : "Open the stall"}
          </button>
          <button type="button" className="btn btn-lg" onClick={onClose}>Cancel</button>
        </>
      }
    >
      {held.length === 0 ? (
        <p>You hold no goods to sell. Buy some at the market first.</p>
      ) : (
        <div className="stack">
          <p className="muted small">
            Your goods wait in the stall in {CITY_META[city].name} until they sell or you close it.
          </p>

          <fieldset className="slip">
            <legend className="strong">Good</legend>
            <div className="row">
              {held.map((g) => (
                <label key={g} className={`pill pill-good ${good === g ? "on" : ""}`}>
                  <input type="radio" name="stall-good" className="sr-only" checked={good === g} onChange={() => pickGood(g)} />
                  <GoodIcon good={g} />
                  <span>{GOOD_META[g].name}</span>
                  <span className="small">you hold <span className="num">{me.inventory[g]}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="stall-create-qty" className="strong">Quantity</label>
            <div className="stepper">
              <button type="button" className="btn btn-icon" onClick={() => setQty(Math.max(1, q - 1))} aria-label="Fewer" disabled={q <= 1}>−</button>
              <QtyInput id="stall-create-qty" value={q} max={owned} onChange={setQty} describedBy="stall-create-qty-help" />
              <button type="button" className="btn btn-icon" onClick={() => setQty(Math.min(owned, q + 1))} aria-label="More" disabled={q >= owned}>+</button>
              <button type="button" className="btn" onClick={() => setQty(owned)} disabled={q >= owned}>All ({owned})</button>
            </div>
            <p id="stall-create-qty-help" className="muted small">{owned === 1 ? "You hold 1." : `1 to ${owned}, what you hold.`}</p>
          </div>

          <div className="field">
            <label htmlFor="stall-price" className="strong">Price for each unit (dinars)</label>
            <input
              id="stall-price"
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              aria-invalid={!priceCheck.ok || undefined}
              aria-describedby="stall-price-help"
            />
            <p id="stall-price-help" className="muted small">
              In {CITY_META[city].name} the merchant pays <span className="num">{formatDinar(quote.bid)}</span> and asks <span className="num">{formatDinar(quote.ask)}</span> for one {GOOD_META[good].name}.
            </p>
            <div className="row">
              {quick.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className="btn btn-small"
                  onClick={() => setPriceInput(plainDinar(o.fils))}
                  aria-label={`Use ${formatDinar(o.fils)}, ${o.label.toLowerCase()}`}
                >
                  {o.label} <span className="num">{formatDinar(o.fils)}</span>
                </button>
              ))}
            </div>
            {hint && <p className={`small strong ${hint.tone === "good" ? "profit" : "loss"}`}>{hint.text}</p>}
          </div>

          {unit !== null && total !== null && fee !== null && (
            <dl className="kv cost">
              <dt>Buyers pay for all {q}</dt><dd className="num"><Money fils={total} /></dd>
              <dt>Market fee (2%, you pay it)</dt><dd className="num"><Money fils={-fee} sign /></dd>
              <dt className="strong">You get if all sell</dt><dd className="num strong"><Money fils={total - fee} /></dd>
              {viaMerchant && (
                <>
                  <dt>{canSell < cmpQty ? `Selling ${canSell} to the merchant now` : "Selling to the merchant now"}</dt>
                  <dd className="num"><Money fils={viaMerchant.net} /></dd>
                </>
              )}
            </dl>
          )}
          <p className="muted small">
            The fee is 2% of each sale, rounded up (at least 0.01 dinars), and comes out of your share. Buyers pay only the price.
          </p>

        </div>
      )}
    </Sheet>
  );
}
