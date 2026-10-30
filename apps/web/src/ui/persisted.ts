"use client";

// Small persisted values (flags, language, fake session) exposed as external stores so that
// components re-render when they change and SSR/hydration stay consistent.

import { useCallback, useSyncExternalStore } from "react";
import { safeGet, safeRemove, safeSet } from "./storage";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns null on the server and during hydration, then the stored string (or "" when unset). */
export function usePersisted(key: string): [string | null, (v: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => safeGet(key) ?? "",
    () => null,
  );
  const set = useCallback(
    (v: string | null) => {
      if (v === null) safeRemove(key);
      else safeSet(key, v);
      emit();
    },
    [key],
  );
  return [value, set];
}
