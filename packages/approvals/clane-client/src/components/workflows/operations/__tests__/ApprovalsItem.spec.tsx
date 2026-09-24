import { act, render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';

import { WorkflowOperations } from '../Section';
import { SECTION_MOUNT } from '../paths';
import { setOverrides } from '../data/__fixtures__/mockFacade';

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

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

const open = (path: string): void => {
  window.history.pushState({}, '', `${SECTION_MOUNT}${path}`);
  render(<WorkflowOperations />);
};

afterEach(() => setOverrides({}));

// Screens keep loading (documents, the inbox, polls) after a test's last
// assertion; let those settle inside act before the test ends.
afterEach(async () => {
  // A few ticks: navigations render as transitions, a little after the click.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
});


describe('Approvals screen', () => {
  it('shows the counts and a row for every waiting item', async () => {
    open('');
    expect(await screen.findByText('TSK-0798')).toBeInTheDocument();
    for (const key of ['TSK-0804', 'TSK-0806']) expect(screen.getByText(key)).toBeInTheDocument();
    const parked = screen.getByRole('region', { name: 'Parked' });
    expect(within(parked).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByText('Parked after attempts')).toBeInTheDocument();
  });

  it('shows an approval with its document, counterparty, amount and policy flags', async () => {
    setOverrides({
      getInbox: () =>
        Promise.resolve({
          ...inbox,
          tiles: { ...inbox.tiles, approvals: 1 },
          items: [approvalItem, ...inbox.items],
          nextCursor: null,
        }),
    });
    open('');
    const row = await screen.findByRole('link', { name: /TSK-0927/ });
    expect(within(row).getByText('PO-2026-103')).toBeInTheDocument();
    expect(within(row).getByText('Nordlicht Computing GmbH')).toBeInTheDocument();
    expect(within(row).getByText('25,200.00 EUR')).toBeInTheDocument();
    expect(within(row).getByText('Review')).toBeInTheDocument();
    expect(row).toHaveAttribute('href', `${SECTION_MOUNT}/items/TSK-0927`);
  });

  it('narrows the list by search', async () => {
    open('');
    await screen.findByText('TSK-0798');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'TSK-0804' } });
    expect(screen.queryByText('TSK-0798')).not.toBeInTheDocument();
    expect(screen.getByText('TSK-0804')).toBeInTheDocument();
  });

  it('opens the selected row from the keyboard', async () => {
    open('');
    await screen.findByText('TSK-0798');
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(window.location.pathname).toBe(`${SECTION_MOUNT}/items/TSK-0804`);
    // The item screen opens (this fixture has no detail for TSK-0804).
    expect(await screen.findByText('This work item does not exist')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    setOverrides({
      getInbox: () =>
        Promise.resolve({ ok: true, tiles: { approvals: 0, parked: 0, questions: 0, overdue: 0 }, items: [], nextCursor: null }),
    });
    open('');
    expect(await screen.findByText('Nothing is waiting for you')).toBeInTheDocument();
  });

  it('explains an unconfigured server instead of an empty list', async () => {
    const { ApiError } = jest.requireActual('../../../../lib/api');
    setOverrides({
      getInbox: () => Promise.reject(new ApiError(503, 'HTTP 503', { ok: false, error: 'Baton is not configured on this server' })),
    });
    open('');
    expect(await screen.findByText('Workflow is not connected on this server')).toBeInTheDocument();
  });
});

describe('Work item screen', () => {

  it('shows the business document, its source documents and the decision by name', async () => {
    open('/items/TSK-0927');
    expect(await screen.findByRole('heading', { name: 'Purchase order PO-2026-103' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /requester email/ })).toBeInTheDocument();
    expect(await screen.findByText(/Approved by abhishek/)).toBeInTheDocument();
    expect(screen.queryByText(/operator:abhishek/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'p2p-122' })).toHaveAttribute('href', `${SECTION_MOUNT}/runs/p2p-122`);
  });

  it('switches to the activity tab', async () => {
    open('/items/TSK-0927');
    await screen.findByRole('heading', { name: 'Purchase order PO-2026-103' });
    // The first source document has loaded before the switch.
    await screen.findByText('Requisition PR-2026-103');
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    expect(screen.getAllByTestId('activity-title').length).toBeGreaterThan(0);
  });

  it('says so for an item that does not exist', async () => {
    open('/items/TSK-0000');
    expect(await screen.findByText('This work item does not exist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Approvals' })).toBeInTheDocument();
  });
});
