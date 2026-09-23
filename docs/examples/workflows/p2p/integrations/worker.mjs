#!/usr/bin/env node
// Integration worker for the P2P example: a Baton agent that is a script, not an LLM.
//   node worker.mjs --role supplier-erp --cwd <run dir> [--interval 10] [--once]
//   node worker.mjs --role bank         --cwd <run dir>
// It speaks the same protocol as any agent (whoami, task_next, artifact_get, task_submit, task_release) with the
// role's stored agent token, and the server gate decides whether its artefacts are acceptable. Side effects are
// idempotent: documents are derived from the PO number, so a crash between the side effect and task_submit
// re-produces the same files and the same artefacts on the next claim.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = join(here, '..', '..', '..', '..', '..', 'packages', 'cli', 'src');
const { Api } = await import(`file://${join(cliSrc, 'api.mjs').replace(/\\/g, '/')}`);
const { loadConfig } = await import(`file://${join(cliSrc, 'config.mjs').replace(/\\/g, '/')}`);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const role = String(args.role ?? 'supplier-erp');
const cwd = String(args.cwd ?? process.cwd());
const interval = Number(args.interval ?? 10) * 1000;
const cfg = loadConfig();
const token = cfg.agents?.[role]?.token;
if (!token) { console.error(`no agent token stored for role ${role}; run: baton agents add --name p2p-${role} --role ${role} --store`); process.exit(2); }
const api = new Api(cfg.serverUrl, token);
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), `[${role}]`, ...x);
const simDir = join(cwd, '.sim'); mkdirSync(simDir, { recursive: true });
const py = process.env.PYTHON ?? 'python';

function python(cmd, a, b) {
  const fa = join(simDir, `arg-a-${process.pid}.json`), fb = join(simDir, `arg-b-${process.pid}.json`);
  writeFileSync(fa, JSON.stringify(a)); writeFileSync(fb, JSON.stringify(b));
  const r = spawnSync(py, [join(here, '..', 'sim', 'supplier-docs.py'), cmd, cwd, fa, fb], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`supplier-docs.py ${cmd} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

async function input(kind, taskId) {
  const r = await api.tool('artifact_get', { kind, task_id: taskId });
  const a = r.artifacts?.[0] ?? r.artifact ?? (r.ok !== false && r.content ? r : null);
  const content = a?.content ?? r.content;
  if (!content) throw new Error(`no ${kind} artefact available: ${JSON.stringify(r).slice(0, 200)}`);
  return typeof content === 'string' ? JSON.parse(content) : content;
}

function scenarioFor(requisition) {
  const p = join(simDir, 'scenarios.json');
  const list = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  return list.find((s) => s.pr === requisition) ?? {};
}

async function work(task) {
  const consumes = task.consumes ?? [];
  const from = (kind) => consumes.find((c) => c.kind === kind)?.from_task;
  await api.tool('task_progress', { task_id: task.id, note: `${role} integration started`, pct: 5 });
  if (role === 'supplier-erp') {
    const po = await input('purchase_order', from('purchase_order'));
    const sc = scenarioFor(po.requisition);
    const marker = join(simDir, `erp-fail-${po.po_number}`);
    if (sc.erp?.fail_first && !existsSync(marker)) {
      writeFileSync(marker, new Date().toISOString());
      log(`simulated outage: supplier ERP returned 504 for ${po.po_number}; releasing the task for a retry`);
      await api.tool('task_release', { task_id: task.id, reason: 'supplier ERP timeout (HTTP 504); retry later' });
      return 'released';
    }
    const out = python('ship', po, sc);
    log(`PO ${po.po_number} sent to ${po.vendor?.name}; acknowledged; shipped ${out.delivery_note.delivery_note_number}; invoiced ${out.invoice.invoice_number} ${out.invoice.total} ${out.invoice.currency}`);
    await api.tool('task_progress', { task_id: task.id, note: `PO emailed, ack received, ${out.delivery_note.delivery_note_number} and ${out.invoice.invoice_number} filed under inbox/`, pct: 90 });
    const r = await api.tool('task_submit', { task_id: task.id, artifacts: [
      { kind: 'delivery_note', content: out.delivery_note, meta: { source: 'supplier-erp', po: po.po_number } },
      { kind: 'invoice', content: out.invoice, meta: { source: 'supplier-erp', po: po.po_number } } ] });
    log('submit ->', r.ok ? `gate ${r.state}` : `gate rejected: ${r.error?.message}`);
    return r.ok ? 'done' : 'gate_failed';
  }
  if (role === 'bank') {
    const inv = await input('invoice', from('invoice'));
    const match = await input('invoice_match', from('invoice_match'));
    if (match.status !== 'matched') {
      log(`refusing to pay ${inv.invoice_number}: match status is ${match.status}`);
      await api.tool('task_release', { task_id: task.id, reason: `invoice_match status is ${match.status}; payment refused` });
      return 'released';
    }
    const out = python('pay', inv, match);
    log(`payment ${out.payment.payment_ref} scheduled: ${out.payment.amount} ${out.payment.currency} on ${out.payment.scheduled_for}`);
    const r = await api.tool('task_submit', { task_id: task.id, artifacts: [{ kind: 'payment', content: out.payment, meta: { source: 'bank-gateway' } }] });
    log('submit ->', r.ok ? `gate ${r.state}` : `gate rejected: ${r.error?.message}`);
    return r.ok ? 'done' : 'gate_failed';
  }
  throw new Error(`unknown integration role ${role}`);
}

async function tick() {
  const me = await api.tool('whoami');
  let task = me.current_task ?? null;
  if (!task) {
    const r = await api.tool('task_next', { lease_seconds: 600 });
    if (r.none || !r.task) return false;
    task = r.task;
  }
  log(`claimed ${task.key}: ${task.title}`);
  try { const outcome = await work(task); log(`${task.key} ${outcome}`); }
  catch (e) { log(`${task.key} error: ${e.message}`); await api.tool('task_release', { task_id: task.id, reason: `integration error: ${e.message.slice(0, 160)}` }).catch(() => {}); }
  return true;
}

log(`worker up: ${cfg.serverUrl}, cwd ${cwd}, every ${interval / 1000}s`);
for (;;) {
  let did = false;
  try { did = await tick(); } catch (e) { log('tick error', e.message); }
  if (args.once) break;
  if (!did) await new Promise((r) => setTimeout(r, interval));
}
