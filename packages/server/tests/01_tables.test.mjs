import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, task } from './helpers.mjs';

before(reset);
after(() => pool.end());

test('all spine tables exist in schema baton', async () => {
  const { rows } = await q(
    `select tablename from pg_tables where schemaname = 'baton' order by tablename`,
  );
  const names = rows.map((r) => r.tablename);
  for (const t of ['agents', 'artifacts', 'claims', 'decisions', 'events', 'messages', 'roles', 'runs', 'tasks']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('task keys are generated as TSK-nnnn and increase', async () => {
  await role('qa');
  const a = await task({ role: 'qa' });
  const b = await task({ role: 'qa' });
  assert.match(a.key, /^TSK-\d{4,}$/);
  assert.match(b.key, /^TSK-\d{4,}$/);
  assert.ok(Number(b.key.slice(4)) > Number(a.key.slice(4)));
});

test('updated_at moves on update', async () => {
  await role('qa');
  const t = await task({ role: 'qa' });
  await new Promise((r) => setTimeout(r, 20));
  const { rows } = await q(
    `update baton.tasks set priority = 5 where id = $1 returning updated_at > created_at as moved`,
    [t.id],
  );
  assert.equal(rows[0].moved, true);
});
