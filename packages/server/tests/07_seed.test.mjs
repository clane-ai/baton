import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pool, q, reset } from './helpers.mjs';

const seed = await readFile(new URL('../supabase/seed/seed.sql', import.meta.url), 'utf8');

before(reset);
after(() => pool.end());

test('seed is idempotent and creates two roles, one agent, three tasks', async () => {
  await q(seed);
  await q(seed);
  const counts = await q(`
    select (select count(*) from baton.roles)::int  as roles,
           (select count(*) from baton.agents)::int as agents,
           (select count(*) from baton.tasks)::int  as tasks`);
  assert.deepEqual(counts.rows[0], { roles: 2, agents: 1, tasks: 3 });
});

test('seeded task graph: one ready, two waiting', async () => {
  const { rows } = await q(`select key, role, state, depends_on from baton.tasks order by key`);
  assert.deepEqual(rows.map((r) => r.state), ['ready', 'draft', 'draft']);
  assert.equal(rows[1].depends_on[0], '11111111-1111-1111-1111-000000000001');
});

test('seeded agent token hash matches the documented dev token', async () => {
  const { rows } = await q(
    `select token_hash = encode(sha256(convert_to('baton_dev_analyst_01', 'UTF8')), 'hex') as ok
       from baton.agents where name = 'analyst-01'`,
  );
  assert.equal(rows[0].ok, true);
});
