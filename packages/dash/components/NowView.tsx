"use client";

import type { PollState } from "@/lib/usePoll";
import type { Agent, StatusResponse } from "@/lib/types";
import { ago, countdown } from "@/lib/format";
import { ErrorBox, Key, StatusDot } from "./ui";

const FIVE_MIN = 5 * 60 * 1000;

function Lease({ until, now }: { until: string | null; now: number }) {
  const c = countdown(until, now);
  if (Number.isNaN(c.msLeft)) return <span className="lease muted">no lease</span>;
  const cls = c.msLeft <= 0 ? "lease expired" : c.msLeft < FIVE_MIN ? "lease warn" : "lease";
  return (
    <span className={cls} title={until ?? ""}>
      {c.msLeft <= 0 ? "expired" : c.text}
    </span>
  );
}

function AgentCard({ a, now }: { a: Agent; now: number }) {
  const t = a.current_task;
  return (
    <div className="panel agent">
      <div className="name">
        <StatusDot status={a.revoked ? "revoked" : a.status} />
        {a.name}
        <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
          {a.revoked ? "revoked" : a.status}
        </span>
      </div>
      <div className="meta">
        <span>{a.role}</span>
        <span className="muted"> on </span>
        <span className="mono">{a.machine ?? "?"}</span>
        <span className="muted"> · last seen {ago(a.last_seen, now)}</span>
      </div>
      <div className="task">
        {t ? (
          <>
            <div>
              <Key>{t.key}</Key> <span className={`badge st-${t.state}`}>{t.state}</span>
            </div>
            <div className="title">{t.title}</div>
            <div className="lease-row">
              <span className="muted">lease</span>
              <Lease until={t.lease_until} now={now} />
            </div>
          </>
        ) : (
          <div className="idle">idle</div>
        )}
      </div>
    </div>
  );
}

export default function NowView({ status, now }: { status: PollState<StatusResponse>; now: number }) {
  const agents = status.data?.agents ?? [];
  const sorted = [...agents].sort((x, y) => {
    const xa = x.current_task ? 0 : 1;
    const ya = y.current_task ? 0 : 1;
    return xa - ya || x.role.localeCompare(y.role) || x.name.localeCompare(y.name);
  });
  const counts = status.data?.counts ?? {};

  return (
    <div>
      <div className="view-head">
        <h2>Now</h2>
        <span className="muted">
          {agents.filter((a) => a.current_task).length} working · {agents.filter((a) => !a.current_task).length} idle
        </span>
        <span className="spacer" />
        <span className="muted mono">
          {Object.entries(counts)
            .map(([k, v]) => `${k}:${v}`)
            .join("  ")}
        </span>
      </div>
      <ErrorBox error={status.error} />
      {status.loading && !status.data ? (
        <div className="empty">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="empty">No agents registered.</div>
      ) : (
        <div className="agents">
          {sorted.map((a) => (
            <AgentCard key={a.id} a={a} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
