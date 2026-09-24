import { api, ApiError } from '../../../../../lib/api';
import {
  BASE,
  errorText,
  getInbox,
  getItem,
  documentPath,
  getDocumentText,
  getDocumentBlob,
  decide,
  answer,
  getRuns,
  getEvents,
  searchItems,
} from '../api';

jest.mock('../../../../../lib/api', () => ({
  ...jest.requireActual('../../../../../lib/api'),
  api: { get: jest.fn(), post: jest.fn(), blob: jest.fn() },
}));

const get = api.get as unknown as jest.Mock;
const post = api.post as unknown as jest.Mock;
const blob = (api as unknown as { blob: jest.Mock }).blob;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  blob.mockReset();
});

describe('errorText', () => {
  it('reads the proxy string error', () => {
    const e = new ApiError(502, 'HTTP 502', { ok: false, error: 'Baton is unreachable' });
    expect(errorText(e)).toBe('Baton is unreachable');
  });
  it("reads the engine's {code, message} error", () => {
    const e = new ApiError(404, 'HTTP 404', { ok: false, error: { code: 'NOT_FOUND', message: 'No such task' } });
    expect(errorText(e)).toBe('No such task');
  });
  it('falls back to the Error message', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
  });
  it('stringifies anything else', () => {
    expect(errorText('plain')).toBe('plain');
  });
});

describe('getInbox', () => {
  it('asks for the first page and maps next_cursor to nextCursor', async () => {
    get.mockResolvedValue({ ok: true, tiles: { approvals: 1, parked: 0, questions: 0, overdue: 0 }, items: [], next_cursor: 'c2', limit: 50 });
    const r = await getInbox();
    expect(get).toHaveBeenCalledWith(`${BASE}/inbox?limit=50`);
    expect(r.nextCursor).toBe('c2');
    expect(r.tiles.approvals).toBe(1);
  });
  it('passes the cursor, encoded', async () => {
    get.mockResolvedValue({ ok: true, tiles: {}, items: [], next_cursor: null });
    const r = await getInbox('a b', 20);
    expect(get).toHaveBeenCalledWith(`${BASE}/inbox?cursor=a%20b&limit=20`);
    expect(r.nextCursor).toBeNull();
  });
});

describe('getItem', () => {
  it('returns undefined on 404', async () => {
    get.mockRejectedValue(new ApiError(404, 'HTTP 404', { ok: false, error: { code: 'NOT_FOUND', message: 'x' } }));
    await expect(getItem('TSK-1')).resolves.toBeUndefined();
  });
  it('rethrows other errors', async () => {
    get.mockRejectedValue(new ApiError(502, 'HTTP 502', { ok: false, error: 'Baton is unreachable' }));
    await expect(getItem('TSK-1')).rejects.toBeInstanceOf(ApiError);
  });
  it('encodes the key', async () => {
    get.mockResolvedValue({ ok: true, task: { key: 'A/B' } });
    await getItem('A/B');
    expect(get).toHaveBeenCalledWith(`${BASE}/items/A%2FB`);
  });
});

describe('documents', () => {
  it('builds the streamed document path without the deployment base (the api wrapper adds it)', () => {
    (window as unknown as { __CLANE_BASE__?: string }).__CLANE_BASE__ = '/clane';
    expect(documentPath('TSK-1', 'abc')).toBe('/api/workflow-ops/items/TSK-1/documents/abc');
    delete (window as unknown as { __CLANE_BASE__?: string }).__CLANE_BASE__;
  });
  it('returns text bodies as they are', async () => {
    get.mockResolvedValue('From: a@b\r\n\r\nhello');
    await expect(getDocumentText('TSK-1', 'abc')).resolves.toBe('From: a@b\r\n\r\nhello');
  });
  it('pretty-prints JSON bodies the wrapper already parsed', async () => {
    get.mockResolvedValue({ total: 1 });
    await expect(getDocumentText('TSK-1', 'abc')).resolves.toBe('{\n  "total": 1\n}');
  });
  it('fetches binary documents as a blob through the authenticated wrapper', async () => {
    const b = new Blob(['%PDF'], { type: 'application/pdf' });
    blob.mockResolvedValue(b);
    await expect(getDocumentBlob('TSK-1', 'abc')).resolves.toBe(b);
    expect(blob).toHaveBeenCalledWith('/api/workflow-ops/items/TSK-1/documents/abc');
  });
});

describe('actions', () => {
  it('posts a decision with verdict and reason', async () => {
    post.mockResolvedValue({ ok: true });
    await decide('TSK-1', 'reject', 'escalate');
    expect(post).toHaveBeenCalledWith(`${BASE}/items/TSK-1/decision`, { verdict: 'reject', reason: 'escalate' });
  });
  it('posts an answer body keyed by the item', async () => {
    post.mockResolvedValue({ ok: true });
    await answer('TSK-1', 'Use the director band');
    expect(post).toHaveBeenCalledWith(`${BASE}/items/TSK-1/answer`, { body: 'Use the director band' });
  });
});

describe('paged lists', () => {
  it('maps runs next_cursor', async () => {
    get.mockResolvedValue({ ok: true, runs: [{ key: 'p2p-1' }], next_cursor: 'r2' });
    const r = await getRuns('r1');
    expect(get).toHaveBeenCalledWith(`${BASE}/runs?cursor=r1&limit=50`);
    expect(r).toEqual({ runs: [{ key: 'p2p-1' }], total: undefined, nextCursor: 'r2' });
  });
  it('drops empty filters from the events query', async () => {
    get.mockResolvedValue({ ok: true, events: [], next_cursor: null });
    await getEvents({ workflow_run: 'p2p-1', task: '', agent: undefined, limit: 100 });
    expect(get).toHaveBeenCalledWith(`${BASE}/events?workflow_run=p2p-1&limit=100`);
  });
  it('searches items with q and maps the page', async () => {
    get.mockResolvedValue({ ok: true, tasks: [], total: 0, next_cursor: null });
    const r = await searchItems({ q: 'PO-2026' });
    expect(get).toHaveBeenCalledWith(`${BASE}/items?q=PO-2026`);
    expect(r).toEqual({ tasks: [], total: 0, nextCursor: null });
  });
});
