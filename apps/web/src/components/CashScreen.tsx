"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import qrcode from "qrcode-generator";
import { PARAMS, type DepositQuoteData, type Mode } from "@caravan/shared";
import { CAN_PREVIEW_LIVE, getApi, unwrap } from "../ui/api";
import {
  CASH_ASSETS, addressHint, assetById, isValidAddress, mapCashStatus, type CashAsset, type CashStatus,
} from "../ui/cash-assets";
import { cannedDepositQuote, cannedDepositStatus, cannedWithdraw } from "../ui/cash-canned";
import { formatDinar, formatEta, formatUnits, parseDinar, parseUnits, shortId } from "../ui/format";
import { ErrorState, LoadingBlock, Money, Page } from "./Bits";
import { useFaucet } from "./Faucet";
import { useGame } from "./GameProvider";
import { AdvancedDrawer } from "./Advanced";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export function CashScreen() {
  const { world, me, status, refresh } = useGame();
  const params = useSearchParams();
  const [advanced, setAdvanced] = useState(false);
  const demoLive = CAN_PREVIEW_LIVE && params?.get("live") === "1";

  if (status === "error" && !world) return <ErrorState onRetry={() => void refresh()}>Your cash could not be loaded.</ErrorState>;
  if (!world || !me) return <LoadingBlock label="Loading your cash" rows={4} />;
  const mode: Mode = demoLive ? "LIVE" : world.mode;

  return (
    <Page
      title="Cash"
      subtitle={mode === "PLAY" ? "Practice mode: free dinars, no real money." : "Real USDC, real stakes. Caps apply."}
      actions={<button type="button" className="btn btn-small" onClick={() => setAdvanced(true)}>Advanced</button>}
    >
      <section className="panel stack-sm balance-card" aria-labelledby="bal-h">
        <h2 id="bal-h" className="muted small">Your dinars</h2>
        <p className="big-balance"><Money fils={me.fils} /></p>
        <p className="muted small">Net worth <Money fils={me.net_worth} /> (dinars plus goods at base prices)</p>
      </section>

      {mode === "PLAY" ? <PlayCash /> : <LiveCash demo={demoLive} />}

      <AdvancedDrawer open={advanced} onClose={() => setAdvanced(false)} accountId={me.account_id} mode={mode} />
    </Page>
  );
}

