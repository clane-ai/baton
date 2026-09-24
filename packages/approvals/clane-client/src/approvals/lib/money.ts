/** "5,520.00 EUR"; "-" for anything that is not a finite number. */
export function money(v: unknown, currency?: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "-";
  const s = n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s} ${String(currency)}` : s;
}
