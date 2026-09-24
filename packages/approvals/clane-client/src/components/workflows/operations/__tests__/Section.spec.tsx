import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { WorkflowOperations } from '../Section';
import { SECTION_MOUNT } from '../paths';

/**
 * Smoke coverage for the Workflow operational screens: the section mounts its
 * own router under SECTION_MOUNT, the tab row navigates between screens, the
 * waiting count comes from the status poll, and the router follows the
 * deployment base path. The data facade is mocked onto the engine captures.
 */
jest.mock('../data/api', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const inbox = require('../data/__fixtures__/inbox.json');
  const detail = require('../data/__fixtures__/task-detail.json');
  const documents = require('../data/__fixtures__/task-documents.json');
  const run = require('../data/__fixtures__/workflow-run.json');
  const runArtifacts = require('../data/__fixtures__/run-artifacts.json');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const real = jest.requireActual('../data/api');
  return {
    ...real,
    getInbox: () => Promise.resolve({ ...inbox, nextCursor: null }),
    getItem: (key: string) => Promise.resolve(key === detail.task.key ? detail : undefined),
    getItemDocuments: () => Promise.resolve({ workspace: documents.workspace, documents: documents.documents }),
    getDocumentText: () => Promise.resolve('Subject: Requisition PR-2026-103\r\n\r\nPlease order.'),
    getDocumentBlob: () => Promise.resolve(new Blob(['%PDF'])),
    getRuns: () => Promise.resolve({ runs: [run.run], nextCursor: null }),
    getRun: (key: string) => Promise.resolve(key === run.run.key ? run.run : undefined),
    getRunArtifacts: () =>
      Promise.resolve({ run: runArtifacts.run, workspace: runArtifacts.workspace, artifacts: runArtifacts.artifacts }),
    getEvents: () => Promise.resolve({ events: [], nextCursor: null }),
    getArtifacts: () => Promise.resolve([]),
    searchItems: () => Promise.resolve({ tasks: [], total: 0, nextCursor: null }),
    getSpend: () => Promise.resolve({ ok: true, total_usd: 0, by_task: [], by_role: [], by_day: [] }),
    getStatus: () => Promise.resolve({ ok: true, agents: [], counts: { needs_human: 3 }, attention: [] }),
    decide: jest.fn(() => Promise.resolve({ ok: true })),
    retry: jest.fn(() => Promise.resolve({ ok: true })),
    answer: jest.fn(() => Promise.resolve({ ok: true })),
  };
});

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
