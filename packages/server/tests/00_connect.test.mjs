import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.BATON_DB_URL, max: 2 });
after(() => pool.end());

test('connects as baton_test', async () => {
  const { rows } = await pool.query('select current_user as u, 1 as one');
  assert.equal(rows[0].u, 'baton_test');
  assert.equal(rows[0].one, 1);
});
