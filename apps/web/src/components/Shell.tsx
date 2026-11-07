"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CITY_IDS } from "@caravan/shared";
import { IS_MOCK } from "../ui/api";
import { formatEta } from "../ui/format";
import { CITY_META, modeBadge } from "../ui/game-meta";
import { devLogout, useDevLoginAvailable, useMockSession } from "../ui/session";
import { Money } from "./Bits";
import { useGame, useNow } from "./GameProvider";
import { useLang } from "./Lang";
import { useMind } from "./Mind";
import { PixelImage } from "./PixelImage";
import { Sheet } from "./Sheet";

function Icon({ name }: { name: "map" | "market" | "cash" | "ranks" }) {
  // 12x12 pixel glyphs drawn as SVG rects (crisp edges).
  const shapes: Record<typeof name, string[]> = {
    map: ["000000000000", "011101110110", "010101010100", "010101010100", "011101110110", "000000000000"],
    market: ["000111111000", "001000000100", "011111111110", "010000000010", "010011110010", "010010010010", "011111111110"],
    // a banknote with a round coin mark (the old glyph drew a boxed S, which read as the digit 5 or a letter S)
    cash: ["011111111110", "010000000010", "010001100010", "010010010010", "010010010010", "010001100010", "010000000010", "011111111110"],
    ranks: ["011111111110", "010111111010", "001111111100", "000111111000", "000011110000", "000011110000", "000111111000"],
  };
  const rows = shapes[name];
  return (
    <svg width="24" height="24" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)),
      )}
    </svg>
  );
}

export function TopBar() {
  const { me, mode } = useGame();
  const { lang, toggle } = useLang();
  const [menu, setMenu] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/play" className="brand" aria-label="Caravan Road, home">
          <PixelImage slot="ui/logo" w={256} h={64} scale={0.5} alt="Caravan Road" color="var(--gold)" label="CARAVAN ROAD" className="logo" />
        </Link>
        <nav className="topnav" aria-label="Main">
          <NavLinks />
        </nav>
        <div className="topbar-right">
          {me && (
            <Link href="/play/cash" className="balance" aria-label="Your dinars, open cash">
              <Money fils={me.fils} />
            </Link>
          )}
          {mode && (
            <span className={`badge mode-badge mode-${mode.toLowerCase()}`} title={modeBadge(mode, IS_MOCK).text}>
              {modeBadge(mode, IS_MOCK).label}
            </span>
          )}
          <button type="button" className="btn btn-small lang-btn hide-narrow" onClick={toggle} aria-label={`Merchant language: ${lang === "en" ? "English" : "Persian"}. Switch`}>
            <span className={lang === "en" ? "on" : ""}>EN</span>/<span className={lang === "fa" ? "on" : ""}>FA</span>
          </button>
          <button type="button" className="btn btn-small" onClick={() => setMenu(true)} aria-haspopup="dialog">
            Menu
          </button>
        </div>
      </div>
      <MenuSheet open={menu} onClose={() => setMenu(false)} />
    </header>
  );
}

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mind = useMind();
  const { logout } = useMockSession();
  const dev = useDevLoginAvailable();
  const { mode, me } = useGame();
  const { lang, toggle } = useLang();
  return (
    <Sheet open={open} onClose={onClose} title="Menu" variant="drawer">
      <div className="stack">
        {mode && <p className="muted small">{modeBadge(mode, IS_MOCK).text}</p>}
        <button type="button" className="btn btn-block" onClick={toggle}>
          Merchant language: {lang === "en" ? "English" : "فارسی"}
        </button>
        <nav className="stack-sm" aria-label="Menu">
          <Link className="btn btn-block" href="/play" onClick={onClose}>Map</Link>
          <Link className="btn btn-block" href="/play/journey" onClick={onClose}>Caravan</Link>
          <Link className="btn btn-block" href={`/play/city/${me?.location ?? "bandar"}/stalls`} onClick={onClose}>Stalls</Link>
          <Link className="btn btn-block" href="/play/cash" onClick={onClose}>Cash</Link>
          <Link className="btn btn-block" href="/play/ranks" onClick={onClose}>Ranks</Link>
        </nav>
        <h3 className="h3">Merchant minds</h3>
        <div className="grid-2">
          {CITY_IDS.map((c) => (
            <button
              key={c}
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                mind.open(c);
              }}
            >
              {CITY_META[c].merchant}
            </button>
          ))}
        </div>
        {IS_MOCK ? (
          <button type="button" className="btn btn-block" onClick={() => { logout(); onClose(); }}>
            Log out (demo)
          </button>
        ) : dev === true ? (
          <button type="button" className="btn btn-block" onClick={() => { onClose(); void devLogout(); }}>
            Log out
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- NextAuth sign-out is a server route, not a page
          <a className="btn btn-block" href="/api/auth/signout" onClick={onClose}>Log out</a>
        )}
      </div>
    </Sheet>
  );
}

function useActiveTab(): "map" | "market" | "cash" | "ranks" | null {
  const p = usePathname() ?? "";
  if (p.startsWith("/play/city")) return "market";
  if (p.startsWith("/play/cash")) return "cash";
  if (p.startsWith("/play/ranks")) return "ranks";
  if (p === "/play" || p.startsWith("/play/journey")) return "map";
  return null;
}

function NavLinks() {
  const { me } = useGame();
  const active = useActiveTab();
  const items = [
    { id: "map" as const, href: "/play", label: "Map" },
    { id: "market" as const, href: `/play/city/${me?.location ?? "bandar"}`, label: "Market" },
    { id: "cash" as const, href: "/play/cash", label: "Cash" },
    { id: "ranks" as const, href: "/play/ranks", label: "Ranks" },
  ];
  return (
    <>
      {items.map((i) => (
        <Link key={i.id} href={i.href} className={`navlink ${active === i.id ? "active" : ""}`} aria-current={active === i.id ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </>
  );
}

export function TabBar() {
  const { me } = useGame();
  const active = useActiveTab();
  const items = [
    { id: "map" as const, href: "/play", label: "Map" },
    { id: "market" as const, href: `/play/city/${me?.location ?? "bandar"}`, label: "Market" },
    { id: "cash" as const, href: "/play/cash", label: "Cash" },
    { id: "ranks" as const, href: "/play/ranks", label: "Ranks" },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((i) => (
        <Link key={i.id} href={i.href} className={`tab ${active === i.id ? "active" : ""}`} aria-current={active === i.id ? "page" : undefined}>
          <Icon name={i.id} />
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Shown on every screen while the caravan is on the road or waiting to be claimed. */
export function TransitBanner() {
  const { me } = useGame();
  const now = useNow();
  const j = me?.journey;
  if (!j || j.status === "CLAIMED") return null;
  const left = j.arrives_at - now;
  const arrived = j.status === "ARRIVED" || (now > 0 && left <= 0);
  return (
    <Link href="/play/journey" className={`transit-banner ${arrived ? "arrived" : ""}`}>
      <span className="strong">
        {arrived ? `Your caravan reached ${CITY_META[j.to].name}.` : `Caravan to ${CITY_META[j.to].name}`}
      </span>
      <span className="num">{arrived ? "Claim it" : formatEta(left)}</span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <TopBar />
      <TransitBanner />
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <TabBar />
    </div>
  );
}
