import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../../i18n';
import { MemoryRouter } from 'react-router-dom';

import { DecisionBar } from '../DecisionBar';
import { decide, retry, answer } from '../../data/api';
import type { Message, Task } from '../../data/types';

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

jest.mock('../../data/api', () => ({
  ...jest.requireActual('../../data/api'),
  decide: jest.fn(),
  retry: jest.fn(),
  answer: jest.fn(),
}));

const mocked = (f: unknown) => f as jest.Mock;

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 'id-1',
    key: 'TSK-1',
    role: 'operator',
    state: 'needs_human',
    title: 'Procure to pay: Approve purchase order',
    attempts: 1,
    max_attempts: 3,
    cost_usd: 0,
    budget_usd: null,
    ...over,
  }) as Task;

const next = [
  { key: 'TSK-2', title: 'Send purchase order', when: 'approve' },
  { key: 'TSK-3', title: 'Escalate to director', when: 'reject' },
];

function renderBar(props: Partial<React.ComponentProps<typeof DecisionBar>> = {}) {
  const onActed = jest.fn();
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DecisionBar
        task={task()}
        decision={null}
        questions={[]}
        next={next}
        onActed={onActed}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onActed };
}

beforeEach(() => {
  mocked(decide).mockReset().mockResolvedValue({ ok: true });
  mocked(retry).mockReset().mockResolvedValue({ ok: true, state: 'ready' });
  mocked(answer).mockReset().mockResolvedValue({ ok: true });
  window.localStorage.clear();
});

describe('DecisionBar: approval', () => {
  it('keeps Reject disabled until there is a reason', () => {
    renderBar();
    const reject = screen.getByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Above my authority' } });
    expect(reject).toBeEnabled();
  });

  it('approves once however often it is clicked, and reports what happens next', async () => {
    const { onActed } = renderBar();
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith('TSK-1', 'approve', null);
    expect(onActed).toHaveBeenCalledWith('approval', 'Approved TSK-1. Send purchase order is ready.');
  });

  it('rejects with the reason and names the rejection branch', async () => {
    const { onActed } = renderBar();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'escalate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(onActed).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('TSK-1', 'reject', 'escalate');
    expect(onActed).toHaveBeenCalledWith('approval', 'Rejected TSK-1. Escalate to director is ready.');
  });

  it('reports nothing when the engine refuses, and says why', async () => {
    mocked(decide).mockRejectedValueOnce(new Error('task is already done'));
    const { onActed } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('task is already done')).toBeInTheDocument();
    expect(onActed).not.toHaveBeenCalled();
  });

  it('keeps a draft reason across a reload of the screen', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Check the band' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(window.localStorage.getItem('baton.draft.TSK-1')).toBe('Check the band');
  });

  it('shows the engine error and lets the person try again', async () => {
    mocked(decide).mockRejectedValueOnce(new Error('Task is not waiting for approval'));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Task is not waiting for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});

describe('DecisionBar: other modes', () => {
  it('offers Retry for a parked step', async () => {
    const { onActed } = renderBar({ task: task({ role: 'buyer', state: 'failed', attempts: 3 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onActed).toHaveBeenCalledWith('parked', 'TSK-1 is back in the queue (ready).'));
    expect(retry).toHaveBeenCalledWith('TSK-1', { reason: null, reset_attempts: true });
  });

  it('shows an open question and sends the answer', async () => {
    const q: Message = {
      id: 'm1',
      kind: 'question',
      body: 'Which approval band applies?',
      from_name: 'buyer',
      to_role: null,
      in_reply_to: null,
      created_at: '2026-09-24T10:00:00Z',
      answered_at: null,
    };
    const { onActed } = renderBar({ task: task({ role: 'buyer', state: 'blocked' }), questions: [q] });
    expect(screen.getByText('Which approval band applies?')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send answer' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Director' } });
    fireEvent.click(send);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('TSK-1', 'Director'));
    await waitFor(() => expect(onActed).toHaveBeenCalledWith('question', 'Answer sent. TSK-1 is back in the queue.'));
  });

  it('shows who decided, by name', () => {
    renderBar({
      task: task({ state: 'done' }),
      decision: { verdict: 'approve', by: 'user:abc', at: '2026-09-24T10:03:00Z', reason: 'Within budget' },
      decidedByName: 'Abhishek Jha',
    });
    expect(screen.getByText(/Approved by Abhishek Jha/)).toBeInTheDocument();
    expect(screen.getByText(/Within budget/)).toBeInTheDocument();
    expect(screen.queryByText(/user:abc/)).not.toBeInTheDocument();
  });

  it('says there is nothing to decide for a running step', () => {
    renderBar({ task: task({ role: 'buyer', state: 'in_progress' }) });
    expect(screen.getByText('Nothing to decide here. This step is in progress.')).toBeInTheDocument();
  });
});
