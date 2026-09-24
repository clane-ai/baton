import { act, render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';
import { WorkflowSection } from '../Section';
import { SECTION_MOUNT } from '../paths';
import { resetInboxStore } from '../data/inboxStore';

/**
 * The Workflow section as the shell mounts it: its own router under
 * SECTION_MOUNT, a tab row for the screens, Definitions hosting the studio the
 * shell passes in, the workflow-ops gate, and the deployment base path. The
 * data facade is mocked onto the engine captures.
 */
jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

type BaseWindow = typeof window & { __CLANE_BASE__?: string };

// Screens keep loading after a test's last assertion; let that settle inside act.
afterEach(async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  delete (window as BaseWindow).__CLANE_BASE__;
  resetInboxStore();
});

const studio = <div>Workflow studio</div>;

describe('Workflow section', () => {
  it('is a top-level section of the main client', () => {
    expect(SECTION_MOUNT).toBe('/app/workflow');
  });

  it('opens on Runs, with a tab for every screen and none for an inbox', async () => {
    window.history.pushState({}, '', SECTION_MOUNT);
    render(<WorkflowSection definitions={studio} />);
    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`${SECTION_MOUNT}/runs`);
    for (const tab of ['Runs', 'Documents', 'Activity', 'Spend', 'Definitions']) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
  });

  it('moves between screens from the tab row and writes the URL', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/runs`);
    render(<WorkflowSection definitions={studio} />);
    fireEvent.click(screen.getByRole('link', { name: 'Spend' }));
    expect(await screen.findByRole('heading', { name: 'Spend' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`${SECTION_MOUNT}/spend`);
    expect(screen.getByRole('link', { name: 'Spend' })).toHaveAttribute('aria-current', 'page');
  });

  it('hosts the studio under Definitions, including a workflow of its own', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/definitions/wf-1`);
    render(<WorkflowSection definitions={studio} />);
    expect(await screen.findByText('Workflow studio')).toBeInTheDocument();
  });

  it('keeps the studio when the workflow-ops module is off, and only the studio', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/runs`);
    render(<WorkflowSection opsEnabled={false} definitions={studio} />);
    expect(await screen.findByText('Workflow studio')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`${SECTION_MOUNT}/definitions`);
    for (const tab of ['Runs', 'Documents', 'Activity', 'Spend']) {
      expect(screen.queryByRole('link', { name: tab })).not.toBeInTheDocument();
    }
  });

  it('never opens a work item when the module is off', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/items/TSK-0927`);
    render(<WorkflowSection opsEnabled={false} definitions={studio} />);
    expect(await screen.findByText('Workflow studio')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Purchase order/ })).not.toBeInTheDocument();
  });

  it("speaks the app's own design language: its type, accent, surfaces and radii", async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/runs`);
    const { container } = render(<WorkflowSection definitions={studio} />);
    await screen.findByRole('heading', { name: 'Runs' });
    const root = container.querySelector('.cl-ds') as HTMLElement;
    expect(root.style.getPropertyValue('--font-body')).toBe('var(--font-sans)');
    expect(root.style.getPropertyValue('--font-display')).toBe('var(--font-heading)');
    expect(root.style.getPropertyValue('--blue-500')).toBe('var(--accent)');
    expect(root.style.getPropertyValue('--cta')).toBe('var(--accent)');
    expect(root.style.getPropertyValue('--surface-card')).toBe('var(--ink-1)');
    expect(root.style.getPropertyValue('--radius-btn')).toBe('var(--r-md)');
  });

  it('gives an open workflow the whole height: no tab row above the studio', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/definitions/wf-1`);
    render(<WorkflowSection definitions={studio} />);
    await screen.findByText('Workflow studio');
    expect(screen.queryByRole('navigation', { name: 'Workflow operations' })).not.toBeInTheDocument();
  });

  it('keeps the tab row on the list of definitions', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/definitions`);
    render(<WorkflowSection definitions={studio} />);
    await screen.findByText('Workflow studio');
    expect(screen.getByRole('navigation', { name: 'Workflow operations' })).toBeInTheDocument();
  });

  it('keeps the section standing when one screen fails, with a way to try again', async () => {
    const Boom = (): JSX.Element => {
      throw new Error('boom');
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    window.history.pushState({}, '', `${SECTION_MOUNT}/definitions`);
    render(<WorkflowSection definitions={<Boom />} />);
    expect(await screen.findByText('This screen could not be shown')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Workflow operations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('follows the deployment base path', async () => {
    (window as BaseWindow).__CLANE_BASE__ = '/clane';
    window.history.pushState({}, '', `/clane${SECTION_MOUNT}/spend`);
    render(<WorkflowSection definitions={studio} />);
    expect(await screen.findByRole('heading', { name: 'Spend' })).toBeInTheDocument();
  });

  it('sends an unknown path to Runs', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/nowhere`);
    render(<WorkflowSection definitions={studio} />);
    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeInTheDocument();
  });
});
