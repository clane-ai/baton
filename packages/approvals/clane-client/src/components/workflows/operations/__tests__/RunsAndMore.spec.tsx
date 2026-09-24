import { act, render as rtlRender, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';
import { WorkflowOperations } from '../Section';
import { SECTION_MOUNT } from '../paths';
import { getEvents } from '../data/api';
import { setOverrides } from '../data/__fixtures__/mockFacade';

jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runArtifacts = require('../data/__fixtures__/run-artifacts.json');

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


describe('Runs screen', () => {
  it('lists each run with its process, status and progress', async () => {
    open('/runs');
    const row = await screen.findByRole('link', { name: /p2p-122/ });
    expect(within(row).getByText('Procure to pay')).toBeInTheDocument();
    expect(within(row).getByText('Done')).toBeInTheDocument();
    expect(within(row).getByText('6 of 8 steps')).toBeInTheDocument();
    expect(row).toHaveAttribute('href', `${SECTION_MOUNT}/runs/p2p-122`);
  });

  it('says so when there are no runs', async () => {
    setOverrides({ getRuns: () => Promise.resolve({ runs: [], nextCursor: null }) });
    open('/runs');
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
  });
});

describe('Run screen', () => {
  it('shows the run, its workspace, every step and the branches not taken', async () => {
    open('/runs/p2p-122');
    expect(await screen.findByRole('heading', { name: 'Procure to pay p2p-122' })).toBeInTheDocument();
    expect(await screen.findByText('Workspace default')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(8);
    expect(within(steps).getAllByText(/Not taken/)).toHaveLength(2);
    expect(screen.getByRole('img', { name: /p2p-122/ })).toBeInTheDocument();
  });

  it("lists every artefact of the run under its own number", async () => {
    open('/runs/p2p-122');
    await screen.findByRole('heading', { name: 'Procure to pay p2p-122' });
    fireEvent.click(screen.getByRole('tab', { name: /Artefacts/ }));
    for (const n of ['PO-2026-103', 'INV-2026-103', 'GRN-2026-103', 'DN-2026-103', 'PAY-2026-103']) {
      expect((await screen.findAllByText(n)).length).toBeGreaterThan(0);
    }
  });

  it('opens one artefact as its document', async () => {
    open('/runs/p2p-122');
    await screen.findByRole('heading', { name: 'Procure to pay p2p-122' });
    fireEvent.click(screen.getByRole('tab', { name: /Artefacts/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Invoice INV-2026-103/ }));
    expect(await screen.findByText('Invoice number')).toBeInTheDocument();
  });

  it('asks for the activity of this run only', async () => {
    open('/runs/p2p-122');
    await screen.findByRole('heading', { name: 'Procure to pay p2p-122' });
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    await waitFor(() => expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ workflow_run: 'p2p-122' })));
  });

  it('says so for a run that does not exist', async () => {
    open('/runs/p2p-000');
    expect(await screen.findByText('This run does not exist')).toBeInTheDocument();
  });
});

describe('Documents screen', () => {
  const byKind = (kind: string) =>
    runArtifacts.artifacts.filter((a: { kind: string }) => a.kind === kind).map((a: Record<string, unknown>) => ({ ...a }));

  it('finds documents of a kind and opens one beside the list', async () => {
    setOverrides({ getArtifacts: (q: { kind?: string }) => Promise.resolve(byKind(q.kind ?? 'purchase_order')) });
    open('/documents');
    const row = await screen.findByRole('button', { name: /PO-2026-103/ });
    fireEvent.click(row);
    const detail = await screen.findByRole('region', { name: 'Purchase order PO-2026-103' });
    expect(within(detail).getByText('Nordlicht Computing GmbH (V-1001)')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open work item' })).toHaveAttribute('href', `${SECTION_MOUNT}/items/TSK-0926`);
  });

  it('switches the kind', async () => {
    setOverrides({ getArtifacts: (q: { kind?: string }) => Promise.resolve(byKind(q.kind ?? 'purchase_order')) });
    open('/documents');
    await screen.findByRole('button', { name: /PO-2026-103/ });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'invoice' } });
    expect(await screen.findByRole('button', { name: /INV-2026-103/ })).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    open('/documents');
    expect(await screen.findByText('No purchase orders yet')).toBeInTheDocument();
  });
});

describe('Activity screen', () => {
  const events = [
    { id: 2, ts: '2026-09-24T09:49:26Z', type: 'approved', payload: { by: 'operator:abhishek', reason: 'approve' }, agent: null, task_key: 'TSK-0927', session_id: null, task_id: null, agent_id: null },
    { id: 1, ts: '2026-09-24T09:40:00Z', type: 'task_claimed', payload: { attempts: 1 }, agent: 'buyer-1', task_key: 'TSK-0926', session_id: null, task_id: null, agent_id: null },
  ];

  it('tells what happened, newest first, with the step as a link', async () => {
    setOverrides({ getEvents: () => Promise.resolve({ events, nextCursor: null }) });
    open('/activity');
    expect(await screen.findByText('Approved by abhishek: approve')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TSK-0927' })).toHaveAttribute('href', `${SECTION_MOUNT}/items/TSK-0927`);
  });

  it('filters by run', async () => {
    setOverrides({ getEvents: () => Promise.resolve({ events, nextCursor: null }) });
    open('/activity');
    await screen.findByText('Approved by abhishek: approve');
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'p2p-122' } });
    await waitFor(() => expect(getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ workflow_run: 'p2p-122' })));
  });

  it('loads older events on request', async () => {
    const page2 = [{ ...events[1], id: 0, ts: '2026-09-24T09:00:00Z', type: 'task_created', payload: { actor: 'workflow' }, task_key: 'TSK-0926' }];
    setOverrides({
      getEvents: (q: { cursor?: string | null }) =>
        Promise.resolve(q.cursor ? { events: page2, nextCursor: null } : { events, nextCursor: 'c2' }),
    });
    open('/activity');
    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Step created by workflow')).toBeInTheDocument();
  });
});

describe('Spend screen', () => {
  it('shows totals, spend by role and the most expensive steps', async () => {
    setOverrides({
      getSpend: () =>
        Promise.resolve({
          ok: true,
          total_usd: 0.3875,
          total_credits: 120,
          by_task: [{ id: 't1', key: 'TSK-0926', title: 'Procure to pay: Raise purchase order', role: 'buyer', state: 'done', cost_usd: 0.25, budget_usd: 1 }],
          by_role: [{ role: 'buyer', cost_usd: 0.25, credits: 0 }],
          by_day: [{ day: '2026-09-24', cost_usd: 0.3875 }],
        }),
    });
    open('/spend');
    expect(await screen.findByText('Total spend')).toBeInTheDocument();
    expect(screen.getAllByText('$0.39').length).toBeGreaterThan(0);
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getAllByText('buyer').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /TSK-0926/ })).toHaveAttribute('href', `${SECTION_MOUNT}/items/TSK-0926`);
    expect(screen.getByRole('img', { name: 'Spend per day' })).toBeInTheDocument();
  });

  it('says so when nothing has been spent', async () => {
    open('/spend');
    expect(await screen.findByText('No spend recorded yet')).toBeInTheDocument();
  });
});
