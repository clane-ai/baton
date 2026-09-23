import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task, claim, taskRow, sleep } from './helpers.mjs';

beforeEach(async () => { await reset(); await role('qa'); await role('ui-designer'); });
after(() => pool.end());

const j = async (sql, params) => (await q(sql, params)).rows[0].r;

test('heartbeat extends a live lease and writes an event', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a, 5);
  const r = await j(`select baton.task_heartbeat($1, $2, 600) as r`, [a, t.id]);
  assert.equal(r.ok, true);
  assert.ok(new Date(r.lease_until) > new Date(Date.now() + 500_000));
});

test('AT8: heartbeat on a reaped lease returns LEASE_LOST', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a, 1);
  await sleep(1500);
  await q(`select baton.reap_leases()`);
  const r = await j(`select baton.task_heartbeat($1, $2) as r`, [a, t.id]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'LEASE_LOST');
});

test('heartbeat by a non-assignee returns NOT_ASSIGNED', async () => {
  const a = await agent('qa-1', 'qa');
  const b = await agent('qa-2', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a);
  const r = await j(`select baton.task_heartbeat($1, $2) as r`, [b, t.id]);
  assert.equal(r.error.code, 'NOT_ASSIGNED');
});

test('progress writes an event; release returns the task to ready', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a);
  assert.equal((await j(`select baton.task_progress($1, $2, 'halfway', 50) as r`, [a, t.id])).ok, true);
  const r = await j(`select baton.task_release($1, $2, 'out of time') as r`, [a, t.id]);
  assert.deepEqual(r, { ok: true, state: 'ready' });
  const row = await taskRow(t.id);
  assert.equal(row.assignee, null);
  const cl = await q(`select outcome, reason from baton.claims where task_id = $1`, [t.id]);
  assert.deepEqual(cl.rows[0], { outcome: 'released', reason: 'out of time' });
  const ev = await q(`select type from baton.events where task_id = $1 order by id`, [t.id]);
  assert.ok(ev.rows.some((e) => e.type === 'progress'));
  assert.ok(ev.rows.some((e) => e.type === 'task_released'));
});

test('ask blocks the task; answer unblocks it and the answer lands in the inbox', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a);
  const asked = await j(`select baton.task_ask($1, $2, 'Which browser?', 'ui-designer', null) as r`, [a, t.id]);
  assert.equal(asked.ok, true);
  assert.equal((await taskRow(t.id)).state, 'blocked');

  await q(`select baton.promote_ready()`);
  assert.equal((await taskRow(t.id)).state, 'blocked');

  const ans = await j(`select baton.answer('operator:test', null, $1, 'Chromium') as r`, [asked.message_id]);
  assert.equal(ans.ok, true);
  assert.equal(ans.task_state, 'ready');

  const inbox = await j(`select baton.inbox($1) as r`, [a]);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].kind, 'answer');
  assert.equal(inbox.messages[0].body, 'Chromium');
  assert.equal(inbox.messages[0].in_reply_to, asked.message_id);

  const again = await j(`select baton.inbox($1) as r`, [a]);
  assert.equal(again.messages.length, 0);

  const dup = await j(`select baton.answer('operator:test', null, $1, 'Firefox') as r`, [asked.message_id]);
  assert.equal(dup.error.code, 'PRECONDITION_FAILED');
});

test('role-addressed questions reach an agent of that role through inbox', async () => {
  const a = await agent('qa-1', 'qa');
  const u = await agent('ui-1', 'ui-designer');
  const t = await task({ role: 'qa' });
  await claim(a);
  const asked = await j(`select baton.task_ask($1, $2, 'Spacing?', 'ui-designer', null) as r`, [a, t.id]);
  const inbox = await j(`select baton.inbox($1) as r`, [u]);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].id, asked.message_id);
  assert.equal(inbox.messages[0].from_name, 'qa-1');
});

