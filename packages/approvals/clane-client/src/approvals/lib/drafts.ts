// Unsent decision reasons, kept per task in the browser only. Never sent, never read by the engine.
export type DraftStore = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

const key = (taskKey: string) => `baton.draft.${taskKey}`;

export function loadDraft(store: DraftStore | null, taskKey: string): string {
  try { return store?.getItem(key(taskKey)) ?? ""; } catch { return ""; }
}

export function saveDraft(store: DraftStore | null, taskKey: string, text: string): void {
  try {
    if (!text.trim()) store?.removeItem(key(taskKey));
    else store?.setItem(key(taskKey), text);
  } catch { /* storage unavailable: the draft lives in the field until the page closes */ }
}

export function clearDraft(store: DraftStore | null, taskKey: string): void {
  try { store?.removeItem(key(taskKey)); } catch { /* nothing to clear */ }
}
