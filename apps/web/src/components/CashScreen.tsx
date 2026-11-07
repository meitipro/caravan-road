"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import qrcode from "qrcode-generator";
import { PARAMS, type DepositQuoteData, type Mode } from "@caravan/shared";
import { ApiError, CAN_PREVIEW_LIVE, IS_MOCK, getApi, unwrap } from "../ui/api";
import {
  addressHint, assetById, assetsFromTokens, cashStatusText, defaultAssetId, isFinalCashStatus, isValidAddress, mapCashStatus,
  type CashAsset, type CashStatus,
} from "../ui/cash-assets";
import { cannedDepositQuote, cannedDepositStatus, cannedWithdraw } from "../ui/cash-canned";
import { MIN_WITHDRAW, cashErrorText, withdrawProblem } from "../ui/cash-rules";
import { formatCoins, formatEta, formatUnits, parseCoins, parseUnits, shortId } from "../ui/format";
import { EmptyState, ErrorState, LoadingBlock, Money, Page } from "./Bits";
import { claimLabel, useFaucet } from "./Faucet";
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
      subtitle={mode === "PLAY" ? "Practice mode: free coins, no real money." : "Real USDC, real stakes. Caps apply."}
      actions={<button type="button" className="btn btn-small" onClick={() => setAdvanced(true)}>Advanced</button>}
    >
      <section className="panel stack-sm balance-card" aria-labelledby="bal-h">
        <h2 id="bal-h" className="muted small">Your coins</h2>
        <p className="big-balance"><Money fils={me.fils} /></p>
        <p className="muted small">Net worth <Money fils={me.net_worth} /> (coins plus goods at base prices)</p>
      </section>

      {mode === "PLAY" ? <PlayCash /> : <LiveCash demo={demoLive} />}

      <AdvancedDrawer open={advanced} onClose={() => setAdvanced(false)} accountId={me.account_id} mode={mode} />
    </Page>
  );
}

function PlayCash() {
  const { claim, busy, left, reason } = useFaucet();
  return (
    <>
      <section className="panel stack" aria-labelledby="faucet-h">
        <h2 id="faucet-h" className="h3">Free coins</h2>
        <p>
          Claim {formatCoins(String(PARAMS.FAUCET_FILS))} free coins when you run low.{" "}
          {IS_MOCK ? "A short wait applies between claims." : "You can claim once an hour, and only while everything you own (coins, goods, stalls and cargo on the road) is worth less than 50 coins."}
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={claim} disabled={busy || reason !== null}>
          {claimLabel(busy, left)}
        </button>
        {reason && !IS_MOCK && <p className="small" role="status">{reason}</p>}
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
  // The assets 1Click supports (real ids). In the demo the shared client answers with a static sample list.
  const { data, error, isLoading, mutate } = useSWR(
    ["tokens", demo],
    async () => assetsFromTokens(unwrap(await getApi().tokens()).assets),
    { revalidateOnFocus: false, dedupingInterval: 60_000, shouldRetryOnError: false },
  );
  if (isLoading || (!data && !error)) return <LoadingBlock label="Loading the assets you can use" rows={3} />;
  if (error || !data) {
    const text = error instanceof ApiError ? cashErrorText({ code: error.code, message: error.message }) : "The list of assets could not be loaded.";
    return <ErrorState title="Deposits and withdrawals are unavailable" onRetry={() => void mutate()}>{text}</ErrorState>;
  }
  if (data.length === 0) {
    return (
      <EmptyState title="No assets available right now" action={<button type="button" className="btn" onClick={() => void mutate()}>Check again</button>}>
        The payment service did not list any asset we can use. Try again in a few minutes.
      </EmptyState>
    );
  }
  const assets = data;
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
        {tab === "deposit" ? <Deposit demo={demo} assets={assets} /> : <Withdraw demo={demo} assets={assets} />}
      </div>
    </section>
  );
}

