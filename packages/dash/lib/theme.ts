// One place that maps engine states to the app's colour language (spec section 3).
export type Tone = "done" | "working" | "stuck" | "waiting" | "info" | "neutral";

const MAP: Record<string, Tone> = {
  done: "done",
  in_progress: "working",
  review: "working",
  blocked: "working",
  needs_human: "waiting",
  failed: "stuck",
  ready: "info",
  draft: "info",
  cancelled: "neutral",
};

export function stateTone(state: string): Tone {
  return MAP[state] ?? "neutral";
}

export function toneClass(t: Tone): string {
  return `tone-${t}`;
}

export function stateLabel(state: string): string {
  return state.replace(/_/g, " ");
}

/** Workflow run status (engine: pending, running, blocked, needs_human, failed, cancelled, done, empty). */
export function runTone(status: string): Tone {
  switch (status) {
    case "done": return "done";
    case "running": return "working";
    case "needs_human": return "waiting";
    case "failed": return "stuck";
    case "cancelled": return "neutral";
    default: return "info";
  }
}
