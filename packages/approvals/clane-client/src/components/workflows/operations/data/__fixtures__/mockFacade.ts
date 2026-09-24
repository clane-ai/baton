// The data facade mocked onto the engine captures next to this file, for specs:
//
//   jest.mock('../data/api', () =>
//     jest.requireActual('../data/__fixtures__/mockFacade').mockFacade(jest.requireActual('../data/api'), jest.fn));
//
// A spec may replace single calls for one case with setOverrides(). No test
// runner globals here, so this file type-checks with the app and Jest never
// mistakes it for a suite. Only specs import it.
import inbox from './inbox.json';
import detail from './task-detail.json';
import documents from './task-documents.json';
import run from './workflow-run.json';
import runArtifacts from './run-artifacts.json';

type Fn = (...args: never[]) => unknown;

let overrides: Record<string, Fn> = {};

export function setOverrides(next: Record<string, Fn>): void {
  overrides = next;
}

export function mockFacade(real: Record<string, unknown>, spy: <F extends Fn>(impl: F) => F): Record<string, unknown> {
  const base: Record<string, Fn> = {
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
    decide: () => Promise.resolve({ ok: true }),
    retry: () => Promise.resolve({ ok: true, state: 'ready' }),
    answer: () => Promise.resolve({ ok: true }),
  };
  const facade: Record<string, unknown> = { ...real };
  for (const name of Object.keys(base)) {
    facade[name] = spy(((...args: never[]) => (overrides[name] ?? base[name])(...args)) as Fn);
  }
  return facade;
}
