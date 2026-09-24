import { act, render as rtlRender, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';
import { ApprovalsPanel } from '../components/ApprovalsPanel';
import { getInbox } from '../data/api';
import { markActed, refreshInbox, resetInboxStore } from '../data/inboxStore';
import { setOverrides } from '../data/__fixtures__/mockFacade';

jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

// Render inside the platform's i18n provider, as Home is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const inbox = require('../data/__fixtures__/inbox.json');

const approvalItem = {
  ...inbox.items[0],
  id: 'a-1',
  key: 'TSK-0927',
  kind: 'approval',
  state: 'needs_human',
  role: 'operator',
  title: 'Procure to pay: Approve purchase order',
  workflow_run: 'p2p-122',
  run_name: 'Procure to pay',
  waiting_since: '2026-09-22T09:00:00Z',
  summary: {
    document: 'PO-2026-103',
    counterparty: 'Nordlicht Computing GmbH',
    amount: 25200,
    currency: 'EUR',
    flags: ['level_director'],
    produced_by: 'buyer',
    produced_at: '2026-09-24T09:40:00Z',
  },
};

afterEach(async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  setOverrides({});
  resetInboxStore();
});

describe('Inbox panel: summary (Home)', () => {
  it('carries the design-system scope itself, since Home is outside the Workflow section', async () => {
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    expect(await screen.findByRole('region', { name: 'Waiting for you' })).toHaveClass('cl-ds');
  });

  it('shows how much is waiting and the oldest few, each linking to its work item', async () => {
    const onOpenItem = jest.fn();
    render(<ApprovalsPanel onOpenItem={onOpenItem} />);
    expect(await screen.findByText('3 waiting')).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /TSK-0798/ });
    expect(row).toHaveAttribute('href', '/app/workflow/items/TSK-0798');
    fireEvent.click(row);
    expect(onOpenItem).toHaveBeenCalledWith('TSK-0798');
  });

  it('shows no more than the summary rows, oldest first', async () => {
    render(<ApprovalsPanel onOpenItem={jest.fn()} summaryRows={2} />);
    await screen.findByText('3 waiting');
    const keys = screen.getAllByRole('link').map((a) => a.getAttribute('data-key'));
    expect(keys).toEqual(['TSK-0798', 'TSK-0804']);
    expect(screen.getByRole('button', { name: 'Show all 3' })).toBeInTheDocument();
  });

  it('leaves a modified click to the browser, so a new tab still works', async () => {
    const onOpenItem = jest.fn();
    render(<ApprovalsPanel onOpenItem={onOpenItem} />);
    fireEvent.click(await screen.findByRole('link', { name: /TSK-0798/ }), { ctrlKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('always asks for the first page, never a continuation', async () => {
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    await screen.findByText('3 waiting');
    for (const call of (getInbox as jest.Mock).mock.calls) expect(call[0]).toBeNull();
  });

  it('after a decision, shows the queue at once without the item and with the confirmation', async () => {
    setOverrides({
      getInbox: () => Promise.resolve({ ...inbox, tiles: { ...inbox.tiles, approvals: 1 }, items: [approvalItem, ...inbox.items], nextCursor: null }),
    });
    await refreshInbox();
    // The decision's own background refresh finishes (the engine still lists the item).
    await act(async () => {
      markActed('TSK-0927', 'approval', 'Approved TSK-0927. Send purchase order is ready.');
      await refreshInbox();
    });
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    // no loading step: the queue is there on the first render
    expect(screen.getByText('Approved TSK-0927. Send purchase order is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /TSK-0927/ })).not.toBeInTheDocument();
    expect(screen.getByText('3 waiting')).toBeInTheDocument();
    // Home's own refresh on arrival settles inside act.
    await act(async () => {
      await refreshInbox();
    });
  });

  it('lets an item a colleague decided first simply disappear', async () => {
    setOverrides({
      getInbox: () => Promise.resolve({ ...inbox, items: [approvalItem, ...inbox.items], nextCursor: null }),
    });
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    expect(await screen.findByRole('link', { name: /TSK-0927/ })).toBeInTheDocument();
    setOverrides({ getInbox: () => Promise.resolve({ ...inbox, nextCursor: null }) });
    await act(async () => {
      await refreshInbox();
    });
    expect(screen.queryByRole('link', { name: /TSK-0927/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    setOverrides({
      getInbox: () => Promise.resolve({ ok: true, tiles: { approvals: 0, parked: 0, questions: 0, overdue: 0 }, items: [], nextCursor: null }),
    });
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    expect(await screen.findByText('Nothing is waiting for you')).toBeInTheDocument();
  });

  it('explains an unconfigured server instead of an empty queue', async () => {
    const { ApiError } = jest.requireActual('../../../../lib/api');
    setOverrides({
      getInbox: () => Promise.reject(new ApiError(503, 'HTTP 503', { ok: false, error: 'Baton is not configured on this server' })),
    });
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    expect(await screen.findByText('Workflow is not connected on this server')).toBeInTheDocument();
  });
});

describe('Inbox panel: the whole list', () => {
  it('opens from the summary and shows counts and one list per kind', async () => {
    render(<ApprovalsPanel onOpenItem={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show all 3' }));
    expect(screen.getByText('Parked after attempts')).toBeInTheDocument();
    const parked = screen.getByRole('region', { name: 'Parked' });
    expect(within(parked).getAllByRole('link')).toHaveLength(3);
  });

  it('shows an approval with its document, counterparty, amount and policy flags', async () => {
    setOverrides({
      getInbox: () => Promise.resolve({ ...inbox, items: [approvalItem, ...inbox.items], nextCursor: null }),
    });
    render(<ApprovalsPanel initialMode="full" onOpenItem={jest.fn()} />);
    const row = await screen.findByRole('link', { name: /TSK-0927/ });
    expect(within(row).getByText('PO-2026-103')).toBeInTheDocument();
    expect(within(row).getByText('Nordlicht Computing GmbH')).toBeInTheDocument();
    expect(within(row).getByText('25,200.00 EUR')).toBeInTheDocument();
    expect(within(row).getByText('Review')).toBeInTheDocument();
  });

  it('narrows the list by search', async () => {
    render(<ApprovalsPanel initialMode="full" onOpenItem={jest.fn()} />);
    await screen.findByText('TSK-0798');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'TSK-0804' } });
    expect(screen.queryByText('TSK-0798')).not.toBeInTheDocument();
    expect(screen.getByText('TSK-0804')).toBeInTheDocument();
  });

  it('moves focus with j and k, and leaves Enter to whatever has focus', async () => {
    const onOpenItem = jest.fn();
    render(<ApprovalsPanel initialMode="full" onOpenItem={onOpenItem} />);
    const first = await screen.findByRole('link', { name: /TSK-0798/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /TSK-0804/ }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'k' });
    expect(document.activeElement).toBe(first);
    // Enter on another control, or anywhere else, never opens an item.
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    fireEvent.keyDown(refresh, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('ignores j with a modifier, so shortcuts like Ctrl+J keep working', async () => {
    render(<ApprovalsPanel initialMode="full" onOpenItem={jest.fn()} />);
    const first = await screen.findByRole('link', { name: /TSK-0798/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'j', ctrlKey: true });
    expect(document.activeElement).toBe(first);
  });

  it('reports a failed later page instead of losing it', async () => {
    setOverrides({
      getInbox: (cursor: string | null) =>
        cursor ? Promise.reject(new Error('Baton did not answer in time')) : Promise.resolve({ ...inbox, nextCursor: 'c2' }),
    });
    render(<ApprovalsPanel initialMode="full" onOpenItem={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getByText('Baton did not answer in time')).toBeInTheDocument());
  });
});
