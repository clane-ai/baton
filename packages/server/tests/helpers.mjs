import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.BATON_DB_URL, max: 10 });
export const q = (text, params = []) => pool.query(text, params);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function reset() {
  await q(`truncate baton.events, baton.claims, baton.artifacts, baton.messages, baton.runs,
           baton.decisions, baton.tasks, baton.agents, baton.roles cascade`);
}

export async function role(name) {
  await q(
    `insert into baton.roles (name, description, definition_path)
     values ($1, $1, '.claude/agents/' || $1 || '.md') on conflict (name) do nothing`,
    [name],
  );
  return name;
}

export async function agent(name, roleName) {
  const { rows } = await q(
    `insert into baton.agents (name, role, machine, token_hash)
     values ($1, $2, 'test-machine', encode(sha256(convert_to($1, 'UTF8')), 'hex'))
     returning id`,
    [name, roleName],
  );
  return rows[0].id;
}

export async function task(o) {
  const { rows } = await q(
    `insert into baton.tasks
       (title, spec, acceptance, role, state, priority, depends_on, consumes, produces, max_attempts, budget_usd, scope)
     values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::jsonb, $9::jsonb, $10, $11, $12::text[])
     returning *`,
    [
      o.title ?? 'test task',
      o.spec ?? 'Do the thing.',
      o.acceptance ?? 'Given X, when Y, then Z.',
      o.role,
      o.state ?? 'ready',
      o.priority ?? 100,
      o.depends_on ?? [],
      JSON.stringify(o.consumes ?? []),
      JSON.stringify(o.produces ?? []),
      o.max_attempts ?? 3,
      o.budget_usd ?? null,
      o.scope ?? [],
    ],
  );
  return rows[0];
}

export async function claim(agentId, leaseSeconds = 1800) {
  const { rows } = await q(`select (baton.claim_next($1::uuid, $2::int)).id as id`, [agentId, leaseSeconds]);
  return rows[0].id;
}

export async function taskRow(id) {
  const { rows } = await q(`select * from baton.tasks where id = $1`, [id]);
  return rows[0];
}
