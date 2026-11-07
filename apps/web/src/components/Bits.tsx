"use client";

// Small shared pieces: money, skeletons, empty/error states, stock bars, chips.

import Link from "next/link";
import type { ReactNode } from "react";
import type { CityId, GoodId, Mood } from "@caravan/shared";
import { formatCoins } from "../ui/format";
import { CITY_META, GOOD_META, MOOD_META } from "../ui/game-meta";
import { PixelImage } from "./PixelImage";

export function Coin({ size = 16 }: { size?: number }) {
  return <PixelImage slot="ui/coin" w={16} h={16} scale={size / 16} alt="" decorative color="var(--gold)" className="coin" />;
}

/** Coin amount with the coin icon. `fils` is a decimal string or bigint; formatting never uses Number. */
export function Money({ fils, className, sign }: { fils: string | bigint; className?: string; sign?: boolean }) {
  const v = typeof fils === "bigint" ? fils : BigInt(fils);
  const text = formatCoins(v);
  const tone = sign ? (v > 0n ? "profit" : v < 0n ? "loss" : "") : "";
  return (
    <span className={`money ${tone} ${className ?? ""}`}>
      <Coin />
      <span className="num">{sign && v > 0n ? "+" : ""}{text}</span>
      <span className="sr-only"> coins</span>
    </span>
  );
}

export function GoodIcon({ good, scale = 1 }: { good: GoodId; scale?: number }) {
  return <PixelImage slot={`goods/${good}`} w={32} h={32} scale={scale} alt={GOOD_META[good].name} color={GOOD_META[good].color} label={GOOD_META[good].name[0]} />;
}

export function Skeleton({ h = 16, w = "100%", className }: { h?: number; w?: number | string; className?: string }) {
  return <span className={`skeleton ${className ?? ""}`} style={{ height: h, width: w }} aria-hidden="true" />;
}

export function LoadingBlock({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="panel" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="stack">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} h={i === 0 ? 24 : 16} w={i === 0 ? "50%" : `${90 - i * 12}%`} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="panel error-state" role="alert">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

export function StockBar({ stock, target, cap, color }: { stock: number; target: number; cap: number; color?: string }) {
  const pct = Math.min(100, Math.round((stock * 100) / cap));
  const targetPct = Math.round((target * 100) / cap);
  return (
    <span className="stockbar" role="img" aria-label={`Stock ${stock} of target ${target}`}>
      <span className="stockbar-fill" style={{ width: `${pct}%`, background: color ?? "var(--oasis)" }} />
      <span className="stockbar-target" style={{ left: `${targetPct}%` }} />
    </span>
  );
}

export function MoodChip({ mood }: { mood: Mood }) {
  const m = MOOD_META[mood];
  return (
    <span className={`chip mood mood-${mood}`} title={m.hint}>
      {m.label}
    </span>
  );
}

export function CityLink({ city, children, className }: { city: CityId; children?: ReactNode; className?: string }) {
  return (
    <Link href={`/play/city/${city}`} className={className ?? "link"}>
      {children ?? CITY_META[city].name}
    </Link>
  );
}

export function Page({ title, subtitle, children, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="muted page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