test('broadcast is rate limited to 10 per hour and reaches other agents once', async () => {
  const a = await agent('qa-1', 'qa');
  const u = await agent('ui-1', 'ui-designer');
  for (let i = 0; i < 10; i++) {
    assert.equal((await j(`select baton.broadcast($1, $2, null) as r`, [a, `hello ${i}`])).ok, true);
  }
  const over = await j(`select baton.broadcast($1, 'one more', null) as r`, [a]);
  assert.equal(over.error.code, 'RATE_LIMITED');
  assert.equal(over.error.retryable, true);
  const inbox = await j(`select baton.inbox($1) as r`, [u]);
  assert.equal(inbox.messages.length, 10);
  assert.equal((await j(`select baton.inbox($1) as r`, [u])).messages.length, 0);
  assert.equal((await j(`select baton.inbox($1) as r`, [a])).messages.length, 0);
});

test('task_create validates, generates a key, and becomes ready when complete', async () => {
  const bad = await j(`select baton.task_create('operator:test', '{"title":"x","role":"qa"}') as r`);
  assert.equal(bad.error.code, 'PRECONDITION_FAILED');
  const badRole = await j(`select baton.task_create('operator:test', '{"title":"x","spec":"y","acceptance":"z","role":"nope"}') as r`);
  assert.equal(badRole.error.code, 'PRECONDITION_FAILED');
  const r = await j(`select baton.task_create('operator:test', $1) as r`, [JSON.stringify({
    title: 'Test it', spec: 'Run the tests', acceptance: 'They pass', role: 'qa', priority: 300,
    produces: [{ kind: 'test_report' }], scope: ['tests/**'],
  })]);
  assert.equal(r.ok, true);
  assert.match(r.task.key, /^TSK-\d+$/);
  assert.equal(r.task.state, 'ready');
  assert.deepEqual(r.task.scope, ['tests/**']);
  const dep = await j(`select baton.task_create('operator:test', $1) as r`, [JSON.stringify({
    title: 'After', spec: 's', acceptance: 'a', role: 'qa', depends_on: [r.task.id],
  })]);
  assert.equal(dep.task.state, 'draft');
});

test('task_split creates children under the parent', async () => {
  const a = await agent('qa-1', 'qa');
  const t = await task({ role: 'qa' });
  await claim(a);
  const r = await j(`select baton.task_split($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { title: 'part 1', spec: 's', acceptance: 'a' },
    { title: 'part 2', spec: 's', acceptance: 'a', role: 'ui-designer' },
  ])]);
  assert.equal(r.ok, true);
  assert.equal(r.tasks.length, 2);
  assert.equal(r.tasks[0].parent_task, t.id);
  assert.equal(r.tasks[0].role, 'qa');
  assert.equal(r.tasks[1].role, 'ui-designer');
});

test('board and work_available report the queue', async () => {
  const a = await agent('qa-1', 'qa');
  await task({ role: 'qa' });
  const t2 = await task({ role: 'qa' });
  await task({ role: 'qa', state: 'draft' });
  await claim(a);
  const b = await j(`select baton.board($1, null) as r`, [a]);
  assert.equal(b.role, 'qa');
  assert.equal(b.counts.in_progress, 1);
  assert.equal(b.counts.ready, 1);
  assert.equal(b.own.length, 1);
  const w = await j(`select baton.work_available('qa') as r`);
  assert.equal(w.ready, 1);
  assert.equal(w.working, 1);
  assert.equal(w.max_concurrent, 1);
  assert.equal((await j(`select baton.work_available('ui-designer') as r`)).ready, 0);
});

test('decision_log records a decision with the agent name', async () => {
  const a = await agent('qa-1', 'qa');
  const r = await j(`select baton.decision_log($1, 'Use vitest', 'Because it is fast', null) as r`, [a]);
  assert.equal(r.ok, true);
  const d = await q(`select made_by from baton.decisions where id = $1`, [r.decision_id]);
  assert.equal(d.rows[0].made_by, 'qa-1');
});
