import { act, render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';
import { WorkflowSection } from '../Section';
import { SECTION_MOUNT } from '../paths';
import { decide } from '../data/api';
import { resetInboxStore, snapshot, takeNotice, visible } from '../data/inboxStore';
import { setOverrides } from '../data/__fixtures__/mockFacade';

jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const detail = require('../data/__fixtures__/task-detail.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inbox = require('../data/__fixtures__/inbox.json');

/** The captured item, still waiting for a person. */
const waitingDetail = {
  ...detail,
  task: { ...detail.task, state: 'needs_human' },
  decision: null,
};

const open = (path: string, props: Partial<React.ComponentProps<typeof WorkflowSection>> = {}): void => {
  window.history.pushState({}, '', `${SECTION_MOUNT}${path}`);
  render(<WorkflowSection {...props} />);
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
    await screen.findByText('Requisition PR-2026-103');
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    expect(screen.getAllByTestId('activity-title').length).toBeGreaterThan(0);
  });

  it('offers the way back to Home, where the inbox is', async () => {
    const onHome = jest.fn();
    open('/items/TSK-0927', { onHome });
    await screen.findByRole('heading', { name: 'Purchase order PO-2026-103' });
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('after a decision, takes the item out of the queue and returns to Home with the confirmation', async () => {
    // The engine still lists the item for a moment after the decision.
    const listed = { ...inbox.items[0], key: 'TSK-0927', kind: 'approval' };
    setOverrides({
      getItem: () => Promise.resolve(waitingDetail),
      getInbox: () => Promise.resolve({ ...inbox, items: [listed, ...inbox.items], nextCursor: null }),
    });
    const onHome = jest.fn();
    open('/items/TSK-0927', { onHome });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onHome).toHaveBeenCalledTimes(1));
    expect(decide).toHaveBeenCalledWith('TSK-0927', 'approve', null);
    await waitFor(() => expect(snapshot().response).not.toBeNull());
    expect(snapshot().acted.get('TSK-0927')).toBe('approval');
    expect(visible(snapshot().response)?.items.map((i) => i.key)).not.toContain('TSK-0927');
    expect(takeNotice()).toMatch(/^Approved TSK-0927\./);
  });

  it('without a shell to return to, confirms on the item itself', async () => {
    setOverrides({ getItem: () => Promise.resolve(waitingDetail) });
    open('/items/TSK-0927');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/^Approved TSK-0927\./)).toBeInTheDocument();
  });

  it('says so for an item that does not exist, with the way back', async () => {
    const onHome = jest.fn();
    open('/items/TSK-0000', { onHome });
    expect(await screen.findByText('This work item does not exist')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Home' }).length).toBeGreaterThan(0);
  });
});
