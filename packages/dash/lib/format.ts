// Small formatting helpers shared by the views.

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "?";
  return agoMs(now - t);
}

export function agoMs(diff: number): string {
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Remaining time to `iso` as mm:ss (or h:mm:ss over an hour). Negative when expired. */
export function countdown(iso: string | null | undefined, now = Date.now()): { text: string; msLeft: number } {
  if (!iso) return { text: "--:--", msLeft: NaN };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { text: "--:--", msLeft: NaN };
  const msLeft = t - now;
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return { text: h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`, msLeft };
}

export function ts(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return `$${Number(n).toFixed(digits)}`;
}

export function pretty(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** One-line rendering of a payload for table rows: `k=v k=v`, strings trimmed. */
export function compact(v: unknown, max = 160): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object" && !Array.isArray(v)) {
    s = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${typeof val === "object" && val !== null ? JSON.stringify(val) : String(val)}`)
      .join("  ");
  } else {
    s = typeof v === "string" ? v : JSON.stringify(v);
  }
  s = s.replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.length > 12 ? id.slice(0, 8) : id;
}
