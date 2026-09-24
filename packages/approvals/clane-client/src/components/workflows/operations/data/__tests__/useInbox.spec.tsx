import { act, renderHook, waitFor } from '@testing-library/react';

import { getInbox } from '../api';
import { markActed, refreshInbox, resetInboxStore } from '../inboxStore';
import { useInbox } from '../useInbox';

jest.mock('../api', () => ({ ...jest.requireActual('../api'), getInbox: jest.fn() }));
const getInboxMock = getInbox as unknown as jest.Mock;

const page = (keys: string[]) => ({
  ok: true,
  tiles: { approvals: keys.length, parked: 0, questions: 0, overdue: 0 },
  items: keys.map((key) => ({ key, kind: 'approval', waiting_since: '2026-09-24T09:00:00Z', overdue: false })),
  nextCursor: null,
});

beforeEach(() => {
  resetInboxStore();
  getInboxMock.mockReset();
});

describe('useInbox', () => {
  it('loads the queue on first use', async () => {
    getInboxMock.mockResolvedValue(page(['A']));
    const { result } = renderHook(() => useInbox(60000));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.items.map((i) => i.key)).toEqual(['A']));
    expect(result.current.loading).toBe(false);
  });

  it('shows the queue it already has at once when a screen mounts again, then refreshes', async () => {
    getInboxMock.mockResolvedValue(page(['A', 'B']));
    await refreshInbox();
    markActed('A', 'approval', null);
    getInboxMock.mockResolvedValue(page(['B', 'C']));
    const { result } = renderHook(() => useInbox(60000));
    // no loading state: the cached queue, without the acted item, is there on the first render
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.items.map((i) => i.key)).toEqual(['B']);
    await waitFor(() => expect(result.current.data?.items.map((i) => i.key)).toEqual(['B', 'C']));
  });

  it('refreshes on demand', async () => {
    getInboxMock.mockResolvedValue(page(['A']));
    const { result } = renderHook(() => useInbox(60000));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    getInboxMock.mockResolvedValue(page(['A', 'B']));
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
  });
});
