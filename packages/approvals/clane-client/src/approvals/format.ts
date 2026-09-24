/** Formatting helpers shared by the Approvals pages. Locale en-GB, matching the hr build. */

/** "2026-09-24T10:03:00Z" → "24 Sep". Unparseable input passes through unchanged. */
export const shortDate = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

/** "2026-09-24T10:03:07Z" → "10:03:07" (local time). Unparseable input passes through unchanged. */
export const hhmmss = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/** "2026-09-24T10:03:00Z" → "24 Sep 2026, 10:03" (local time). */
export const dateTime = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** count(1, 'item', 'items') → "1 item"; count(3, 'item', 'items') → "3 items". */
export const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
