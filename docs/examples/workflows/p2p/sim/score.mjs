#!/usr/bin/env node
// Scores a batch of P2P runs: did each run reach the end the scenario expects, how many gate attempts each
// LLM step took, what the human decided and how long she waited, and what it cost. Writes <out>/p2p-results.json.
//   node score.mjs --cwd <run dir> [--prefix p2p-] [--out <dir>]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = join(here, '..', '..', '..', '..', '..', 'packages', 'cli', 'src');
const { Api, must } = await import(`file://${join(cliSrc, 'api.mjs').replace(/\\/g, '/')}`);
const { loadConfig } = await import(`file://${join(cliSrc, 'config.mjs').replace(/\\/g, '/')}`);
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const cwd = String(args.cwd ?? process.cwd()); const prefix = String(args.prefix ?? 'p2p-'); const out = String(args.out ?? cwd);
const cfg = loadConfig(); const api = new Api(cfg.serverUrl, cfg.operatorToken);
const scenarios = JSON.parse(readFileSync(join(cwd, '.sim', 'scenarios.json'), 'utf8'));
const humanLog = existsSync(join(cwd, '.sim', 'human-log.jsonl')) ? readFileSync(join(cwd, '.sim', 'human-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const STEP_OF = (title) => title.replace(/^Procure to pay: /, '');
const LLM_ROLES = new Set(['buyer', 'receiving', 'ap-clerk']);

const runs = must(await api.get('/admin/workflow-runs'), 'runs').runs.filter((r) => r.key.startsWith(prefix));
const results = [];
for (const r of runs.sort((a, b) => a.key.localeCompare(b.key))) {
  const run = must(await api.get(`/admin/workflow-runs/${r.key}`), 'run').run;
  const sc = scenarios.find((s) => s.pr === run.input) ?? {};
  const steps = [];
  for (const s of run.steps) {
    const t = must(await api.get(`/admin/tasks/${s.id}`), 'task');
    const ev = must(await api.get(`/admin/events?task=${s.id}&limit=200`), 'events').events;
    const rejected = ev.filter((e) => e.type === 'artifact_rejected').length;
    const gateFailed = ev.filter((e) => e.type === 'gate_failed').length;
    const released = ev.filter((e) => e.type === 'task_released').map((e) => e.payload?.reason).filter(Boolean);
    const claimed = ev.filter((e) => e.type === 'task_claimed').map((e) => e.ts).sort();
    const finished = ev.filter((e) => ['gate_passed', 'branch_not_taken', 'cancelled_upstream', 'task_cancelled'].includes(e.type)).map((e) => e.ts).sort().pop();
    const artefacts = (t.artifacts ?? []).map((a) => ({ kind: a.kind, content: a.content, created_at: a.created_at }));
    steps.push({ key: s.key, step: STEP_OF(s.title), role: s.role, state: s.state, attempts: s.attempts, artifact_rejected: rejected, gate_failed: gateFailed, released,
      first_claim: claimed[0] ?? null, finished_at: finished ?? null, cost_usd: Number(s.cost_usd), cost_credits: Number(s.cost_credits), condition: s.condition ?? null, artefacts });
  }
  const done = (name) => steps.find((x) => x.step.startsWith(name))?.state === 'done';
  const actual = done('Schedule payment') ? 'paid' : done('Dispute') ? 'disputed' : done('Rework') ? 'rejected' : `incomplete (${run.status})`;
  const approvalKey = steps.find((x) => x.role === 'operator')?.key;
  const human = humanLog.filter((h) => h.task === approvalKey);
  const decision = human.find((h) => h.verdict);
  const evRun = steps.flatMap((s) => [s.first_claim, s.finished_at]).filter(Boolean).sort();
  results.push({ run: run.key, requisition: run.input, label: sc.label, expected: sc.expect, actual, success: actual === sc.expect, status: run.status,
    batch: Number(run.key.split('-').pop()) >= 110 ? 'rerun' : 'first',
    started_at: evRun[0] ?? run.created_at, finished_at: run.finished_at ?? evRun[evRun.length - 1] ?? null,
    elapsed_minutes: evRun.length ? +((new Date(evRun[evRun.length - 1]) - new Date(evRun[0])) / 60000).toFixed(1) : null,
    cost_usd: Number(run.cost_usd), cost_credits: Number(run.cost_credits),
    human: decision ? { verdict: decision.verdict, reason: decision.reason, waited_seconds: decision.waited_seconds, think_seconds: decision.think_seconds, forgotten: !!decision.forgotten, nudged: human.some((h) => h.event === 'nudged_by_overdue') } : null,
    steps });
}
const llmSteps = results.flatMap((r) => r.steps.filter((s) => LLM_ROLES.has(s.role) && s.state === 'done'));
// First pass = the gate accepted the first artefact the agent registered (no schema rejection, no gate failure).
// Attempts are not used here: a lease lost to another session also counts as an attempt.
const firstPass = (s) => s.artifact_rejected === 0 && s.gate_failed === 0;
const batchOf = (r) => r.batch;
const batchStats = (name) => { const rs = results.filter((r) => r.batch === name); const st = rs.flatMap((r) => r.steps.filter((s) => LLM_ROLES.has(s.role) && s.state === 'done'));
  return { runs: rs.length, succeeded: rs.filter((r) => r.success).length, llm_steps: st.length, first_pass: st.filter(firstPass).length, first_pass_pct: st.length ? Math.round(100 * st.filter(firstPass).length / st.length) : 0,
    schema_rejections: st.reduce((n, s) => n + s.artifact_rejected, 0), rejections_per_step: st.length ? +(st.reduce((n, s) => n + s.artifact_rejected, 0) / st.length).toFixed(2) : 0,
    attempts_lost_to_overlap: st.filter((s) => s.attempts > 1 && s.artifact_rejected === 0 && s.gate_failed === 0 && !s.released.length).length + st.filter((s) => s.attempts > 1 && (s.artifact_rejected > 0 || s.gate_failed > 0)).length,
    cost_usd: +rs.reduce((n, r) => n + r.cost_usd, 0).toFixed(4), avg_elapsed_minutes: rs.length ? +(rs.reduce((n, r) => n + (r.elapsed_minutes ?? 0), 0) / rs.length).toFixed(1) : 0 }; };
const summary = {
  batches: { first: batchStats('first'), rerun: batchStats('rerun') },
  runs: results.length, succeeded: results.filter((r) => r.success).length, success_pct: results.length ? Math.round(100 * results.filter((r) => r.success).length / results.length) : 0,
  llm_steps_done: llmSteps.length, llm_steps_first_pass: llmSteps.filter(firstPass).length,
  llm_first_pass_pct: llmSteps.length ? Math.round(100 * llmSteps.filter(firstPass).length / llmSteps.length) : 0,
  schema_rejections: llmSteps.reduce((n, s) => n + s.artifact_rejected, 0), gate_failures: llmSteps.reduce((n, s) => n + s.gate_failed, 0),
  integration_releases: results.flatMap((r) => r.steps.filter((s) => !LLM_ROLES.has(s.role) && s.role !== 'operator')).reduce((n, s) => n + s.released.length, 0),
  human_decisions: results.filter((r) => r.human).length, human_correct: results.filter((r) => r.human && ((r.expected === 'rejected') === (r.human.verdict === 'reject'))).length,
  human_avg_wait_seconds: Math.round(results.filter((r) => r.human).reduce((n, r) => n + r.human.waited_seconds, 0) / Math.max(1, results.filter((r) => r.human).length)),
  total_cost_usd: +results.reduce((n, r) => n + r.cost_usd, 0).toFixed(4), total_credits: results.reduce((n, r) => n + r.cost_credits, 0),
  avg_elapsed_minutes: +(results.filter((r) => r.elapsed_minutes != null).reduce((n, r) => n + r.elapsed_minutes, 0) / Math.max(1, results.length)).toFixed(1),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'p2p-results.json'), JSON.stringify({ scored_at: new Date().toISOString(), summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of results) console.log(`${r.run}  ${r.requisition}  expected ${r.expected.padEnd(9)} actual ${r.actual.padEnd(22)} ${r.success ? 'OK ' : 'MISS'}  ${r.elapsed_minutes ?? '?'} min  $${r.cost_usd.toFixed(3)}  human: ${r.human ? r.human.verdict + ' after ' + r.human.waited_seconds + 's' + (r.human.nudged ? ' (nudged)' : '') : '-'}`);
