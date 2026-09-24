// Who decided, as a person. The engine records the actor verbatim: `user:<id>`
// when the platform proxy forwarded a signed-in user (X-Baton-Actor), with the
// user's email as a label in the event payload (X-Baton-Actor-Label), or
// `operator:<owner>` for a direct operator-token call. A raw platform id is
// never shown; the caller falls back to a neutral word when this returns null.

type Me = { id: string; name?: string; username?: string; email?: string } | null | undefined;
type Ev = { type: string; payload: unknown };

const LABEL_KEYS = ['by_label', 'actor_label', 'label'];
const DECISION_EVENTS = new Set(['approved', 'rejected', 'task_retried', 'task_cancelled', 'question_answered']);

function labelFromEvents(by: string, events: Ev[]): string | null {
  for (const e of events) {
    if (!DECISION_EVENTS.has(e.type)) continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.by !== by) continue;
    for (const k of LABEL_KEYS) {
      const v = p[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

export function personName(by: string | null | undefined, me: Me, events: Ev[]): string | null {
  const who = (by ?? '').trim();
  if (!who) return null;
  if (who.startsWith('user:')) {
    const id = who.slice('user:'.length);
    if (me && me.id === id) return me.name || me.username || me.email || null;
    return labelFromEvents(who, events);
  }
  if (who.startsWith('operator:')) return who.slice('operator:'.length) || null;
  return who;
}
