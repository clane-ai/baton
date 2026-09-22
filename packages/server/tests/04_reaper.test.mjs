import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task, claim, taskRow, sleep } from './helpers.mjs';

beforeEach(async () => { await reset(); await role('qa'); await role('ui-designer'); });
after(() => pool.end());

test('AT2: an unheartbeated lease expires; task returns to ready with attempts = 1', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  assert.equal(await claim(a, 1), t.id);
  await sleep(1500);

  await q(`select baton.reap_leases()`);

  const row = await taskRow(t.id);
  assert.equal(row.state, 'ready');
  assert.equal(row.attempts, 1);
  assert.equal(row.assignee, null);
  assert.equal(row.lease_until, null);
  const cl = await q(`select outcome, released_at from baton.claims where task_id = $1`, [t.id]);
  assert.equal(cl.rows[0].outcome, 'expired');
  assert.ok(cl.rows[0].released_at);
  const ag = await q(`select status, current_task from baton.agents where id = $1`, [a]);
  assert.equal(ag.rows[0].status, 'idle');
  assert.equal(ag.rows[0].current_task, null);
  const ev = await q(`select count(*)::int as n from baton.events where task_id = $1 and type = 'lease_expired'`, [t.id]);
  assert.equal(ev.rows[0].n, 1);
});

test('reaper leaves live leases alone', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a, 1800);
  await q(`select baton.reap_leases()`);
  assert.equal((await taskRow(t.id)).state, 'in_progress');
});

test('AT5: after max_attempts the task lands in needs_human and stays there', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', max_attempts: 2 });

  assert.equal(await claim(a, 1), t.id);
  await sleep(1500);
  await q(`select baton.reap_leases()`);
  assert.equal((await taskRow(t.id)).state, 'ready');

  assert.equal(await claim(a, 1), t.id);
  await sleep(1500);
  await q(`select baton.reap_leases()`);
  let row = await taskRow(t.id);
  assert.equal(row.state, 'needs_human');
  assert.equal(row.attempts, 2);

  assert.equal(await claim(a), null);
  await q(`select baton.reap_leases()`);
  await q(`select baton.promote_ready()`);
  row = await taskRow(t.id);
  assert.equal(row.state, 'needs_human');
});

test('promote_ready moves complete drafts with satisfied preconditions to ready', async () => {
  const dep = await task({ role: 'ui-designer', state: 'in_progress' });
  const incomplete = await task({ role: 'qa', state: 'draft', spec: '   ' });
  const waiting = await task({ role: 'qa', state: 'draft', depends_on: [dep.id] });
  const good = await task({ role: 'qa', state: 'draft' });

  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(incomplete.id)).state, 'draft');
  assert.equal((await taskRow(waiting.id)).state, 'draft');
  assert.equal((await taskRow(good.id)).state, 'ready');

  await q(`update baton.tasks set state = 'done', assignee = null, lease_until = null where id = $1`, [dep.id]);
  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(waiting.id)).state, 'ready');
});

test('promote_ready keeps a blocked task blocked while its question is unanswered', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', state: 'blocked' });
  const m = await q(
    `insert into baton.messages (task_id, from_agent, to_role, kind, body) values ($1, $2, 'ui-designer', 'question', 'Which colour?') returning id`,
    [t.id, a],
  );
  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(t.id)).state, 'blocked');
  await q(`update baton.messages set answered_at = now() where id = $1`, [m.rows[0].id]);
  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(t.id)).state, 'ready');
});

test('run cost accumulates onto the task and exceeding budget_usd moves it to needs_human', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa', budget_usd: 1.0 });
  assert.equal(await claim(a), t.id);

  const run = await q(
    `insert into baton.runs (agent_id, session_id, task_id, cost_usd) values ($1, 'sess-1', $2, 0.6) returning id`,
    [a, t.id],
  );
  let row = await taskRow(t.id);
  assert.equal(Number(row.cost_usd), 0.6);
  assert.equal(row.state, 'in_progress');

  await q(`update baton.runs set cost_usd = 1.5 where id = $1`, [run.rows[0].id]);
  row = await taskRow(t.id);
  assert.equal(Number(row.cost_usd), 1.5);
  assert.equal(row.state, 'needs_human');
  assert.equal(row.assignee, null);
  assert.equal(row.lease_until, null);
  const cl = await q(`select outcome, reason from baton.claims where task_id = $1`, [t.id]);
  assert.equal(cl.rows[0].outcome, 'failed');
  assert.equal(cl.rows[0].reason, 'budget exceeded');
  const ev = await q(`select count(*)::int as n from baton.events where task_id = $1 and type = 'budget_exceeded'`, [t.id]);
  assert.equal(ev.rows[0].n, 1);
  assert.equal(await claim(a), null);
});
