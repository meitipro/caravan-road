"use client";

// Art slots (master plan 7.3). Files in public/assets are produced by the art pipeline; until a file
// exists a flat placeholder of the exact size is drawn instead. Images are pixelated at integer scales.

import { useEffect, useState, type CSSProperties } from "react";

const loaded = new Map<string, boolean>();

/** null while unknown, then true/false once the image has been tried. */
export function useAssetOk(src: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(() => loaded.get(src) ?? null);
  useEffect(() => {
    const known = loaded.get(src);
    if (known !== undefined) {
      setOk(known);
      return;
    }
    let live = true;
    const img = new window.Image();
    img.onload = () => {
      loaded.set(src, true);
      if (live) setOk(true);
    };
    img.onerror = () => {
      loaded.set(src, false);
      if (live) setOk(false);
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return ok;
}

interface Props {
  /** path under /assets, for example "goods/grain" (the .png is added) */
  slot: string;
  w: number;
  h: number;
  scale?: number;
  alt: string;
  /** CSS color for the placeholder */
  color?: string;
  label?: string;
  className?: string;
  style?: CSSProperties;
  decorative?: boolean;
}

export function PixelImage({ slot, w, h, scale = 1, alt, color = "var(--dune)", label, className, style, decorative }: Props) {
  const src = `/assets/${slot}.png`;
  const ok = useAssetOk(src);
  const W = w * scale;
  const H = h * scale;
  if (ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        width={W}
        height={H}
        alt={decorative ? "" : alt}
        aria-hidden={decorative || undefined}
        className={`pixel ${className ?? ""}`}
        style={style}
      />
    );
  }
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative || undefined}
      className={`pixel placeholder ${className ?? ""}`}
      style={{ width: W, height: H, background: color, fontSize: Math.max(8, Math.min(W, H) / 3), ...style }}
    >
      {label ? <span aria-hidden="true">{label}</span> : null}
    </span>
  );
}

/** Two-frame caravan sprite (96x32 sheet, 48x32 frames). */
export function CaravanSprite({ scale = 1, flip = false, moving = true }: { scale?: number; flip?: boolean; moving?: boolean }) {
  const src = "/assets/ui/caravan.png";
  const ok = useAssetOk(src);
  const W = 48 * scale;
  const H = 32 * scale;
  if (!ok) {
    return (
      <span
        className="pixel placeholder caravan-ph"
        aria-hidden="true"
        style={{ width: W, height: H, transform: flip ? "scaleX(-1)" : undefined }}
      >
        <span aria-hidden="true">CV</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`pixel caravan-sprite ${moving ? "is-moving" : ""}`}
      style={{
        width: W,
        height: H,
        backgroundImage: `url(${src})`,
        backgroundSize: `${96 * scale}px ${H}px`,
        transform: flip ? "scaleX(-1)" : undefined,
        ["--frame-w" as string]: `${W}px`,
      }}
    />
  );
}
