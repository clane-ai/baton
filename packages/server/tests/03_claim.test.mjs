import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task, claim, taskRow } from './helpers.mjs';

beforeEach(async () => { await reset(); await role('qa'); await role('ui-designer'); });
after(() => pool.end());

test('AT1: eight concurrent claims for one ready task hand it out exactly once', async () => {
  const agents = await Promise.all([...Array(8)].map((_, i) => agent(`qa-${i}`, 'qa')));
  const t = await task({ role: 'qa' });

  const results = await Promise.all(agents.map((a) => claim(a)));
  const winners = results.filter(Boolean);

  assert.equal(winners.length, 1, `expected one winner, got ${JSON.stringify(results)}`);
  assert.equal(winners[0], t.id);
  const row = await taskRow(t.id);
  assert.equal(row.state, 'in_progress');
  assert.equal(row.attempts, 1);
  assert.ok(row.assignee);
  assert.ok(new Date(row.lease_until) > new Date());
  const { rows } = await q(`select count(*)::int as n from baton.claims where task_id = $1`, [t.id]);
  assert.equal(rows[0].n, 1);
  const ag = await q(`select status, current_task from baton.agents where id = $1`, [row.assignee]);
  assert.equal(ag.rows[0].status, 'working');
  assert.equal(ag.rows[0].current_task, t.id);
  const ev = await q(`select count(*)::int as n from baton.events where task_id = $1 and type = 'task_claimed'`, [t.id]);
  assert.equal(ev.rows[0].n, 1);
});

test('claim_next honours priority then age, and only its own role', async () => {
  const a = await agent('qa-1', 'qa');
  await task({ role: 'ui-designer', priority: 999 });
  const low = await task({ role: 'qa', priority: 10 });
  const high = await task({ role: 'qa', priority: 500 });
  assert.equal(await claim(a), high.id);
  assert.equal(await claim(a), low.id);
  assert.equal(await claim(a), null);
});

test('claim_next returns none for an unknown agent', async () => {
  await task({ role: 'qa' });
  assert.equal(await claim('00000000-0000-0000-0000-000000000009'), null);
});

test('AT3: a task whose dependency is not done is never returned', async () => {
  const a = await agent('qa-1', 'qa');
  const dep = await task({ role: 'ui-designer', state: 'in_progress' });
  const t = await task({ role: 'qa', depends_on: [dep.id] });
  assert.equal(await claim(a), null);
  await q(`update baton.tasks set state = 'done', assignee = null, lease_until = null where id = $1`, [dep.id]);
  assert.equal(await claim(a), t.id);
});

test('AT4: a task whose consumed artefact does not exist is never returned', async () => {
  const a = await agent('qa-1', 'qa');
  const producer = await task({ role: 'ui-designer', state: 'done' });
  const t = await task({ role: 'qa', consumes: [{ kind: 'design_spec', from_task: null }] });
  assert.equal(await claim(a), null);

  const { rows } = await q(`select baton.consumes_satisfied($1) as ok`, [t.id]);
  assert.equal(rows[0].ok, false);

  await q(`insert into baton.artifacts (task_id, kind, uri) values ($1, 'design_spec', 'artifacts/x.json')`, [producer.id]);
  assert.equal(await claim(a), t.id);
});

test('AT4b: consumes with from_task requires the artefact on that task', async () => {
  const a = await agent('qa-1', 'qa');
  const p1 = await task({ role: 'ui-designer', state: 'done' });
  const p2 = await task({ role: 'ui-designer', state: 'done' });
  const t = await task({ role: 'qa', consumes: [{ kind: 'design_spec', from_task: p1.id }] });
  await q(`insert into baton.artifacts (task_id, kind, uri) values ($1, 'design_spec', 'artifacts/other.json')`, [p2.id]);
  assert.equal(await claim(a), null);
  await q(`insert into baton.artifacts (task_id, kind, uri) values ($1, 'design_spec', 'artifacts/right.json')`, [p1.id]);
  assert.equal(await claim(a), t.id);
});
