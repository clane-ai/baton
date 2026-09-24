"use client";

// The operator console, unchanged in behaviour, one screen per /ops route.
import { usePoll, useTick } from "@/lib/usePoll";
import type { StatusResponse } from "@/lib/types";
import NowView from "@/components/NowView";
import BoardView from "@/components/BoardView";
import FlowView from "@/components/FlowView";
import AttentionView from "@/components/AttentionView";

import type { OpsViewName } from "@/lib/ops";

export default function OpsView({ view }: { view: OpsViewName }) {
  const status = usePoll<StatusResponse>("/api/status", 5000);
  const now = useTick(1000);
  if (view === "now") return <NowView status={status} now={now} />;
  if (view === "board") return <BoardView />;
  if (view === "flow") return <FlowView />;
  return <AttentionView status={status} />;
}
