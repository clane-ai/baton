// Delegation (docs/delegation.md), exercised through the SQL functions. This file does not call
// reset(): it creates its own fixtures on test-machine and cancels them, so it can run against a
// project that has live agents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, role, agent } from './helpers.mjs';

let fe, be, parentId, childId;
const created = [];

before(async () => {
  await role('frontend-dev'); await role('backend-dev');
  const tag = Date.now().toString(36);
  fe = await agent(`deleg-fe-${tag}`, 'frontend-dev');
  be = await agent(`deleg-be-${tag}`, 'backend-dev');
  const { rows } = await q(
    `insert into baton.tasks (title, spec, acceptance, role, state, priority, produces, max_attempts)
     values ('deleg parent', 'Build the greetings screen.', 'Given the screen, when rendered, then greetings show.', 'frontend-dev', 'ready', 2000, '[{"kind":"build"}]', 3)
     returning id`);
  parentId = rows[0].id; created.push(parentId);
});

after(async () => {
  for (const id of created) await q(`select baton.task_cancel('test', $1::uuid, 'delegation test cleanup')`, [id]);
  await q(`update baton.agents set revoked_at = now(), status = 'offline' where id = any($1::uuid[])`, [[fe, be]]);
  await pool.end();
});

test('delegate: child is created ready, parent is blocked and waits on it with the kinds pinned in consumes', async () => {
  const { rows: [{ t }] } = await q(`select baton.task_json(baton.claim_next($1::uuid, 600)) as t`, [fe]);
  assert.equal(t.id, parentId);
  const { rows: [{ r }] } = await q(
    `select baton.task_delegate($1::uuid, $2::uuid, 'backend-dev', 'Create greetings config', 'Write src/greetings.json with en, fr, de keys.',
       'Given the file, when loaded, then the three keys exist.', '["config"]'::jsonb) as r`, [fe, parentId]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, 'blocked');
  childId = r.child.id; created.push(childId);
  const { rows: [child] } = await q(`select state, role, parent_task, priority, produces from baton.tasks where id = $1`, [childId]);
  assert.equal(child.state, 'ready');
  assert.equal(child.role, 'backend-dev');
  assert.equal(child.parent_task, parentId);
  assert.equal(child.priority, 2010);
  const { rows: [parent] } = await q(`select state, waiting_on, assignee, lease_until, consumes from baton.tasks where id = $1`, [parentId]);
  assert.equal(parent.state, 'blocked');
  assert.equal(parent.waiting_on, childId);
  assert.equal(parent.assignee, null);
  assert.deepEqual(parent.consumes, [{ kind: 'config', from_task: childId }]);
  const { rows: [ag] } = await q(`select current_task, status from baton.agents where id = $1`, [fe]);
  assert.equal(ag.current_task, null);
});

test('delegate twice is refused, and the promoter leaves a waiting parent alone', async () => {
  const { rows: [{ r }] } = await q(
    `select baton.task_delegate($1::uuid, $2::uuid, 'backend-dev', 'x', 'y', 'z', '["config"]'::jsonb) as r`, [fe, parentId]);
  assert.equal(r.ok, false);
  assert.match(r.error.code, /LEASE_LOST|NOT_ASSIGNED/);
  await q(`select baton.promote_ready()`);
  const { rows: [parent] } = await q(`select state from baton.tasks where id = $1`, [parentId]);
  assert.equal(parent.state, 'blocked');
});

test('the child registers a valid config artefact before its gate; the parent still waits', async () => {
  const { rows: [{ t }] } = await q(`select baton.task_json(baton.claim_next($1::uuid, 600)) as t`, [be]);
  assert.equal(t.id, childId);
  const { rows: [{ r }] } = await q(
    `select baton.artifact_put($1::uuid, $2::uuid, 'config', 'storage://artifacts/test/config.json', null, 'v1', '{}'::jsonb,
       '{"path":"src/greetings.json","format":"json","keys":[{"name":"en"},{"name":"fr"},{"name":"de"}],"how_to_load":"JSON.parse(readFileSync(path))"}'::jsonb) as r`, [be, childId]);
  assert.equal(r.ok, true, JSON.stringify(r));
  await q(`select baton.promote_ready()`);
  const { rows: [parent] } = await q(`select state, waiting_on from baton.tasks where id = $1`, [parentId]);
  assert.equal(parent.state, 'blocked');
  assert.equal(parent.waiting_on, childId);
});

test('an invalid artefact is rejected by the schema', async () => {
  const { rows: [{ r }] } = await q(
    `select baton.artifact_put($1::uuid, $2::uuid, 'db_schema', 'storage://artifacts/test/db.json', null, 'v1', '{}'::jsonb, '{"tables":[]}'::jsonb) as r`, [be, childId]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INVALID_ARTIFACT');
});

test('when the child passes its gate the parent wakes: ready, notice to its role, delegation_returned event', async () => {
  const { rows: [{ r }] } = await q(`select baton.task_submit($1::uuid, $2::uuid, '[]'::jsonb) as r`, [be, childId]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const { rows: [child] } = await q(`select state from baton.tasks where id = $1`, [childId]);
  assert.equal(child.state, 'done');
  const { rows: [parent] } = await q(`select state, waiting_on from baton.tasks where id = $1`, [parentId]);
  assert.equal(parent.state, 'ready');
  assert.equal(parent.waiting_on, null);
  const { rows: msgs } = await q(`select to_role, kind, body from baton.messages where task_id = $1 and kind = 'notice'`, [parentId]);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].to_role, 'frontend-dev');
  assert.match(msgs[0].body, /is done/);
  const { rows: evs } = await q(`select type from baton.events where task_id = $1 and type in ('task_delegated', 'delegation_returned') order by id`, [parentId]);
  assert.deepEqual(evs.map((e) => e.type), ['task_delegated', 'delegation_returned']);
});

test('the parent is claimable again and its inputs are satisfied; the notice reaches the role at session start', async () => {
  const { rows: [{ ok }] } = await q(`select baton.consumes_satisfied($1::uuid) as ok`, [parentId]);
  assert.equal(ok, true);
  const { rows: [{ ctx }] } = await q(`select baton.context_for($1::uuid) as ctx`, [fe]);
  assert.ok(ctx.messages.some((m) => m.kind === 'notice' && /is done/.test(m.body)), JSON.stringify(ctx));
  const { rows: [{ t }] } = await q(`select baton.task_json(baton.claim_next($1::uuid, 600)) as t`, [fe]);
  assert.equal(t.id, parentId);
  assert.equal(t.state, 'in_progress');
});

test('a cancelled child hands the parent to a human', async () => {
  // Fresh pair: delegate again from the re-claimed parent, then cancel the child.
  const { rows: [{ r }] } = await q(
    `select baton.task_delegate($1::uuid, $2::uuid, 'backend-dev', 'Second handoff', 'Do it.', 'Given, when, then.', '["handoff"]'::jsonb) as r`, [fe, parentId]);
  assert.equal(r.ok, true, JSON.stringify(r));
  created.push(r.child.id);
  await q(`select baton.task_cancel('test', $1::uuid, 'not needed')`, [r.child.id]);
  const { rows: [parent] } = await q(`select state, waiting_on from baton.tasks where id = $1`, [parentId]);
  assert.equal(parent.state, 'needs_human');
  assert.equal(parent.waiting_on, null);
  const { rows: evs } = await q(`select 1 from baton.events where task_id = $1 and type = 'delegation_failed'`, [parentId]);
  assert.equal(evs.length, 1);
});
