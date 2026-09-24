import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../i18n';

import { WorkflowOperations } from '../Section';
import { SECTION_MOUNT } from '../paths';

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

/**
 * Smoke coverage for the Workflow operational screens: the section mounts its
 * own router under SECTION_MOUNT, the tab row navigates between screens, the
 * waiting count comes from the status poll, and the router follows the
 * deployment base path. The data facade is mocked onto the engine captures.
 */
jest.mock('../data/api', () =>
  jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn),
);

type BaseWindow = typeof window & { __CLANE_BASE__?: string };

afterEach(() => {
  delete (window as BaseWindow).__CLANE_BASE__;
});

describe('Workflow operations section', () => {
  it('mounts under the workflows path, ahead of a workflow id', () => {
    expect(SECTION_MOUNT.startsWith('/app/build/workflows/')).toBe(true);
    expect(SECTION_MOUNT.split('/').length).toBe(5);
  });

  it('opens on Approvals with the section tabs and the waiting count', async () => {
    window.history.pushState({}, '', SECTION_MOUNT);
    render(<WorkflowOperations />);
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    for (const tab of ['Runs', 'Documents', 'Activity', 'Spend']) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByLabelText('3 waiting')).toBeInTheDocument());
  });

  it('moves between screens from the tab row and writes the URL', async () => {
    window.history.pushState({}, '', SECTION_MOUNT);
    render(<WorkflowOperations />);
    fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`${SECTION_MOUNT}/runs`);
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
  });

  it('follows the deployment base path', async () => {
    (window as BaseWindow).__CLANE_BASE__ = '/clane';
    window.history.pushState({}, '', `/clane${SECTION_MOUNT}/spend`);
    render(<WorkflowOperations />);
    expect(await screen.findByRole('heading', { name: 'Spend' })).toBeInTheDocument();
  });

  it('sends an unknown path back to Approvals', async () => {
    window.history.pushState({}, '', `${SECTION_MOUNT}/nowhere`);
    render(<WorkflowOperations />);
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
  });
});
