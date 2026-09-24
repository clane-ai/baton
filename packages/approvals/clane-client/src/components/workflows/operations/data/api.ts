// The Approvals area's only door to the server: every call goes through the
// platform's authenticated wrapper to the /api/approvals proxy
// (docs/api/approvals-proxy.md). The client never holds Baton's operator token
// and never calls Baton directly. The proxy relays Baton's `{ ok, … }` bodies
// unchanged; this module unwraps them and maps `next_cursor` to `nextCursor`.
//
// Paths here are API-relative. The wrapper prefixes the deployment base
// (appBase) itself, so nothing in this file calls withBase.
import { api, ApiError } from '../../../../lib/api';
import type {
  Artifact,
  DocumentsResponse,
  InboxResponse,
  RunArtifactsResponse,
  SpendResponse,
  StatusResponse,
  StreamEvent,
  Task,
  TaskDetailResponse,
  WorkflowRun,
} from './types';

export const BASE = '/api/approvals';

type Query = Record<string, string | number | boolean | null | undefined>;

/** `?a=1&b=x` from the defined, non-empty entries, in insertion order; '' when none. */
function qs(q: Query): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

const seg = (s: string): string => encodeURIComponent(s);

/**
 * One line for a failed call. The proxy's own errors carry a string
 * (`{ ok: false, error: "Baton is unreachable" }`); Baton's carry
 * `{ code, message }`; anything else falls back to the Error message.
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const err = (e.body as { error?: unknown } | null)?.error;
    if (typeof err === 'string' && err) return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

// ---- inbox and items ----

export async function getInbox(
  cursor?: string | null,
  limit = 50,
): Promise<InboxResponse & { nextCursor: string | null }> {
  const r = await api.get<InboxResponse>(`${BASE}/inbox${qs({ cursor, limit })}`);
  return { ...r, nextCursor: r.next_cursor ?? null };
}

/** The item with its artefacts, events, decision, questions and documents; undefined when there is no such item. */
export async function getItem(key: string): Promise<TaskDetailResponse | undefined> {
  try {
    return await api.get<TaskDetailResponse>(`${BASE}/items/${seg(key)}`);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

export async function getItemDocuments(
  key: string,
): Promise<{ workspace: string; documents: DocumentsResponse['documents'] }> {
  const r = await api.get<DocumentsResponse>(`${BASE}/items/${seg(key)}/documents`);
  return { workspace: r.workspace, documents: r.documents ?? [] };
}

/** API path of one streamed document. Documents are addressed by id only. */
export function documentPath(key: string, id: string): string {
  return `${BASE}/items/${seg(key)}/documents/${seg(id)}`;
}

/**
 * A text document's body. The wrapper returns non-JSON responses as text
 * (.eml, .md, .txt) and parses JSON ones, which come back pretty-printed.
 */
export async function getDocumentText(key: string, id: string): Promise<string> {
  const body = await api.get<unknown>(documentPath(key, id));
  if (typeof body === 'string') return body;
  return JSON.stringify(body, null, 2);
}

/**
 * A binary document (PDF) as a Blob. An <iframe src> cannot carry the bearer
 * token, so the viewer fetches through the wrapper and shows an object URL.
 */
export function getDocumentBlob(key: string, id: string): Promise<Blob> {
  return api.blob(documentPath(key, id));
}

export function searchItems(q: {
  q?: string;
  state?: string;
  role?: string;
  workflow_run?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ tasks: Task[]; total: number; nextCursor: string | null }> {
  return api
    .get<{ ok: true; tasks: Task[]; total: number; next_cursor?: string | null }>(`${BASE}/items${qs(q)}`)
    .then((r) => ({ tasks: r.tasks ?? [], total: r.total ?? 0, nextCursor: r.next_cursor ?? null }));
}

// ---- actions ----

/** Approve or reject a gate. `reason` is required by the engine for a rejection. */
export function decide(key: string, verdict: 'approve' | 'reject', reason: string | null): Promise<unknown> {
  return api.post(`${BASE}/items/${seg(key)}/decision`, { verdict, reason });
}

export function retry(
  key: string,
  o: { reason?: string | null; budget_usd?: number; deadline?: string; reset_attempts?: boolean } = {},
): Promise<unknown> {
  return api.post(`${BASE}/items/${seg(key)}/retry`, o);
}

/** Answer the item's open question. The proxy sets task_key from the URL. */
export function answer(key: string, body: string): Promise<unknown> {
  return api.post(`${BASE}/items/${seg(key)}/answer`, { body });
}

// ---- runs ----

export function getRuns(
  cursor?: string | null,
  limit = 50,
): Promise<{ runs: WorkflowRun[]; total?: number; nextCursor: string | null }> {
  return api
    .get<{ ok: true; runs: WorkflowRun[]; total?: number; next_cursor?: string | null }>(
      `${BASE}/runs${qs({ cursor, limit })}`,
    )
    .then((r) => ({ runs: r.runs ?? [], total: r.total, nextCursor: r.next_cursor ?? null }));
}

export async function getRun(key: string): Promise<WorkflowRun | undefined> {
  try {
    const r = await api.get<{ ok: true; run: WorkflowRun }>(`${BASE}/runs/${seg(key)}`);
    return r.run;
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** Every artefact of a run in step order, each with its documents. */
export async function getRunArtifacts(
  key: string,
): Promise<{ run: string; workspace: string; artifacts: RunArtifactsResponse['artifacts'] }> {
  const r = await api.get<RunArtifactsResponse>(`${BASE}/runs/${seg(key)}/artifacts`);
  return { run: r.run, workspace: r.workspace, artifacts: r.artifacts ?? [] };
}

// ---- activity, artefacts, spend, status ----

export function getEvents(q: {
  workflow_run?: string;
  task?: string;
  agent?: string;
  type?: string;
  limit?: number;
  cursor?: string | null;
}): Promise<{ events: StreamEvent[]; nextCursor: string | null }> {
  return api
    .get<{ ok: true; events: StreamEvent[]; next_cursor?: string | null }>(`${BASE}/events${qs(q)}`)
    .then((r) => ({ events: r.events ?? [], nextCursor: r.next_cursor ?? null }));
}

export function getArtifacts(q: { kind?: string; task?: string } = {}): Promise<Artifact[]> {
  return api
    .get<{ ok: true; artifacts: Artifact[] }>(`${BASE}/artifacts${qs(q)}`)
    .then((r) => r.artifacts ?? []);
}

export function getSpend(): Promise<SpendResponse> {
  return api.get<SpendResponse>(`${BASE}/spend`);
}

export function getStatus(): Promise<StatusResponse> {
  return api.get<StatusResponse>(`${BASE}/status`);
}
