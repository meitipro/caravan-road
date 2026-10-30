"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ErrorCode } from "@caravan/shared";
import { ERROR_TEXT } from "../ui/game-meta";

type Kind = "success" | "error" | "info";
interface ToastItem { id: number; kind: Kind; text: string }

interface ToastApi {
  push: (kind: Kind, text: string) => void;
  success: (text: string) => void;
  info: (text: string) => void;
  /** Maps an API error code to a friendly message. */
  error: (err: { code: ErrorCode; message?: string }) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = nextId.current++;
      setItems((s) => [...s.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (t) => push("success", t),
      info: (t) => push("info", t),
      error: (e) => push("error", ERROR_TEXT[e.code] ?? e.message ?? ERROR_TEXT.INTERNAL),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}
