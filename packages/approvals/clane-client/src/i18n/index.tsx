// STAGING STUB — not copied to the platform. Behaves like clane-client/src/i18n/index.jsx:
// I18nProvider holds { lang, setLang, t }; t(key, vars) reads the table with English fallback
// and {{var}} interpolation; useT() OUTSIDE a provider returns an identity t that echoes keys.
// Specs therefore render inside I18nProvider, exactly as they must on the platform.
// The table here is only the Workflow copy; the platform merges it into its full catalogue.
import React, { createContext, useCallback, useContext, useState } from 'react';
import { WORKFLOW } from './catalog.workflow.js';

type T = (key: string, vars?: Record<string, unknown>) => string;
type Shape = { lang: string; setLang: (l: string) => void; t: T };

const en: Record<string, string> = (WORKFLOW as { en: Record<string, string> }).en;

function interpolate(s: string, vars?: Record<string, unknown>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

const I18nContext = createContext<Shape | null>(null);

export function I18nProvider({ children }: { children?: React.ReactNode }): JSX.Element {
  const [lang, setLang] = useState('en');
  const t = useCallback<T>((key, vars) => interpolate(key in en ? en[key] : key, vars), []);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT(): Shape {
  const ctx = useContext(I18nContext);
  if (!ctx) return { lang: 'en', setLang: () => {}, t: (key) => key };
  return ctx;
}