function Deposit({ demo, assets }: { demo: boolean; assets: CashAsset[] }) {
  const toast = useToast();
  const { refresh } = useGame();
  const [assetId, setAssetId] = useState(() => defaultAssetId(assets));
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DepositQuoteData | null>(null);
  const asset = (assetById(assets, assetId) ?? assets[0]) as CashAsset;
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
    else toast.push("error", cashErrorText(r.error));
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
      <p className="muted small">Total deposits are capped at {formatCoins(String(PARAMS.MAX_DEPOSIT_FILS))} coins (20 USDC) per player.</p>
      <div className="field">
        <label htmlFor="dep-asset" className="strong">Asset to send</label>
        <select id="dep-asset" className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="dep-amount" className="strong">Amount ({asset.symbol})</label>
        <input id="dep-amount" className="input" inputMode="decimal" placeholder="5" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && units === null} aria-describedby="dep-amount-h" />
        <p id="dep-amount-h" className={`small ${amount !== "" && units === null ? "loss" : "muted"}`}>
          {amount !== "" && units === null ? `Enter a number with at most ${asset.decimals} decimals.` : "You will see how many coins you get before you send anything."}
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
    { refreshInterval: (d) => (d && isFinalCashStatus(mapCashStatus(d.status)) ? 0 : 3000) },
  );
  const status: CashStatus = data ? mapCashStatus(data.status) : "waiting";
  const left = quote.deadline - now;
  const final = isFinalCashStatus(status);
  const text = cashStatusText("deposit", status);

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
          <p className="strong profit">{text.title}: {data?.fils_credited ? <Money fils={data.fils_credited} /> : "your coins are in"}</p>
          <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
        </div>
      )}
      {final && status !== "credited" && (
        <div className="panel-dim stack-sm" role="alert">
          <p className={`strong ${status === "refunded" ? "" : "loss"}`}>{text.title}</p>
          <p className="small">{text.detail}</p>
          <button type="button" className="btn" onClick={onDone}>Start again</button>
        </div>
      )}
      {status === "unknown" && <p className="muted small" role="status">{text.detail}</p>}

      {!final && (
        <>
          <p>
            Send exactly <strong>{formatUnits(BigInt(quote.amount_in), asset.decimals)} {asset.symbol}</strong> on the <strong>{asset.chainLabel}</strong> network to this address.
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

function Withdraw({ demo, assets }: { demo: boolean; assets: CashAsset[] }) {
  const toast = useToast();
  const { me, refresh } = useGame();
  const [assetId, setAssetId] = useState(() => defaultAssetId(assets));
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; status: string } | null>(null);
  // The server's reason when it refuses (a withdrawal already open, the daily cap...), kept on the form until the next edit.
  const [refused, setRefused] = useState<string | null>(null);
  const asset = (assetById(assets, assetId) ?? assets[0]) as CashAsset;
  const fils = parseCoins(amount);
  const balance = BigInt(me?.fils ?? "0");
  const cap = BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS);
  const addrOk = isValidAddress(asset.kind, address);
  const problem = withdrawProblem(fils, balance);
  const valid = fils !== null && problem === null && addrOk;
  const tooLittle = balance < MIN_WITHDRAW;

  const send = async () => {
    if (!valid || fils === null) return;
    setBusy(true);
    const body = { fils: fils.toString(), dest_asset: asset.id, dest_address: address.trim() };
    const r = demo ? await cannedWithdraw() : await getApi().withdraw(body);
    setBusy(false);
    setConfirm(false);
    if (r.ok) {
      setRefused(null);
      setDone({ id: r.data.request_id, status: r.data.status });
      setAmount("");
      void refresh();
    } else {
      const text = cashErrorText(r.error);
      setRefused(text);
      toast.push("error", text);
    }
  };

  if (done) {
    const st = mapCashStatus(done.status);
    const text = cashStatusText("withdraw", st);
    return (
      <div className="panel stack" role="status">
        <p className="strong">{isFinalCashStatus(st) ? text.title : "Withdrawal requested."}</p>
        <p className="muted small">
          Request {shortId(done.id, 6, 4)}: {isFinalCashStatus(st) ? text.detail : "your coins are set aside and the money is being sent. It usually takes a few minutes. You can only have one withdrawal open at a time."}
        </p>
        <button type="button" className="btn" onClick={() => setDone(null)}>Make another</button>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <p className="muted small">
        Minimum {formatCoins(MIN_WITHDRAW)} coins. Daily limit {formatCoins(cap)} coins (10 USDC) per UTC day, refunded withdrawals included. One withdrawal at a time. Balance <Money fils={balance} />.
      </p>
      {tooLittle && <p className="small loss" role="status">You need at least {formatCoins(MIN_WITHDRAW)} coins to withdraw.</p>}
      <div className="field">
        <label htmlFor="wd-amount" className="strong">Amount (coins)</label>
        <input id="wd-amount" className="input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => { setAmount(e.target.value); setRefused(null); }} aria-invalid={amount !== "" && (fils === null || !!problem)} aria-describedby="wd-amount-h" />
        <p id="wd-amount-h" className={`small ${amount !== "" && (fils === null || problem) ? "loss" : "muted"}`}>
          {amount !== "" && fils === null ? "Enter a number with at most 2 decimals." : problem ?? `100 coins is 1 USDC. At least ${formatCoins(MIN_WITHDRAW)} coins.`}
        </p>
      </div>
      <div className="field">
        <label htmlFor="wd-asset" className="strong">Receive as</label>
        <select id="wd-asset" className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wd-addr" className="strong">Destination address</label>
        <input id="wd-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={address !== "" && !addrOk} aria-describedby="wd-addr-h" />
        <p id="wd-addr-h" className={`small ${address !== "" && !addrOk ? "loss" : "muted"}`}>{addressHint(asset.kind)}. Double-check it: transfers cannot be undone.</p>
      </div>
      {refused && <p className="small loss" role="alert">{refused}</p>}
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
        <p className="muted small">Make sure the address is on the {asset.chainLabel} network. Mistakes cannot be reversed.</p>
      </Sheet>
    </div>
  );
}
