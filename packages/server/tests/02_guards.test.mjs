import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, task } from './helpers.mjs';

before(async () => { await reset(); await role('qa'); });
after(() => pool.end());

test('a task cannot depend on itself', async () => {
  const a = await task({ role: 'qa' });
  await assert.rejects(
    q(`update baton.tasks set depends_on = array[$1::uuid] where id = $1`, [a.id]),
    (e) => e.code === '23514' && /itself/.test(e.message),
  );
});

test('depends_on must reference existing tasks', async () => {
  await assert.rejects(
    task({ role: 'qa', depends_on: ['00000000-0000-0000-0000-000000000001'] }),
    (e) => e.code === '23503',
  );
});

test('a dependency cycle is rejected', async () => {
  const a = await task({ role: 'qa' });
  const b = await task({ role: 'qa', depends_on: [a.id] });
  const c = await task({ role: 'qa', depends_on: [b.id] });
  await assert.rejects(
    q(`update baton.tasks set depends_on = array[$2::uuid] where id = $1`, [a.id, c.id]),
    (e) => e.code === '23514' && /cycle/.test(e.message),
  );
});

test('creation and every state change write an event with an actor', async () => {
  const t = await task({ role: 'qa', state: 'draft' });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('baton.actor', 'test-suite', true)`);
    await c.query(`update baton.tasks set state = 'ready' where id = $1`, [t.id]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const { rows } = await q(
    `select type, payload from baton.events where task_id = $1 order by id`, [t.id],
  );
  assert.equal(rows[0].type, 'task_created');
  assert.equal(rows[0].payload.state, 'draft');
  assert.equal(rows[1].type, 'task_state_changed');
  assert.deepEqual(
    { from: rows[1].payload.from, to: rows[1].payload.to, actor: rows[1].payload.actor },
    { from: 'draft', to: 'ready', actor: 'test-suite' },
  );
});
