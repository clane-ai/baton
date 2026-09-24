"use client";

// The left rail: Work (the product face) and Operations (the console). The Inbox entry carries the
// live count of items waiting for a person, read from the same status poll the console uses.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Route, FileText, Activity, CircleDollarSign, Radar, Columns3, GitBranch, BellRing } from "lucide-react";
import type { ComponentType } from "react";
import { usePoll } from "@/lib/usePoll";
import type { StatusResponse } from "@/lib/types";

type Entry = readonly [href: string, label: string, Icon: ComponentType<{ size?: number }>];
const WORK: readonly Entry[] = [
  ["/inbox", "Inbox", Inbox],
  ["/runs", "Runs", Route],
  ["/documents", "Documents", FileText],
  ["/activity", "Activity", Activity],
  ["/spend", "Spend", CircleDollarSign],
];
const OPS: readonly Entry[] = [
  ["/ops/now", "Now", Radar],
  ["/ops/board", "Board", Columns3],
  ["/ops/flow", "Flow", GitBranch],
  ["/ops/attention", "Attention", BellRing],
];

export default function Rail() {
  const path = usePathname() ?? "";
  const status = usePoll<StatusResponse>("/api/status", 10000);
  const waiting = status.data?.counts.needs_human ?? 0;
  const entry = ([href, label, Icon]: Entry) => (
    <Link key={href} href={href} className={`rail-link${path === href || path.startsWith(href + "/") ? " on" : ""}`}>
      <Icon size={16} />
      <span>{label}</span>
      {href === "/inbox" && waiting ? <span className="rail-count">{waiting}</span> : null}
    </Link>
  );
  return (
    <aside className="rail">
      <div className="brand">Baton</div>
      <nav className="rail-group" aria-label="Work">
        <h4>Work</h4>
        {WORK.map(entry)}
      </nav>
      <nav className="rail-group" aria-label="Operations">
        <h4>Operations</h4>
        {OPS.map(entry)}
      </nav>
    </aside>
  );
}
