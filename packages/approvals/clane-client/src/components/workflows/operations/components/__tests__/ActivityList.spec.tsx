import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../../i18n';

import { ActivityList } from '../ActivityList';

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

const ev = (id: number, ts: string, type: string, payload: unknown, agent: string | null = null) => ({
  id,
  ts,
  type,
  payload,
  agent,
  session_id: null,
});

describe('ActivityList', () => {
  const events = [
    ev(1, '2026-09-24T09:00:00Z', 'task_created', { actor: 'workflow' }),
    ev(2, '2026-09-24T09:01:00Z', 'heartbeat', {}, 'buyer-1'),
    ev(3, '2026-09-24T09:02:00Z', 'approved', { by: 'Abhishek Jha', reason: 'Within budget' }),
  ];

  it('tells the history in sentences, newest first, hiding noise', () => {
    render(<ActivityList events={events} />);
    const titles = screen.getAllByTestId('activity-title').map((n) => n.textContent);
    expect(titles).toEqual(['Approved by Abhishek Jha: Within budget', 'Step created by workflow']);
  });

  it('shows the noise on request', () => {
    render(<ActivityList events={events} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show everything (1 more)' }));
    expect(screen.getAllByTestId('activity-title')).toHaveLength(3);
  });

  it('names the step when asked to', () => {
    render(<ActivityList events={[{ ...events[2], task_key: 'TSK-7' }]} showKeys />);
    expect(screen.getByText('TSK-7')).toBeInTheDocument();
  });

  it('says so when nothing has happened', () => {
    render(<ActivityList events={[]} />);
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
  });
});
