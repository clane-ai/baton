import { getInbox } from '../api';
import {
  resetInboxStore,
  markActed,
  refreshInbox,
  snapshot,
  takeNotice,
  visible,
} from '../inboxStore';

jest.mock('../api', () => ({ ...jest.requireActual('../api'), getInbox: jest.fn() }));
const getInboxMock = getInbox as unknown as jest.Mock;

const item = (key: string, kind: 'approval' | 'parked' | 'question', since: string) => ({
  id: key,
  key,
  kind,
  state: kind === 'approval' ? 'needs_human' : 'failed',
  role: kind === 'approval' ? 'operator' : 'buyer',
  title: `Procure to pay: ${key}`,
  workflow_run: 'p2p-1',
  run_name: null,
  waiting_since: since,
  deadline: null,
  overdue: false,
  summary: null,
  next: [],
  attempts: 1,
  max_attempts: 3,
  cost_usd: 0,
  budget_usd: null,
});

const page = (items: ReturnType<typeof item>[], approvals: number) => ({
  ok: true,
  tiles: { approvals, parked: items.filter((i) => i.kind === 'parked').length, questions: 0, overdue: 0, total: items.length },
  items,
  next_cursor: null,
  nextCursor: null,
});

beforeEach(() => {
  resetInboxStore();
  getInboxMock.mockReset();
});

describe('inbox store', () => {
  it('always refreshes from the first page', async () => {
    getInboxMock.mockResolvedValue(page([item('A', 'approval', '2026-09-24T09:00:00Z')], 1));
    await refreshInbox();
    await refreshInbox();
    expect(getInboxMock).toHaveBeenCalledTimes(2);
    for (const call of getInboxMock.mock.calls) expect(call[0]).toBeNull();
  });

  it('hides an item the moment a person acts on it, and lowers the count with it', async () => {
    getInboxMock.mockResolvedValue(
      page([item('A', 'approval', '2026-09-24T09:00:00Z'), item('B', 'approval', '2026-09-24T09:05:00Z')], 2),
    );
    await refreshInbox();
    markActed('A', 'approval', 'Approved.');
    const v = visible(snapshot().response);
    expect(v?.items.map((i) => i.key)).toEqual(['B']);
    expect(v?.tiles.approvals).toBe(1);
  });

  it('keeps it hidden while the engine still lists it, and forgets it once the engine agrees', async () => {
    const both = page([item('A', 'approval', '2026-09-24T09:00:00Z'), item('B', 'approval', '2026-09-24T09:05:00Z')], 2);
    getInboxMock.mockResolvedValue(both); // the engine has not caught up yet
    await refreshInbox();
    markActed('A', 'approval', null); // starts a background refresh
    await refreshInbox(); // joins it
    expect(visible(snapshot().response)?.items.map((i) => i.key)).toEqual(['B']);
    expect(visible(snapshot().response)?.tiles.approvals).toBe(1);
    getInboxMock.mockResolvedValueOnce(page([item('B', 'approval', '2026-09-24T09:05:00Z')], 1));
    await refreshInbox();
    expect(visible(snapshot().response)?.tiles.approvals).toBe(1);
    expect(snapshot().acted.size).toBe(0);
  });

  it('treats an item a colleague decided first as simply gone, not as an error', async () => {
    getInboxMock.mockResolvedValueOnce(page([item('A', 'approval', '2026-09-24T09:00:00Z')], 1));
    await refreshInbox();
    getInboxMock.mockResolvedValueOnce(page([], 0));
    await refreshInbox();
    expect(snapshot().error).toBeUndefined();
    expect(visible(snapshot().response)?.items).toEqual([]);
  });

  it('keeps the last good queue when a refresh fails', async () => {
    getInboxMock.mockResolvedValueOnce(page([item('A', 'approval', '2026-09-24T09:00:00Z')], 1));
    await refreshInbox();
    getInboxMock.mockRejectedValueOnce(new Error('Baton is unreachable'));
    await refreshInbox();
    expect(snapshot().error?.message).toBe('Baton is unreachable');
    expect(visible(snapshot().response)?.items.map((i) => i.key)).toEqual(['A']);
  });

  it('hands the confirmation to the next screen once', () => {
    getInboxMock.mockResolvedValue(page([], 0));
    markActed('A', 'approval', 'Approved. Send purchase order is ready.');
    expect(takeNotice()).toBe('Approved. Send purchase order is ready.');
    expect(takeNotice()).toBeNull();
  });
});
