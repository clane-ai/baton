import { render, screen, fireEvent } from '@testing-library/react';
import { ApiError } from '../../../../../lib/api';
import { ErrorBanner, Loading, NothingHere } from '../States';
import { Page, Meta } from '../page';
import { paths } from '../../paths';

describe('paths', () => {
  it('builds every screen path relative to the section root, encoding keys', () => {
    expect(paths.approvals()).toBe('/');
    expect(paths.item('TSK-0919')).toBe('/items/TSK-0919');
    expect(paths.item('A/B')).toBe('/items/A%2FB');
    expect(paths.runs()).toBe('/runs');
    expect(paths.run('p2p-121')).toBe('/runs/p2p-121');
    expect(paths.documents()).toBe('/documents');
    expect(paths.activity()).toBe('/activity');
    expect(paths.spend()).toBe('/spend');
  });
});

describe('States', () => {
  it('shows the engine message and offers a retry', () => {
    const retry = jest.fn();
    render(
      <ErrorBanner
        error={new ApiError(502, 'HTTP 502', { ok: false, error: 'Baton is unreachable' })}
        onRetry={retry}
      />,
    );
    expect(screen.getByText("Couldn't load this")).toBeInTheDocument();
    expect(screen.getByText('Baton is unreachable')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('explains an unconfigured server in plain words', () => {
    render(
      <ErrorBanner
        error={new ApiError(503, 'HTTP 503', { ok: false, error: 'Baton is not configured on this server' })}
      />,
    );
    expect(screen.getByText('Workflow is not connected on this server')).toBeInTheDocument();
  });
  it('renders an empty state with its hint', () => {
    render(<NothingHere title="Nothing waiting for you" hint="New approvals appear here." />);
    expect(screen.getByText('Nothing waiting for you')).toBeInTheDocument();
    expect(screen.getByText('New approvals appear here.')).toBeInTheDocument();
  });
  it('announces loading to assistive technology', () => {
    render(<Loading rows={2} />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });
});

describe('page frame', () => {
  it('renders breadcrumb, title, actions and body', () => {
    render(
      <Page breadcrumb="Workflow" title="Approvals" actions={<button type="button">Refresh</button>}>
        <p>body</p>
      </Page>,
    );
    expect(screen.getByText('Workflow')).toBeInTheDocument();
    expect(screen.getByText('Approvals')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('joins meta parts with a separator and drops empty ones', () => {
    const { container } = render(<Meta parts={['p2p-121', null, 'buyer']} />);
    expect(container.textContent).toBe('p2p-121 · buyer');
  });
});
