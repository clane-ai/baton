import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsync, usePaged, usePoll } from '../hook';

describe('useAsync', () => {
  it('loads once and exposes the data', async () => {
    const load = jest.fn().mockResolvedValue(7);
    const { result } = renderHook(() => useAsync(load, []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(result.current.loading).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('surfaces the error', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error('nope')), []));
    await waitFor(() => expect(result.current.error?.message).toBe('nope'));
  });
});

describe('usePaged', () => {
  const pages: Record<string, { items: { key: string }[]; nextCursor: string | null }> = {
    first: { items: [{ key: 'A' }, { key: 'B' }], nextCursor: 'c2' },
    c2: { items: [{ key: 'B' }, { key: 'C' }], nextCursor: null },
  };
  it('appends pages without duplicates and stops at the end', async () => {
    const loadPage = jest.fn((c: string | null) => Promise.resolve(pages[c ?? 'first']));
    const { result } = renderHook(() => usePaged(loadPage, []));
    await waitFor(() => expect(result.current.items.map((i) => i.key)).toEqual(['A', 'B']));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((i) => i.key)).toEqual(['A', 'B', 'C']));
    expect(result.current.hasMore).toBe(false);
    expect(loadPage).toHaveBeenLastCalledWith('c2');
  });
  it('reload starts again from the first page', async () => {
    const loadPage = jest.fn((c: string | null) => Promise.resolve(pages[c ?? 'first']));
    const { result } = renderHook(() => usePaged(loadPage, []));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items.map((i) => i.key)).toEqual(['A', 'B']));
    expect(result.current.hasMore).toBe(true);
  });
});

describe('usePoll', () => {
  afterEach(() => jest.useRealTimers());
  it('reloads on the interval and keeps the last good data across an error', async () => {
    jest.useFakeTimers();
    let n = 0;
    const load = jest.fn(() => {
      n += 1;
      return n === 2 ? Promise.reject(new Error('blip')) : Promise.resolve(n);
    });
    const { result } = renderHook(() => usePoll(load, [], 5000));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toBe(1);
    expect(result.current.updatedAt).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(1);
    expect(result.current.error?.message).toBe('blip');
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.data).toBe(3);
    expect(result.current.error).toBeUndefined();
  });
});
