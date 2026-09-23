import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task, claim, taskRow } from './helpers.mjs';

beforeEach(async () => {
  await reset();
  await role('qa'); await role('ui-designer'); await role('frontend-dev');
  await q(`delete from baton.artifact_schemas where kind = 'test_report' and version = 'test'`);
});
after(() => pool.end());

const j = async (sql, params) => (await q(sql, params)).rows[0].r;

test('artifact_put requires a lease and a known kind', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  const noLease = await j(`select baton.artifact_put($1, $2, 'test_report', 'x') as r`, [a, t.id]);
  assert.equal(noLease.error.code, 'NOT_ASSIGNED');
  await claim(a);
  const badKind = await j(`select baton.artifact_put($1, $2, 'sandwich', 'x') as r`, [a, t.id]);
  assert.equal(badKind.error.code, 'INVALID_ARTIFACT');
  const bad = await j(`select baton.artifact_put($1, $2, 'test_report', 'storage://artifacts/x.json', 'abc', 'v1', '{}', '{"passed":1}') as r`, [a, t.id]);
  assert.equal(bad.error.code, 'INVALID_ARTIFACT', 'the seeded v1 schema requires failed and summary');
  const ok = await j(`select baton.artifact_put($1, $2, 'test_report', 'storage://artifacts/x.json', 'abc', 'v1', '{}', '{"passed":1,"failed":0,"summary":"ok"}') as r`, [a, t.id]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('AT16: submit without the declared artefact fails the gate and returns the task to ready', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', produces: [{ kind: 'test_report' }] });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, '[]') as r`, [a, t.id]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'GATE_FAILED');
  assert.deepEqual(r.error.missing, ['test_report']);
  assert.equal(r.state, 'ready');
  const row = await taskRow(t.id);
  assert.equal(row.state, 'ready');
  assert.equal(row.assignee, null);
  const ev = await q(`select payload from baton.events where task_id = $1 and type = 'gate_failed'`, [t.id]);
  assert.deepEqual(ev.rows[0].payload.missing, ['test_report']);
  const cl = await q(`select outcome from baton.claims where task_id = $1`, [t.id]);
  assert.equal(cl.rows[0].outcome, 'failed');
});

test('submit with the declared artefacts passes the gate and marks the task done', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', produces: [{ kind: 'test_report' }] });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'test_report', uri: 'storage://artifacts/r.json', content: { passed: 3, failed: 0, summary: 'all green' } },
  ])]);
  assert.deepEqual(r, { ok: true, state: 'done' });
  const row = await taskRow(t.id);
  assert.equal(row.state, 'done');
  const cl = await q(`select outcome from baton.claims where task_id = $1`, [t.id]);
  assert.equal(cl.rows[0].outcome, 'completed');
  const ag = await q(`select status, current_task from baton.agents where id = $1`, [a]);
  assert.deepEqual(ag.rows[0], { status: 'idle', current_task: null });
});

test('AT15: a done design_spec unblocks the frontend task that consumes it, with no human action', async () => {
  const ui = await agent('ui-1', 'ui-designer');
  const design = await task({ role: 'ui-designer', produces: [{ kind: 'design_spec' }] });
  const fe = await task({ role: 'frontend-dev', state: 'draft', consumes: [{ kind: 'design_spec', from_task: design.id }], depends_on: [design.id] });
  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(fe.id)).state, 'draft');

  await claim(ui);
  const r = await j(`select baton.task_submit($1, $2, $3) as r`, [ui, design.id, JSON.stringify([
    { kind: 'design_spec', uri: 'storage://artifacts/d.json', content: { screens: [{ name: 'Login', components: [{ name: 'LoginForm' }] }] } },
  ])]);
  assert.equal(r.state, 'done', JSON.stringify(r));
  assert.equal((await taskRow(fe.id)).state, 'ready');
});

test('AT17: an artefact failing its schema is rejected with the validation error in the event log', async () => {
  await q(`insert into baton.artifact_schemas (kind, version, schema) values ('test_report', 'test', $1)`, [JSON.stringify({
    type: 'object', required: ['passed', 'failed'], properties: { passed: { type: 'integer' }, failed: { type: 'integer' } },
  })]);
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', produces: [{ kind: 'test_report' }] });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'test_report', uri: 'storage://artifacts/r.json', schema_version: 'test', content: { passed: 'three' } },
  ])]);
  assert.equal(r.error.code, 'INVALID_ARTIFACT');
  assert.match(r.error.message, /failed/);
  assert.equal((await taskRow(t.id)).state, 'in_progress');
  const ev = await q(`select payload from baton.events where task_id = $1 and type = 'artifact_rejected'`, [t.id]);
  assert.match(ev.rows[0].payload.errors, /passed|failed/);

  const ok = await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'test_report', uri: 'storage://artifacts/r.json', schema_version: 'test', content: { passed: 3, failed: 0 } },
  ])]);
  assert.equal(ok.state, 'done');
});

test('a pr artefact keeps the task in review until CI reports success', async () => {
  const a = await agent('fe-1', 'frontend-dev');
  const t = await task({ role: 'frontend-dev', produces: [{ kind: 'pr' }] });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'pr', uri: 'https://github.com/clane-ai/x/pull/1', meta: { repo: 'clane-ai/x', number: 1, head_sha: 'abc' } },
  ])]);
  assert.deepEqual(r, { ok: true, state: 'review', pending: 'ci' });
  await q(`update baton.artifacts set meta = meta || '{"ci_status":"success"}' where task_id = $1`, [t.id]);
  const g = await j(`select baton.run_gate($1) as r`, [t.id]);
  assert.equal(g.state, 'done');
});

test('AT23: task_submit by an agent that is not the assignee is rejected with NOT_ASSIGNED and logged', async () => {
  const a = await agent('qa-1', 'qa');
  const b = await agent('qa-2', 'qa');
  const t = await task({ role: 'qa', produces: [{ kind: 'test_report' }] });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, $3) as r`, [b, t.id, JSON.stringify([{ kind: 'test_report', uri: 'x', content: { passed: 1, failed: 0, summary: 's' } }])]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_ASSIGNED');
  assert.equal((await taskRow(t.id)).state, 'in_progress');
  assert.equal((await taskRow(t.id)).assignee, a);
  const ev = await q(`select payload from baton.events where task_id = $1 and type = 'tool_rejected' and agent_id = $2`, [t.id, b]);
  assert.equal(ev.rows.length, 1);
  assert.equal(ev.rows[0].payload.code, 'NOT_ASSIGNED');
  const art = await q(`select count(*)::int as n from baton.artifacts where task_id = $1`, [t.id]);
  assert.equal(art.rows[0].n, 0, 'no artefact registered by the impostor');
});

test('gate failure after max_attempts lands in needs_human', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', produces: [{ kind: 'test_report' }], max_attempts: 1 });
  await claim(a);
  const r = await j(`select baton.task_submit($1, $2, '[]') as r`, [a, t.id]);
  assert.equal(r.state, 'needs_human');
});
