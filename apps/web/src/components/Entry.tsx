"use client";

// Login screen, 3-card onboarding and the gate that decides what to show before the game.

import { useState, type ReactNode } from "react";
import { IS_MOCK } from "../ui/api";
import { GAME_MODE_TEXT } from "../ui/game-meta";
import { usePersisted } from "../ui/persisted";
import { devLogin, startLogin, useDevLoginAvailable, useMockSession, type Provider } from "../ui/session";
import { ErrorState, LoadingBlock, Money } from "./Bits";
import { ErrorBoundary } from "./ErrorBoundary";
import { GameProvider, useActions, useGame } from "./GameProvider";
import { LangProvider } from "./Lang";
import { MindProvider } from "./Mind";
import { PixelImage } from "./PixelImage";
import { Shell } from "./Shell";
import { ToastProvider, useToast } from "./Toast";
import { PARAMS } from "@caravan/shared";
import { formatDinar } from "../ui/format";

function ModeBadge({ mode }: { mode: "PLAY" | "LIVE" }) {
  return (
    <span className={`badge mode-badge mode-${mode.toLowerCase()}`}>
      {mode}: {GAME_MODE_TEXT[mode]}
    </span>
  );
}

function DevLoginForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[A-Za-z0-9 _-]{1,24}$/.test(name.trim());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    const msg = await devLogin(name.trim());
    if (msg) {
      setErr(msg);
      setBusy(false);
    }
    // on success the page reloads and the first state call creates the account (splash until it answers)
  };
  return (
    <form className="stack-sm entry-actions" onSubmit={submit}>
      <label className="stack-sm">
        <span className="small strong">Your name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="nickname"
          placeholder="Sara"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? "dev-name-err" : undefined}
        />
      </label>
      {err && <p id="dev-name-err" className="loss small" role="alert">{err}</p>}
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!valid || busy}>
        {busy ? "Entering the caravan…" : "Play"}
      </button>
    </form>
  );
}

export function LoginScreen({ onMockLogin }: { onMockLogin: (p: Provider) => void }) {
  const { mode } = useGame();
  const dev = useDevLoginAvailable();
  return (
    <div className="entry">
      <div className="entry-card">
        <PixelImage slot="ui/logo" w={256} h={64} scale={1} alt="Caravan Road" color="var(--gold)" label="CARAVAN ROAD" className="logo-big" />
        <p className="entry-line">Trade across the desert. Outwit the merchants. Keep what you earn.</p>
        <ModeBadge mode={mode ?? "PLAY"} />
        {dev === true ? (
          <DevLoginForm />
        ) : (
          <div className="stack-sm entry-actions" aria-busy={dev === null}>
            <button type="button" className="btn btn-primary btn-block btn-lg" disabled={dev === null} onClick={() => startLogin("google", onMockLogin)}>
              Continue with Google
            </button>
            <button type="button" className="btn btn-block btn-lg" disabled={dev === null} onClick={() => startLogin("discord", onMockLogin)}>
              Continue with Discord
            </button>
          </div>
        )}
        <p className="muted small">
          {IS_MOCK
            ? "Demo mode: this login is simulated and nothing leaves your browser."
            : dev === true
              ? "Local test server: pick any name to start a practice account."
              : "No downloads, no setup. Your account is created for you."}
        </p>
      </div>
    </div>
  );
}

const CARDS = [
  {
    title: "Buy where it is cheap",
    body: "Every city makes some goods and runs short of others. Look for the green “Cheap” tag and fill your caravan.",
    art: "goods/grain",
    color: "var(--leaf)",
  },
  {
    title: "Cross the desert",
    body: "Pick a route and hire up to three guards. Longer roads are riskier and take 3 to 6 minutes. Guards cut the ambush risk.",
    art: "ui/guard",
    color: "var(--terracotta)",
  },
  {
    title: "Sell where it is scarce",
    body: "Prices move after every trade, and four merchants set their own prices. Ask a merchant why it set its price.",
    art: "ui/coin",
    color: "var(--gold)",
  },
] as const;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const { me, mode } = useGame();
  const actions = useActions();
  const toast = useToast();
  const [claimed, setClaimed] = usePersisted("caravan.claimed");
  const [busy, setBusy] = useState(false);
  const last = i === CARDS.length - 1;
  const card = CARDS[i]!;
  const canClaim = mode === "PLAY" && !claimed;

  const claim = async () => {
    setBusy(true);
    const r = await actions.faucet();
    setBusy(false);
    if (r.ok) {
      setClaimed("1");
      toast.success(`+${formatDinar(String(PARAMS.FAUCET_FILS))} dinars added`);
    }
  };

  return (
    <div className="entry">
      <div className="entry-card onboarding" role="group" aria-roledescription="carousel" aria-label="How to play">
        <p className="muted small">Step {i + 1} of {CARDS.length}</p>
        <PixelImage slot={card.art} w={32} h={32} scale={3} alt="" decorative color={card.color} />
        <h1 className="page-title">{card.title}</h1>
        <p>{card.body}</p>
        <div className="dots" aria-hidden="true">
          {CARDS.map((_, k) => (
            <span key={k} className={`dot ${k === i ? "on" : ""}`} />
          ))}
        </div>
        {last && me && (
          <p className="muted small">You have <Money fils={me.fils} />.</p>
        )}
        {last && canClaim && (
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={claim}>
            {busy ? "Claiming…" : `Claim ${formatDinar(String(PARAMS.FAUCET_FILS))} dinars`}
          </button>
        )}
        <div className="row-between">
          <button type="button" className="btn btn-ghost" onClick={() => (i === 0 ? onDone() : setI(i - 1))}>
            {i === 0 ? "Skip" : "Back"}
          </button>
          {last ? (
            <button type="button" className={`btn ${canClaim ? "" : "btn-primary"}`} onClick={onDone}>
              Start trading
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setI(i + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="entry">
      <div className="entry-card">
        <LoadingBlock label="Loading the caravan" rows={3} />
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { status, me, refresh, error } = useGame();
  const mock = useMockSession();
  const [onboarded, setOnboarded] = usePersisted("caravan.onboarded");

  if (IS_MOCK) {
    if (mock.status === "unknown") return <Splash />;
    if (mock.status === "out") return <LoginScreen onMockLogin={mock.login} />;
  } else {
    if (status === "unauth" || (status === "ready" && !me)) return <LoginScreen onMockLogin={mock.login} />;
  }

  if (status === "loading") return <Splash />;
  if (status === "error") {
    return (
      <div className="entry">
        <div className="entry-card">
          <ErrorState title="Cannot reach the caravan master" onRetry={() => void refresh()}>
            {error?.message ?? "The server did not answer."} We will keep trying.
          </ErrorState>
        </div>
      </div>
    );
  }
  if (onboarded === null) return <Splash />;
  if (!onboarded) return <Onboarding onDone={() => setOnboarded("1")} />;
  return <Shell>{children}</Shell>;
}

export function PlayRoot({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <LangProvider>
          <GameProvider>
            <MindProvider>
              <Gate>{children}</Gate>
            </MindProvider>
          </GameProvider>
        </LangProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
