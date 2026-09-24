// One inbox for the whole client. Home's summary panel and the full list read
// the same snapshot, so they cannot drift, and a return to Home after a
// decision shows the queue at once instead of a cold load.
//
// Acting on an item (approve, reject, retry, answer) hides it immediately
// and lowers its count; the next refresh reconciles. While the engine still
// lists an acted item it stays hidden (the engine may lag a moment); once the
// engine stops listing it the local mark is dropped. An item that vanishes
// because a colleague acted first simply disappears: that is normal, not an
// error. The summary always wants the oldest items, so every refresh asks for
// the first page and never follows a cursor.
import { getInbox } from './api';
import type { InboxKind, InboxResponse } from './types';

export type InboxPage = InboxResponse & { nextCursor: string | null };
export type InboxSnapshot = {
  response: InboxPage | null;
  error?: Error;
  updatedAt: number | null;
  /** Items acted on here that the engine may still list: key → kind. */
  acted: Map<string, InboxKind>;
};

const FIRST_PAGE = 50;
const TILE: Record<InboxKind, 'approvals' | 'parked' | 'questions'> = {
  approval: 'approvals',
  parked: 'parked',
  question: 'questions',
};

let state: InboxSnapshot = { response: null, updatedAt: null, acted: new Map() };
let notice: string | null = null;
let inflight: Promise<void> | null = null;
let again = false;
const listeners = new Set<() => void>();

function set(next: Partial<InboxSnapshot>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function snapshot(): InboxSnapshot {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The response with acted items removed and their counts taken off. */
export function visible(r: InboxPage | null): InboxPage | null {
  if (!r) return null;
  const acted = state.acted;
  if (!acted.size) return r;
  const tiles = { ...r.tiles };
  const items = r.items.filter((i) => {
    if (!acted.has(i.key)) return true;
    const t = TILE[i.kind];
    tiles[t] = Math.max(0, (tiles[t] ?? 0) - 1);
    if (tiles.total != null) tiles.total = Math.max(0, tiles.total - 1);
    if (i.overdue) tiles.overdue = Math.max(0, tiles.overdue - 1);
    return false;
  });
  return { ...r, tiles, items };
}

/**
 * Load the first page. A caller that arrives while a load is in flight gets
 * one more load after it, so a refresh asked for after an action always sees
 * the state after that action. Callers during the same flight share it.
 */
export function refreshInbox(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  const run = (): Promise<void> =>
    getInbox(null, FIRST_PAGE).then(
      (r) => {
        const listed = new Set(r.items.map((i) => i.key));
        const acted = new Map([...state.acted].filter(([key]) => listed.has(key)));
        set({ response: r, error: undefined, updatedAt: Date.now(), acted });
      },
      (e: unknown) => set({ error: e instanceof Error ? e : new Error(String(e)) }),
    );
  inflight = (async () => {
    do {
      again = false;
      await run();
    } while (again);
    inflight = null;
  })();
  return inflight;
}

/** A person acted on `key`: hide it now, leave a confirmation for the next screen, refresh behind. */
export function markActed(key: string, kind: InboxKind, confirmation: string | null): void {
  const acted = new Map(state.acted);
  acted.set(key, kind);
  notice = confirmation;
  set({ acted });
  void refreshInbox();
}

/** The confirmation left by the last action, once. */
export function takeNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}

/** Tests only. */
export function resetInboxStore(): void {
  state = { response: null, updatedAt: null, acted: new Map() };
  notice = null;
  inflight = null;
  again = false;
  listeners.clear();
}
