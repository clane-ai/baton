#!/usr/bin/env node
// A simulated human approver for the P2P example. It plays "Nora, purchasing manager, authority 10,000":
//   - polls the Attention list for approval tasks in runs whose key starts with --prefix (default p2p-)
//   - reads the purchase order the buyer registered, applies the purchasing policy, and approves or rejects
//     with a written reason (baton tasks approve|reject through the operator API)
//   - takes a human amount of time (think time 20-50 s), and for one requisition per batch forgets the task
//     until the approval_overdue event nudges her (so the deadline path is exercised)
//   - answers questions agents address to nobody, with a stock answer that points at the documents
// Every decision is appended to <cwd>/.sim/human-log.jsonl with the reasoning, so the run can be scored.
//   node human.mjs --cwd <run dir> [--prefix p2p-] [--limit 10000] [--think 20-50] [--forget PR-2026-102]
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = join(here, '..', '..', '..', '..', '..', 'packages', 'cli', 'src');
const { Api, must } = await import(`file://${join(cliSrc, 'api.mjs').replace(/\\/g, '/')}`);
const { loadConfig } = await import(`file://${join(cliSrc, 'config.mjs').replace(/\\/g, '/')}`);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const cwd = String(args.cwd ?? process.cwd());
const prefix = String(args.prefix ?? 'p2p-');
const limit = Number(args.limit ?? 10000);
const [thinkMin, thinkMax] = String(args.think ?? '20-50').split('-').map(Number);
const forget = String(args.forget ?? 'PR-2026-102');
const cfg = loadConfig();
if (!cfg.operatorToken) { console.error('needs an operator token in ~/.baton/config.json'); process.exit(2); }
const api = new Api(cfg.serverUrl, cfg.operatorToken);
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), '[nora]', ...x);
mkdirSync(join(cwd, '.sim'), { recursive: true });
const record = (o) => appendFileSync(join(cwd, '.sim', 'human-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = new Map(); // task id -> { firstSeen, forgotten }

function decide(po) {
  const pc = po.policy_check ?? {};
  const reasons = [];
  const sum = (po.lines ?? []).reduce((s, l) => s + (l.line_total ?? l.quantity * l.unit_price), 0);
  if (Math.abs(sum - po.total) > 0.01) reasons.push(`the lines add up to ${sum.toFixed(2)} but the total says ${po.total}`);
  if (pc.vendor_approved === false || po.vendor?.approved === false) reasons.push(`${po.vendor?.name ?? 'the vendor'} is not an approved vendor; onboard the vendor first or pick an approved one`);
  if (po.total > limit) reasons.push(`escalate: ${po.total} ${po.currency} is above my authority of ${limit}; needs ${po.total > 50000 ? 'CFO' : 'director'} sign-off`);
  if (['director', 'cfo'].includes(pc.approver_level) && po.total <= limit) reasons.push(`the buyer marked this ${pc.approver_level} level; check the policy check before I sign`);
  if (!po.lines?.length) reasons.push('no order lines');
  if (reasons.length) return { verdict: 'reject', reason: reasons.join('; ') };
  return { verdict: 'approve', reason: `Within my authority (${po.total} ${po.currency} of ${limit}), approved vendor ${po.vendor?.name}, prices at catalogue, cost centre ${po.cost_center}. ${pc.notes ? 'Buyer note: ' + pc.notes : ''}`.trim() };
}

async function purchaseOrderFor(task) {
  const dep = (task.depends_on ?? [])[0];
  if (!dep) return null;
  const t = must(await api.get(`/admin/tasks/${dep}`), 'task');
  const a = (t.artifacts ?? []).filter((x) => x.kind === 'purchase_order').sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
  if (!a) return null;
  return typeof a.content === 'string' ? JSON.parse(a.content) : a.content;
}

async function handleApprovals() {
  const r = must(await api.get('/admin/tasks?state=needs_human&role=operator'), 'tasks');
  const overdue = new Set((must(await api.get('/admin/events?type=approval_overdue&limit=50'), 'events').events ?? []).map((e) => e.task_id));
  for (const t of r.tasks) {
    if (!(t.workflow_run ?? '').startsWith(prefix)) continue;
    if (!seen.has(t.id)) seen.set(t.id, { firstSeen: Date.now(), forgotten: false, po: null });
    const s = seen.get(t.id);
    if (s.decided) continue;
    if (!s.po) { s.po = await purchaseOrderFor(t); if (!s.po) { log(`${t.key}: no purchase order to read yet`); continue; } }
    if (s.po.requisition === forget && !s.forgotten && !overdue.has(t.id)) { s.forgotten = true; log(`${t.key} (${s.po.requisition}) landed in the inbox... and got buried under other mail. Waiting for a nudge.`); record({ task: t.key, requisition: s.po.requisition, event: 'forgotten' }); }
    if (s.forgotten && !overdue.has(t.id)) continue;
    if (s.forgotten && overdue.has(t.id) && !s.nudged) { s.nudged = true; log(`${t.key}: approval_overdue nudge received, reading it now`); record({ task: t.key, requisition: s.po.requisition, event: 'nudged_by_overdue' }); }
    const think = (thinkMin + Math.random() * (thinkMax - thinkMin)) * 1000;
    log(`${t.key}: reading PO ${s.po.po_number} (${s.po.total} ${s.po.currency}, ${s.po.vendor?.name}); thinking ${Math.round(think / 1000)}s`);
    await sleep(think);
    const d = decide(s.po);
    const res = must(await api.post(`/admin/tasks/${t.id}/approve`, { verdict: d.verdict, reason: d.reason }), d.verdict);
    s.decided = true;
    log(`${t.key}: ${d.verdict.toUpperCase()} - ${d.reason}`);
    record({ task: t.key, requisition: s.po.requisition, po: s.po.po_number, total: s.po.total, currency: s.po.currency, verdict: d.verdict, reason: d.reason,
      waited_seconds: Math.round((Date.now() - s.firstSeen) / 1000), think_seconds: Math.round(think / 1000), forgotten: s.forgotten, result: res });
  }
}

async function handleQuestions() {
  const r = must(await api.get('/admin/messages?unanswered=1'), 'messages');
  for (const m of r.messages ?? []) {
    if (m.to_role || m.to_agent) continue; // addressed to a role or an agent, not to the human
    const body = 'Nora here. Use the documents in inbox/ and masterdata/ as the source of truth; the policy in masterdata/policy.md decides. If something is missing, record it in the artefact notes and make the conservative choice (do not pay, do not approve).';
    const res = must(await api.post('/admin/answer', { message_id: m.id, body }), 'answer');
    log(`answered question ${m.id.slice(0, 8)} on ${m.task_key ?? '?'}: task now ${res.task_state ?? '?'}`);
    record({ event: 'answered', message: m.id, task: m.task_key, question: m.body });
  }
}

log(`Nora is at her desk (limit ${limit}, think ${thinkMin}-${thinkMax}s, forgets ${forget} until nudged)`);
for (;;) {
  try { await handleApprovals(); await handleQuestions(); } catch (e) { log('error', e.message); }
  await sleep(8000);
}
