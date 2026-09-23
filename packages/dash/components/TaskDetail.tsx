"use client";

import { useEffect, useState } from "react";
import { postJson, usePoll } from "@/lib/usePoll";
import type { ApiError, Artifact, TaskDetailResponse, TaskRef } from "@/lib/types";
import { ts, usd, compact } from "@/lib/format";
import { ErrorBox, Flash, InlineConfirm, Json, Key, StateBadge } from "./ui";

type FlashMsg = { kind: "ok" | "bad"; text: string } | null;

function Chain({ title, items }: { title: string; items: TaskRef[] }) {
  return (
    <div className="section">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <div className="muted">none</div>
      ) : (
        <div className="chain">
          {items.map((r) => (
            <div key={r.id} className="item">
              <Key>{r.key}</Key>
              <StateBadge state={r.state} />
              <span>{r.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactRow({ a }: { a: Artifact }) {
  const [open, setOpen] = useState(false);
  const hasContent = a.content !== null && a.content !== undefined;
  return (
    <>
      <tr>
        <td>
          <Key>{a.kind}</Key>
          {a.schema_version ? <span className="muted"> v{a.schema_version}</span> : null}
        </td>
        <td className="mono" style={{ overflowWrap: "anywhere" }}>
          {a.uri ?? <span className="muted">-</span>}
        </td>
        <td className="mono muted">{a.sha256 ? a.sha256.slice(0, 12) : ""}</td>
        <td className="nowrap muted">{ts(a.created_at)}</td>
        <td>
          {hasContent ? (
            <button type="button" className="btn link" onClick={() => setOpen((v) => !v)}>
              {open ? "hide" : "view"}
            </button>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="expanded">
          <td colSpan={5}>
            <Json value={a.content} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function TaskDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const d = usePoll<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(id)}`, 5000);
  const t = d.data?.task;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- actions
  const [priority, setPriority] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashMsg>(null);
  useEffect(() => {
    if (t && priority === "") setPriority(String(t.priority));
  }, [t, priority]);

  const act = async (name: string, body: Record<string, unknown>) => {
    setBusy(name);
    setFlash(null);
    try {
      await postJson(`/api/tasks/${encodeURIComponent(id)}/action`, { action: name, ...body });
      setFlash({ kind: "ok", text: `${name} ok` });
      await d.refresh();
      onChanged();
    } catch (e) {
      const err = e as ApiError;
      setFlash({ kind: "bad", text: `${name} failed: ${err.code} ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  const canRelease = t?.state === "in_progress" || t?.state === "review";
  const terminal = t?.state === "done" || t?.state === "cancelled";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Task detail">
        <div className="drawer-h">
          <div>
            <div>
              <Key>{t?.key ?? id}</Key> {t ? <StateBadge state={t.state} /> : null}
              {t?.assignee_name ? <span className="muted"> @{t.assignee_name}</span> : null}
            </div>
            <h3>{t?.title ?? "Loading…"}</h3>
          </div>
          <button type="button" className="btn sm close" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
        <div className="drawer-b">
          <ErrorBox error={d.error} />
          {t ? (
            <>
              <div className="section">
                <dl className="kv">
                  <dt>id</dt>
                  <dd className="mono">{t.id}</dd>
                  <dt>role</dt>
                  <dd>{t.role}</dd>
                  <dt>priority</dt>
                  <dd className="num">{t.priority}</dd>
                  <dt>attempts</dt>
                  <dd className="num">
                    {t.attempts} / {t.max_attempts}
                  </dd>
                  <dt>cost / budget</dt>
                  <dd className="num">
                    {usd(t.cost_usd)} / {t.budget_usd != null ? usd(t.budget_usd) : "no budget"}
                  </dd>
                  <dt>lease until</dt>
                  <dd className="mono">{t.lease_until ? ts(t.lease_until) : "-"}</dd>
                  <dt>scope</dt>
                  <dd className="mono">{t.scope?.length ? t.scope.join(", ") : "-"}</dd>
                  <dt>consumes</dt>
                  <dd className="mono">{t.consumes?.length ? t.consumes.join(", ") : "-"}</dd>
                  <dt>produces</dt>
                  <dd className="mono">{t.produces?.length ? t.produces.join(", ") : "-"}</dd>
                  {t.parent_task ? (
                    <>
                      <dt>parent</dt>
                      <dd className="mono">{t.parent_task}</dd>
                    </>
                  ) : null}
                  {t.github_issue ? (
                    <>
                      <dt>github issue</dt>
                      <dd className="mono">#{t.github_issue}</dd>
                    </>
                  ) : null}
                  <dt>created</dt>
                  <dd className="mono">{ts(t.created_at)}</dd>
                  <dt>updated</dt>
                  <dd className="mono">{ts(t.updated_at)}</dd>
                </dl>
              </div>

              <div className="section">
                <h4>Actions</h4>
                <div className="actions">
                  <div className="action">
                    <div className="action-h">Reprioritise</div>
                    <div className="field-row">
                      <input
                        className="field mono"
                        type="number"
                        style={{ width: 120 }}
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy !== null || priority === "" || Number(priority) === t.priority}
                        onClick={() => void act("prioritise", { priority: Number(priority) })}
                      >
                        {busy === "prioritise" ? "Saving…" : "Set priority"}
                      </button>
                    </div>
                  </div>

                  <div className="action">
                    <div className="action-h">
                      Cancel {terminal ? <span className="hint">task is already {t.state}</span> : null}
                    </div>
                    <textarea
                      className="field"
                      rows={2}
                      placeholder="Reason (recorded on the task event)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={terminal}
                    />
                    <div style={{ marginTop: 6 }}>
                      <InlineConfirm
                        label="Cancel task"
                        prompt={`Cancel ${t.key}? This cannot be undone.`}
                        confirmLabel="Yes, cancel it"
                        disabled={terminal}
                        busy={busy === "cancel"}
                        onConfirm={() => act("cancel", { reason })}
                      />
                    </div>
                  </div>

                  <div className="action">
                    <div className="action-h">
                      Force-release
                      {!canRelease ? <span className="hint">only for in_progress or review</span> : null}
                    </div>
                    <InlineConfirm
                      label="Force-release lease"
                      prompt={`Release ${t.key} from ${t.assignee_name ?? "its agent"}? The task returns to ready.`}
                      confirmLabel="Yes, release"
                      disabled={!canRelease}
                      busy={busy === "force-release"}
                      onConfirm={() => act("force-release", {})}
                    />
                  </div>
                </div>
                <Flash msg={flash} />
              </div>

              <div className="section">
                <h4>Spec</h4>
                <div className="prose">{t.spec || <span className="muted">none</span>}</div>
              </div>
              <div className="section">
                <h4>Acceptance</h4>
                <div className="prose">{t.acceptance || <span className="muted">none</span>}</div>
              </div>

              <Chain title="Depends on" items={d.data?.depends_on ?? []} />
              <Chain title="Dependents" items={d.data?.dependents ?? []} />
              {d.data?.children?.length ? <Chain title="Children" items={d.data.children} /> : null}

              <div className="section">
                <h4>Artefacts</h4>
                {d.data?.artifacts?.length ? (
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>kind</th>
                        <th>uri</th>
                        <th>sha256</th>
                        <th>created</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.artifacts.map((a) => (
                        <ArtifactRow key={a.id} a={a} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="muted">none</div>
                )}
              </div>

              {d.data?.consumed?.length ? (
                <div className="section">
                  <h4>Consumed artefacts</h4>
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>kind</th>
                        <th>uri</th>
                        <th>sha256</th>
                        <th>created</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.consumed.map((a) => (
                        <ArtifactRow key={a.id} a={a} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="section">
                <h4>Claims</h4>
                {d.data?.claims?.length ? (
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>agent</th>
                        <th>claimed</th>
                        <th>released</th>
                        <th>outcome</th>
                        <th>reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.claims.map((c) => (
                        <tr key={c.id}>
                          <td>{c.agent ?? "-"}</td>
                          <td className="mono nowrap">{ts(c.claimed_at)}</td>
                          <td className="mono nowrap">{c.released_at ? ts(c.released_at) : <span className="muted">held</span>}</td>
                          <td className="mono">{c.outcome ?? ""}</td>
                          <td>{c.reason ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="muted">none</div>
                )}
              </div>

              <div className="section">
                <h4>Messages</h4>
                {d.data?.messages?.length ? (
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>when</th>
                        <th>kind</th>
                        <th>from</th>
                        <th>to</th>
                        <th>body</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.messages.map((m) => (
                        <tr key={m.id}>
                          <td className="mono nowrap">{ts(m.created_at)}</td>
                          <td className="mono">
                            {m.kind}
                            {m.kind === "question" && !m.answered_at && !m.in_reply_to ? (
                              <span className="badge st-blocked" style={{ marginLeft: 6 }}>
                                open
                              </span>
                            ) : null}
                          </td>
                          <td>{m.from_name ?? "-"}</td>
                          <td>{m.to_role ?? "-"}</td>
                          <td className="prose">{m.body}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="muted">none</div>
                )}
              </div>

              <div className="section">
                <h4>Events</h4>
                {d.data?.events?.length ? (
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>ts</th>
                        <th>agent</th>
                        <th>type</th>
                        <th>payload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.events.map((e) => (
                        <tr key={e.id}>
                          <td className="mono nowrap">{ts(e.ts)}</td>
                          <td>{e.agent ?? ""}</td>
                          <td className="mono">{e.type}</td>
                          <td className="payload">{compact(e.payload, 200)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="muted">none</div>
                )}
              </div>
            </>
          ) : d.loading ? (
            <div className="empty">Loading…</div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