function PlayCash() {
  const { claim, busy, left } = useFaucet();
  return (
    <>
      <section className="panel stack" aria-labelledby="faucet-h">
        <h2 id="faucet-h" className="h3">Free dinars</h2>
        <p>Claim {formatDinar(String(PARAMS.FAUCET_FILS))} free dinars any time you run low. A short wait applies between claims.</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={claim} disabled={busy || left > 0}>
          {busy ? "Claiming…" : left > 0 ? `Wait ${left}s` : `Claim ${formatDinar(String(PARAMS.FAUCET_FILS))} dinars`}
        </button>
      </section>
      <section className="panel stack-sm" aria-labelledby="off-h">
        <h2 id="off-h" className="h3">Deposits and withdrawals</h2>
        <p className="muted">Switched off in practice mode. Only the live game moves real money, with strict limits.</p>
        <div className="row">
          <button type="button" className="btn" disabled>Deposit</button>
          <button type="button" className="btn" disabled>Withdraw</button>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ LIVE */

function LiveCash({ demo }: { demo: boolean }) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  return (
    <section className="stack" aria-label="Deposit and withdraw">
      {demo && <p className="panel-dim small">Preview with sample data. Nothing real is happening.</p>}
      <div className="tabs" role="tablist" aria-label="Cash actions">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
            {t === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "deposit" ? <Deposit demo={demo} /> : <Withdraw demo={demo} />}
      </div>
    </section>
  );
}

function Deposit({ demo }: { demo: boolean }) {
  const toast = useToast();
  const { refresh } = useGame();
  const [assetId, setAssetId] = useState(CASH_ASSETS[0]!.id);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DepositQuoteData | null>(null);
  const asset = assetById(assetId) as CashAsset;
  const units = parseUnits(amount, asset.decimals);
  const refundOk = isValidAddress(asset.kind, refund);
  const valid = units !== null && units > 0n && refundOk;

  const submit = async () => {
    if (!valid || units === null) return;
    setBusy(true);
    const body = { origin_asset: asset.id, amount_in: units.toString(), refund_address: refund.trim() };
    const r = demo ? await cannedDepositQuote(body) : await getApi().depositQuote(body);
    setBusy(false);
    if (r.ok) setQuote(r.data);
    else toast.error(r.error);
  };

  if (quote) {
    return (
      <DepositWait
        quote={quote}
        asset={asset}
        demo={demo}
        onDone={() => {
          setQuote(null);
          setAmount("");
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="panel stack">
      <p className="muted small">Total deposits are capped at {formatDinar(String(PARAMS.MAX_DEPOSIT_FILS))} dinars (20 USDC) per player.</p>
      <div className="field">
        <label htmlFor="dep-asset" className="strong">Asset to send</label>
        <select id="dep-asset" className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {CASH_ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="dep-amount" className="strong">Amount ({asset.symbol})</label>
        <input id="dep-amount" className="input" inputMode="decimal" placeholder="5" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && units === null} aria-describedby="dep-amount-h" />
        <p id="dep-amount-h" className={`small ${amount !== "" && units === null ? "loss" : "muted"}`}>
          {amount !== "" && units === null ? `Enter a number with at most ${asset.decimals} decimals.` : "You will see how many dinars you get before you send anything."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="dep-refund" className="strong">Refund address</label>
        <input id="dep-refund" className="input" value={refund} onChange={(e) => setRefund(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={refund !== "" && !refundOk} aria-describedby="dep-refund-h" />
        <p id="dep-refund-h" className={`small ${refund !== "" && !refundOk ? "loss" : "muted"}`}>
          Where we send your money back if something fails. {addressHint(asset.kind)}.
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-lg" disabled={!valid || busy} onClick={submit}>
        {busy ? "Getting a quote…" : "Get deposit address"}
      </button>
    </div>
  );
}

function Qr({ text }: { text: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const out: Array<[number, number]> = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) out.push([x, y]);
    return { n, out };
  }, [text]);
  const q = 2;
  return (
    <svg className="qr" viewBox={`0 0 ${cells.n + q * 2} ${cells.n + q * 2}`} shapeRendering="crispEdges" role="img" aria-label="QR code of the deposit address">
      <rect width="100%" height="100%" fill="var(--cloth)" />
      {cells.out.map(([x, y]) => <rect key={`${x}-${y}`} x={x + q} y={y + q} width="1" height="1" fill="var(--ink)" />)}
    </svg>
  );
}

const STATUS_STEPS: Array<{ id: CashStatus; label: string }> = [
  { id: "waiting", label: "Waiting for your deposit" },
  { id: "processing", label: "Processing" },
  { id: "credited", label: "Credited" },
];

function DepositWait({ quote, asset, demo, onDone }: { quote: DepositQuoteData; asset: CashAsset; demo: boolean; onDone: () => void }) {
  const toast = useToast();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { data } = useSWR(
    ["deposit-status", quote.quote_id],
    async () => unwrap(demo ? await cannedDepositStatus(quote.quote_id) : await getApi().depositStatus(quote.quote_id)),
    { refreshInterval: (d) => (d && ["credited", "expired", "refunded", "failed"].includes(mapCashStatus(d.status)) ? 0 : 3000) },
  );
  const status: CashStatus = data ? mapCashStatus(data.status) : "waiting";
  const left = quote.deadline - now;
  const final = status === "credited" || status === "expired" || status === "refunded" || status === "failed";

  const copy = async (t: string, what: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success(`${what} copied`);
    } catch {
      toast.info("Copy failed. Select the text instead.");
    }
  };

  return (
    <div className="panel stack">
      <ol className="steps" aria-label="Deposit progress">
        {STATUS_STEPS.map((s, i) => {
          const idx = STATUS_STEPS.findIndex((x) => x.id === (status === "credited" ? "credited" : status === "processing" ? "processing" : "waiting"));
          return <li key={s.id} className={`step ${i < idx || (status === "credited" && i === idx) ? "done" : i === idx ? "now" : ""}`}>{s.label}</li>;
        })}
      </ol>

      {status === "credited" && (
        <div className="panel-dim stack-sm" role="status">
          <p className="strong profit">Credited: {data?.fils_credited ? <Money fils={data.fils_credited} /> : "your dinars are in"}</p>
          <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
        </div>
      )}
      {status === "expired" && (
        <div className="panel-dim stack-sm" role="alert">
          <p className="strong loss">This quote expired. If you already sent money, it will be refunded to your refund address.</p>
          <button type="button" className="btn" onClick={onDone}>Start again</button>
        </div>
      )}
      {status === "refunded" && (
        <div className="panel-dim stack-sm" role="alert">
          <p className="strong">Refunded. Your money went back to your refund address.</p>
          <button type="button" className="btn" onClick={onDone}>Start again</button>
        </div>
      )}
      {status === "failed" && (
        <div className="panel-dim stack-sm" role="alert">
          <p className="strong loss">The deposit failed. Nothing was credited.</p>
          <button type="button" className="btn" onClick={onDone}>Start again</button>
        </div>
      )}

      {!final && (
        <>
          <p>
            Send exactly <strong>{formatUnits(BigInt(quote.amount_in), asset.decimals)} {asset.symbol}</strong> on the <strong>{asset.label}</strong> network to this address.
            You will receive about <Money fils={quote.expected_fils} />.
          </p>
          <div className="deposit-grid">
            <Qr text={quote.deposit_address} />
            <div className="stack-sm">
              <p className="muted small">Deposit address</p>
              <code className="addr">{quote.deposit_address}</code>
              <div className="row">
                <button type="button" className="btn btn-small" onClick={() => copy(quote.deposit_address, "Address")}>Copy address</button>
                <button type="button" className="btn btn-small" onClick={() => copy(formatUnits(BigInt(quote.amount_in), asset.decimals), "Amount")}>Copy amount</button>
              </div>
              <p className={`strong ${left <= 60 ? "loss" : ""}`} role="timer">Time left: <span className="num">{formatEta(left)}</span></p>
              {left <= 0 && <p className="loss small">The deadline passed. Do not send anything new to this address.</p>}
            </div>
          </div>
          <p className="muted small">Quote {shortId(quote.quote_id, 6, 4)}. We check automatically every few seconds.</p>
        </>
      )}
    </div>
  );
}

function Withdraw({ demo }: { demo: boolean }) {
  const toast = useToast();
  const { me, refresh } = useGame();
  const [assetId, setAssetId] = useState(CASH_ASSETS[0]!.id);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; status: string } | null>(null);
  const asset = assetById(assetId) as CashAsset;
  const fils = parseDinar(amount);
  const balance = BigInt(me?.fils ?? "0");
  const cap = BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS);
  const addrOk = isValidAddress(asset.kind, address);
  let problem: string | null = null;
  if (fils !== null && fils <= 0n) problem = "Enter an amount above zero.";
  else if (fils !== null && fils > balance) problem = "That is more than your balance.";
  else if (fils !== null && fils > cap) problem = `The daily limit is ${formatDinar(cap)} dinars.`;
  const valid = fils !== null && problem === null && addrOk;

  const send = async () => {
    if (!valid || fils === null) return;
    setBusy(true);
    const body = { fils: fils.toString(), dest_asset: asset.id, dest_address: address.trim() };
    const r = demo ? await cannedWithdraw() : await getApi().withdraw(body);
    setBusy(false);
    setConfirm(false);
    if (r.ok) {
      setDone({ id: r.data.request_id, status: r.data.status });
      setAmount("");
      void refresh();
    } else toast.error(r.error);
  };

  if (done) {
    const st = mapCashStatus(done.status);
    return (
      <div className="panel stack" role="status">
        <p className="strong">{st === "credited" ? "Sent." : "Withdrawal requested."}</p>
        <p className="muted small">Request {shortId(done.id, 6, 4)} is {st === "credited" ? "complete" : st === "failed" ? "failed" : "being processed"}. It usually takes a few minutes.</p>
        <button type="button" className="btn" onClick={() => setDone(null)}>Make another</button>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <p className="muted small">Daily limit {formatDinar(cap)} dinars (10 USDC). Balance <Money fils={balance} />.</p>
      <div className="field">
        <label htmlFor="wd-amount" className="strong">Amount (dinars)</label>
        <input id="wd-amount" className="input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && (fils === null || !!problem)} aria-describedby="wd-amount-h" />
        <p id="wd-amount-h" className={`small ${amount !== "" && (fils === null || problem) ? "loss" : "muted"}`}>
          {amount !== "" && fils === null ? "Enter a number with at most 2 decimals." : problem ?? "100 dinars is 1 USDC."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="wd-asset" className="strong">Receive as</label>
        <select id="wd-asset" className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {CASH_ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wd-addr" className="strong">Destination address</label>
        <input id="wd-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={address !== "" && !addrOk} aria-describedby="wd-addr-h" />
        <p id="wd-addr-h" className={`small ${address !== "" && !addrOk ? "loss" : "muted"}`}>{addressHint(asset.kind)}. Double-check it: transfers cannot be undone.</p>
      </div>
      <button type="button" className="btn btn-primary btn-lg" disabled={!valid} onClick={() => setConfirm(true)}>Review withdrawal</button>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm withdrawal"
        footer={
          <>
            <button type="button" className="btn btn-primary btn-lg grow" disabled={busy} onClick={send}>{busy ? "Sending…" : "Confirm and withdraw"}</button>
            <button type="button" className="btn btn-lg" onClick={() => setConfirm(false)}>Back</button>
          </>
        }
      >
        <dl className="kv cost">
          <dt>Amount</dt><dd>{fils !== null ? <Money fils={fils} /> : "-"}</dd>
          <dt>Receive as</dt><dd>{asset.label}</dd>
          <dt>To</dt><dd><code className="addr">{address.trim()}</code></dd>
        </dl>
        <p className="muted small">Make sure the address is on the {asset.label} network. Mistakes cannot be reversed.</p>
      </Sheet>
    </div>
  );
}
