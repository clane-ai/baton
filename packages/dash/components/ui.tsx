"use client";

import { useState } from "react";
import type { ApiError, TaskState } from "@/lib/types";
import { pretty } from "@/lib/format";
import { stateLabel, stateTone, toneClass, type Tone } from "@/lib/theme";

export function StateBadge({ state }: { state: TaskState | string }) {
  return <span className={`badge st-${state}`}>{state}</span>;
}

export function StatusDot({ status }: { status: string | null | undefined }) {
  const s = (status ?? "unknown").toLowerCase();
  return <span className={`dot dot-${s}`} title={s} />;
}

export function Key({ children }: { children: React.ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="error">
      <b className="mono">{error.code}</b> {error.message}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="block">{pretty(value)}</pre>;
}

/** Inline two-step confirmation. Renders the trigger; on click shows Confirm/Back in place. */
export function InlineConfirm({
  label,
  prompt,
  confirmLabel = "Confirm",
  onConfirm,
  disabled,
  busy,
  className = "btn danger",
}: {
  label: string;
  prompt: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const [arm, setArm] = useState(false);
  if (!arm) {
    return (
      <button type="button" className={className} disabled={disabled || busy} onClick={() => setArm(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm">
      <span>{prompt}</span>
      <button
        type="button"
        className="btn danger solid sm"
        disabled={busy}
        onClick={async () => {
          await onConfirm();
          setArm(false);
        }}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
      <button type="button" className="btn sm" disabled={busy} onClick={() => setArm(false)}>
        Back
      </button>
    </div>
  );
}

export function Flash({ msg }: { msg: { kind: "ok" | "bad"; text: string } | null }) {
  if (!msg) return null;
  return <div className={`flash ${msg.kind}`}>{msg.text}</div>;
}

// ---- theme primitives (spec section 3) ----

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${toneClass(tone)}`}>{children}</span>;
}

export function StatePill({ state }: { state: string }) {
  return <Pill tone={stateTone(state)}>{stateLabel(state)}</Pill>;
}

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`chip ${toneClass(tone)}`}>{children}</span>;
}

export function Tile({ n, label, sub, tone }: { n: number | string; label: string; sub?: string; tone?: Tone }) {
  return (
    <div className={`tile surface${tone ? " " + toneClass(tone) : ""}`}>
      <div className="tile-n num">{n}</div>
      {sub ? <div className="tile-sub num">{sub}</div> : null}
      <div className="tile-l">{label}</div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <b>{title}</b>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}
