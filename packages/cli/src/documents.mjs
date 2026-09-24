// Workspace documents: the files agents read and integrations write (requisitions, invoices, emails). They live
// on the machine that runs the workflow; screens run elsewhere, so the engine keeps a copy in object storage
// under docs/<workspace>/<path>. This module uploads the files a run's artefacts refer to.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Api, must } from './api.mjs';

const TYPES = { '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.eml': 'message/rfc822', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
export const contentTypeOf = (p) => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';

/** Relative workspace paths an artefact refers to: documents[], any *_path field, and the P2P conventions (mirrors the server). */
export function pathsOf(kind, a) {
  if (!a || typeof a !== 'object') return [];
  const out = new Set();
  const ok = (v) => typeof v === 'string' && /^[^\s:*?"<>|]+\.[a-z0-9]{2,5}$/i.test(v) && !v.startsWith('/') && !v.includes('..');
  for (const d of Array.isArray(a.documents) ? a.documents : []) if (ok(d?.path)) out.add(d.path);
  for (const [k, v] of Object.entries(a)) if (/(_path|^path)$/.test(k) && ok(v)) out.add(v);
  const r = a.requisition, po = a.po_number, inv = a.invoice_number;
  if (kind === 'purchase_order' && r) for (const e of ['pdf', 'txt', 'eml']) out.add(`inbox/requisitions/${r}.${e}`);
  if (kind === 'purchase_order' && po) out.add(`outbox/${po}.eml`);
  if (kind === 'delivery_note' && po) { out.add(`inbox/deliveries/${po}-ack.eml`); out.add(`inbox/deliveries/count-${po}.txt`); }
  if (kind === 'goods_receipt' && po) out.add(`inbox/deliveries/count-${po}.txt`);
  if (kind === 'invoice' && inv) { out.add(`inbox/invoices/${inv}.txt`); out.add(`inbox/invoices/${inv}.eml`); }
  return [...out];
}

/** Upload one file; returns 'uploaded' | 'unchanged' | 'missing'. */
export async function uploadDocument(api, { workspace, cwd, path, known }) {
  const full = join(cwd, path);
  if (!existsSync(full) || !statSync(full).isFile()) return 'missing';
  const bytes = readFileSync(full);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (known?.get(path) === sha) return 'unchanged';
  must(await api.post('/admin/documents', { workspace, path: path.replace(/\\/g, '/'), content_type: contentTypeOf(path), content_base64: bytes.toString('base64') }, { timeoutMs: 60000 }), `upload ${path}`);
  return 'uploaded';
}

/** Sync the files referred to by the artefacts of a run (or of every task, with all=true). */
export async function syncDocuments(cfg, { run, workspace, cwd, all = false }) {
  const api = new Api(cfg.serverUrl, cfg.operatorToken);
  let ws = workspace;
  if (!ws && run) { const r = must(await api.get(`/admin/workflow-runs/${encodeURIComponent(run)}`), 'run'); ws = r.run?.workspace ?? 'default'; }
  ws = ws ?? 'default';
  const q = run ? `?workflow_run=${encodeURIComponent(run)}&limit=500` : all ? '?limit=1000' : null;
  if (!q) throw new Error('give --run <key> or --all');
  const tasks = must(await api.get(`/admin/tasks${q}`), 'tasks').tasks;
  const paths = new Set();
  for (const t of tasks) {
    const d = must(await api.get(`/admin/tasks/${t.id}`), 'task');
    for (const a of [...(d.consumed ?? []), ...(d.artifacts ?? [])]) for (const p of pathsOf(a.kind, a.content)) paths.add(p);
  }
  const existing = must(await api.get(`/admin/documents?workspace=${encodeURIComponent(ws)}`), 'documents').documents;
  const known = new Map(existing.map((d) => [d.path, d.sha256]));
  let uploaded = 0, unchanged = 0; const missing = [];
  for (const p of [...paths].sort()) {
    const r = await uploadDocument(api, { workspace: ws, cwd, path: p, known });
    if (r === 'uploaded') uploaded++; else if (r === 'unchanged') unchanged++; else missing.push(p);
  }
  return { workspace: ws, uploaded, unchanged, missing, paths: paths.size };
}
