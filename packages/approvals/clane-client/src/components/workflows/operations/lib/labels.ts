// Catalogue text with a readable fallback. The platform's t() returns the key
// itself when a string is missing (see sectionText in src/i18n/index.jsx); an
// engine value we have no copy for reads as words rather than as a raw key.

type T = (key: string, vars?: Record<string, unknown>) => string;

export function labelOr(t: T, key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

/** "purchase_order" → "Purchase order" from the catalogue, else "purchase order". */
export const kindLabel = (t: T, kind: string): string => labelOr(t, `workflow.kind.${kind}`, kind.replace(/_/g, ' '));

/** "needs_human" → "Needs you" from the catalogue, else the status in words. */
export const runStatusLabel = (t: T, status: string): string =>
  labelOr(t, `workflow.runStatus.${status}`, status.replace(/_/g, ' '));
