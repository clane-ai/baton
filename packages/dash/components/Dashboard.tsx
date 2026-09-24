"use client";

import { useEffect, useMemo, useState } from "react";
import { usePoll, useTick } from "@/lib/usePoll";
import type { StatusResponse } from "@/lib/types";
import { agoMs } from "@/lib/format";
import NowView from "./NowView";
import BoardView from "./BoardView";
import FlowView from "./FlowView";
import RunsView from "./RunsView";
import StreamView from "./StreamView";
import AttentionView from "./AttentionView";
import SpendView from "./SpendView";
import InboxView from "./InboxView";

const TABS = ["inbox", "now", "board", "flow", "runs", "stream", "attention", "spend"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { inbox: "Inbox", now: "Now", board: "Board", flow: "Flow", runs: "Runs", stream: "Stream", attention: "Attention", spend: "Spend" };

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "now";
  const h = window.location.hash.replace(/^#/, "") as Tab;
  return TABS.includes(h) ? h : "inbox";
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("inbox");
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const select = (t: Tab) => {
    setTab(t);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${t}`);
  };

  // The status poll is shared: Now and Attention read it, the top bar shows freshness,
  // and the tab counters come from it.
  const status = usePoll<StatusResponse>("/api/status", 5000);
  const now = useTick(1000);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const f = () => setHidden(document.visibilityState === "hidden");
    f();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  const freshness = useMemo(() => {
    if (status.error) return { cls: "err", text: `error: ${status.error.message}` };
    if (!status.updatedAt) return { cls: "paused", text: "loading…" };
    const diff = now - status.updatedAt;
    return { cls: hidden ? "paused" : diff > 15000 ? "stale" : "", text: `updated ${agoMs(diff)}${hidden ? " (paused)" : ""}` };
  }, [status.error, status.updatedAt, now, hidden]);

  const attentionCount = status.data?.attention.length ?? 0;
  const inboxCount = status.data?.counts.needs_human ?? 0;
  const working = status.data?.agents.filter((a) => a.current_task).length ?? 0;
  const counts = status.data?.counts ?? {};
  const open = (counts.ready ?? 0) + (counts.in_progress ?? 0) + (counts.review ?? 0) + (counts.blocked ?? 0);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Baton<span>operator dashboard</span>
        </div>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t} type="button" className={`tab${tab === t ? " active" : ""}`} onClick={() => select(t)}>
              {LABEL[t]}
              {t === "now" && status.data ? <span className="count">{working}/{status.data.agents.length}</span> : null}
              {t === "board" && status.data ? <span className="count">{open}</span> : null}
              {t === "attention" ? <span className={`count${attentionCount ? " hot" : ""}`}>{attentionCount}</span> : null}
              {t === "inbox" ? <span className={`count${inboxCount ? " hot" : ""}`}>{inboxCount}</span> : null}
            </button>
          ))}
        </nav>
        <div className="status-right muted">
          <span>
            <span className={`pulse ${freshness.cls}`} />
            {freshness.text}
          </span>
          <button type="button" className="btn sm" onClick={() => void status.refresh()}>
            Refresh
          </button>
        </div>
      </header>

      <main className="view">
        {tab === "inbox" && <InboxView />}
        {tab === "now" && <NowView status={status} now={now} />}
        {tab === "board" && <BoardView />}
        {tab === "flow" && <FlowView />}
        {tab === "runs" && <RunsView />}
        {tab === "stream" && <StreamView />}
        {tab === "attention" && <AttentionView status={status} />}
        {tab === "spend" && <SpendView />}
      </main>
    </div>
  );
}
