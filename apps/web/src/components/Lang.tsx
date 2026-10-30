"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePersisted } from "../ui/persisted";

export type Lang = "en" | "fa";

interface LangApi { lang: Lang; setLang: (l: Lang) => void; toggle: () => void }
const Ctx = createContext<LangApi>({ lang: "en", setLang: () => {}, toggle: () => {} });

export const useLang = () => useContext(Ctx);

/** EN/FA toggle. It switches merchant lines (and a few labels); the rest of the interface stays English. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [raw, set] = usePersisted("caravan.lang");
  const lang: Lang = raw === "fa" ? "fa" : "en";
  const api = useMemo<LangApi>(
    () => ({ lang, setLang: (l) => set(l), toggle: () => set(lang === "en" ? "fa" : "en") }),
    [lang, set],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
