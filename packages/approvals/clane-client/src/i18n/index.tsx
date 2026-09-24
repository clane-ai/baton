// STAGING STUB — not copied to the platform. Same call sites as clane-client/src/i18n/index.jsx:
// useT() returns { lang, setLang, t }; t(key, vars) reads the Workflow English table with {{var}} interpolation.
import React, { createContext, useContext, useMemo } from "react";
import { WORKFLOW } from "./catalog.workflow.js";

type T = (key: string, vars?: Record<string, unknown>) => string;
type Shape = { lang: string; setLang: (l: string) => void; t: T };

const table: Record<string, string> = (WORKFLOW as { en: Record<string, string> }).en;

function interpolate(s: string, vars?: Record<string, unknown>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

const identity: Shape = { lang: "en", setLang: () => {}, t: (key, vars) => interpolate(table[key] ?? key, vars) };
const Ctx = createContext<Shape>(identity);

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const value = useMemo(() => identity, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): Shape {
  return useContext(Ctx);
}
