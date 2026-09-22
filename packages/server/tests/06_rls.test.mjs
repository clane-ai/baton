import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task } from './helpers.mjs';

let qaAgent, uiAgent, qaTask, uiTask;

before(async () => {
  await reset();
  await role('qa'); await role('ui-designer');
  qaAgent = await agent('qa-1', 'qa');
  uiAgent = await agent('ui-1', 'ui-designer');
  qaTask = await task({ role: 'qa' });
  uiTask = await task({ role: 'ui-designer' });
  await q(`insert into baton.artifacts (task_id, kind, uri) values ($1, 'design_spec', 'a/design.json')`, [uiTask.id]);
  await q(`insert into baton.artifacts (task_id, kind, uri) values ($1, 'api_contract', 'a/api.json')`, [uiTask.id]);
  await task({ role: 'qa', consumes: [{ kind: 'design_spec', from_task: null }] });
  await q(`insert into baton.messages (task_id, from_agent, to_role, kind, body) values ($1, $2, 'qa', 'question', 'for qa role')`, [uiTask.id, uiAgent]);
  await q(`insert into baton.messages (task_id, from_agent, to_agent, kind, body) values ($1, $2, $3, 'notice', 'for ui agent')`, [uiTask.id, qaAgent, uiAgent]);
});
after(() => pool.end());

async function asAgent(agentId, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role baton_agent');
    await c.query(`select set_config('baton.agent_id', $1, true)`, [agentId]);
    return (await c.query(sql, params)).rows;
  } finally {
    await c.query('rollback');
    c.release();
  }
}

test('rls is enabled on every baton table', async () => {
  const { rows } = await q(
    `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'baton' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  assert.deepEqual(rows, []);
});

test('an agent sees only tasks of its role or assigned to it', async () => {
  const rows = await asAgent(qaAgent, `select role from baton.tasks`);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.role === 'qa'));
});

test('an agent sees only its own agent row and cannot read token_hash', async () => {
  const rows = await asAgent(qaAgent, `select id, name from baton.agents`);
  assert.deepEqual(rows.map((r) => r.name), ['qa-1']);
  await assert.rejects(asAgent(qaAgent, `select token_hash from baton.agents`), (e) => e.code === '42501');
});

test('an agent sees artefacts of kinds its role consumes, not others', async () => {
  const rows = await asAgent(qaAgent, `select kind from baton.artifacts`);
  assert.deepEqual(rows.map((r) => r.kind), ['design_spec']);
});

test('an agent sees messages addressed to it or its role, or sent by it', async () => {
  const qa = await asAgent(qaAgent, `select body from baton.messages order by body`);
  assert.deepEqual(qa.map((r) => r.body), ['for qa role', 'for ui agent']);
  const ui = await asAgent(uiAgent, `select body from baton.messages order by body`);
  assert.deepEqual(ui.map((r) => r.body), ['for qa role', 'for ui agent']);
});

test('an agent cannot claim by naming an agent id', async () => {
  await assert.rejects(
    asAgent(qaAgent, `select baton.claim_next($1::uuid, 60)`, [qaAgent]),
    (e) => e.code === '42501',
  );
});

test('an agent cannot update tasks directly', async () => {
  await assert.rejects(
    asAgent(qaAgent, `update baton.tasks set state = 'done' where id = $1`, [qaTask.id]),
    (e) => e.code === '42501',
  );
});

test('current_agent() is null outside an agent context', async () => {
  const { rows } = await q(`select baton.current_agent() as a`);
  assert.equal(rows[0].a, null);
});
