# Baton Phase 1 (The Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Baton Postgres spine in a dedicated `baton` schema: all types and tables, the atomic `claim_next`, `consumes_satisfied`, the reaper and readiness crons, budget and attempt caps, RLS on every table, a seed script, and a test harness that proves acceptance tests 1 to 5 of the PRD.

**Architecture:** Everything lives in the `baton` schema of the shared Supabase project `yemmiowsudakdviqqlnt` (eu-west-1, Postgres 17). Migrations are plain SQL files under `packages/server/supabase/migrations/` and are applied with the Supabase MCP `apply_migration` tool, which records them in `supabase_migrations.schema_migrations`. All mutation logic is in `security definer` SQL functions so later phases (MCP face, hooks) call them rather than touching tables. Acceptance tests are Node `node:test` files using `pg`, connecting as a dedicated, RLS-bound `baton_test` login role over the Supavisor pooler.

**Tech Stack:** Postgres 17, pg_cron 1.6 (already installed), Node 22, pnpm workspaces, `pg` (node-postgres), Supabase MCP tools (`apply_migration`, `execute_sql`).

**Spec:** `C:\git\clane-baton\prd.md`, sections 8 (data model), 9 (core algorithms), 14 (security), 16 (failure modes), 18 Phase 1, 20 (repo layout), 28 (naming decisions).

## Global Constraints

- Org naming is **Clane AI**: GitHub `clane-ai/baton`, npm scope `@clane-ai`, marketplace `clane-ai` (prd.md section 28).
- Supabase: existing project ref `yemmiowsudakdviqqlnt`, region `eu-west-1`. **No new project.** Every Baton object lives in schema `baton`. Never create or alter anything in `public` or any other schema except `cron` job rows named `baton-*`.
- The shared project hosts other apps. Tests truncate `baton.*` only. Until Phase 2 introduces a separate dev target, the `baton` schema is a development target and holds no production data.
- Row Level Security on every table, no exceptions (prd.md section 7 and 14).
- Identity comes from the token, never from input (section 13.5). Functions that take `p_agent` are executable only by `service_role` (and the test role), never by `baton_agent`.
- `done` is set by the service, never by an agent (section 8.3). Nothing in Phase 1 sets `done` except direct SQL in tests.
- Every state change writes an event with its actor (section 13.5). A trigger guarantees this.
- Migrations are ordered files `packages/server/supabase/migrations/<timestamp>_<name>.sql`. Apply with MCP `apply_migration` using `name` = the part after the timestamp and `query` = the file's full contents. Never apply out of order.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit as `Abhishek Jha <abhishek.jha@zeus.ie>` (pass `-c user.name -c user.email` or set them once with `git config`).
- Acceptance tests 1 to 5 (prd.md section 18) must pass before Phase 2 begins.

## File Structure

```
baton/
  package.json                          # private root, pnpm workspace
  pnpm-workspace.yaml                   # packages/*, plugins/*
  .env.example                          # BATON_DB_URL template
  .env                                  # gitignored, real BATON_DB_URL
  packages/server/
    package.json                        # @clane-ai/baton-server, scripts: test
    README.md                           # how to apply migrations and run tests
    supabase/
      migrations/
        20260922000100_baton_schema.sql         # schema, enums, tables, indexes, key + updated_at triggers, service_role grants
        20260922000200_baton_task_guards.sql    # depends_on cycle guard, state-change event trigger
        20260922000300_baton_claim.sql          # consumes_satisfied, claim_next
        20260922000400_baton_reaper_and_caps.sql# reap_leases, promote_ready, run cost -> budget cap
        20260922000500_baton_cron.sql           # pg_cron schedules
        20260922000600_baton_rls.sql            # baton_agent role, current_agent(), policies, grants
      seed/seed.sql                     # two roles, one agent, three tasks, idempotent
      dev/test_role_grants.sql          # dev-only grants + permissive policies for baton_test
    tests/
      helpers.mjs                       # pool, reset(), fixtures
      01_tables.test.mjs
      02_guards.test.mjs
      03_claim.test.mjs                 # acceptance 1, 3, 4
      04_reaper.test.mjs                # acceptance 2, 5, budget cap
      06_rls.test.mjs
      07_seed.test.mjs
```

Responsibilities: each migration is one concern and one task. `helpers.mjs` owns all fixture SQL so test files contain only behaviour. `dev/test_role_grants.sql` is the only place that knows about the `baton_test` role, so production migrations never reference it.

---

### Task 0: Workspace, test harness and database connectivity

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.env.example`, `.env` (gitignored)
- Create: `packages/server/package.json`, `packages/server/README.md`
- Create: `packages/server/tests/00_connect.test.mjs`

**Interfaces:**
- Produces: env var `BATON_DB_URL` (Postgres connection string as `baton_test`), npm script `pnpm --filter @clane-ai/baton-server test`, and the login role `baton_test` in the database.

- [ ] **Step 1: Install pnpm and create the workspace files**

```bash
npm i -g pnpm@10
cd /c/git/clane-baton
```

`package.json`:
```json
{
  "name": "baton",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "test:server": "pnpm --filter @clane-ai/baton-server test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - plugins/*
```

`.env.example`:
```
# Postgres connection for the Phase 1 test harness. Role baton_test is RLS-bound and only sees schema baton.
BATON_DB_URL=postgresql://baton_test.yemmiowsudakdviqqlnt:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

`packages/server/package.json`:
```json
{
  "name": "@clane-ai/baton-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --env-file=../../.env --test --test-concurrency=1"
  },
  "dependencies": {
    "pg": "^8.13.0"
  }
}
```

Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing connectivity test**

`packages/server/tests/00_connect.test.mjs`:
```js
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL (no `.env`, so `BATON_DB_URL` is undefined and the pool cannot connect).

- [ ] **Step 4: Create the test role in the database**

Generate a password locally: `openssl rand -hex 24`. Write `.env` at the repo root with `BATON_DB_URL=postgresql://baton_test.yemmiowsudakdviqqlnt:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`.

Using the Supabase MCP `execute_sql` on project `yemmiowsudakdviqqlnt`:
```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'baton_test') then
    create role baton_test login nobypassrls password '<password>';
  end if;
end $$;
```

The role has no privileges yet. It gets schema privileges from `dev/test_role_grants.sql` in Task 1 onward.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/server && pnpm test`
Expected: PASS. If the pooler rejects the login, retry with host `aws-1-eu-west-1.pooler.supabase.com`. If both fail, stop and report to the user; do not alter any other role.

- [ ] **Step 6: Write the server README**

`packages/server/README.md`:
```markdown
# @clane-ai/baton-server

Supabase side of Baton: migrations, functions, cron, and later the edge functions.

## Target
Shared Supabase project `yemmiowsudakdviqqlnt` (eu-west-1). All objects live in schema `baton`.

## Applying migrations
Migrations are `supabase/migrations/<timestamp>_<name>.sql`, applied in order with the
Supabase MCP `apply_migration` tool (`name` = part after the timestamp, `query` = file contents).
After each migration in a development environment, re-run `supabase/dev/test_role_grants.sql`
with `execute_sql` so the `baton_test` role can see new objects.

## Tests
`pnpm test` runs `tests/*.test.mjs` serially with Node's test runner, reading `BATON_DB_URL`
from the repo-root `.env`. Tests truncate every table in schema `baton`. Never point them at
a database holding real task data.
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml .env.example pnpm-lock.yaml packages/server
git commit -m "Scaffold pnpm workspace and Phase 1 test harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Schema, enums, tables, key and updated_at triggers

**Files:**
- Create: `packages/server/supabase/migrations/20260922000100_baton_schema.sql`
- Create: `packages/server/supabase/dev/test_role_grants.sql`
- Create: `packages/server/tests/helpers.mjs`, `packages/server/tests/01_tables.test.mjs`

**Interfaces:**
- Produces: schema `baton`; enums `baton.agent_status`, `baton.task_state`, `baton.message_kind`, `baton.artifact_kind`; tables `baton.roles`, `baton.agents`, `baton.tasks`, `baton.claims`, `baton.artifacts`, `baton.events`, `baton.messages`, `baton.runs`, `baton.decisions`; sequence `baton.task_key_seq`; trigger functions `baton.set_task_key()`, `baton.touch_updated_at()`.
- Produces for tests: `helpers.mjs` exports `pool`, `q(text, params)`, `reset()`, `role(name)`, `agent(name, role)`, `task(opts)`, `claim(agentId, leaseSeconds)`, `taskRow(id)`, `sleep(ms)`.

- [ ] **Step 1: Write helpers and the failing table test**

`packages/server/tests/helpers.mjs`:
```js
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.BATON_DB_URL, max: 10 });
export const q = (text, params = []) => pool.query(text, params);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function reset() {
  await q(`truncate baton.events, baton.claims, baton.artifacts, baton.messages, baton.runs,
           baton.decisions, baton.tasks, baton.agents, baton.roles restart identity cascade`);
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
       (title, spec, acceptance, role, state, priority, depends_on, consumes, produces, max_attempts, budget_usd)
     values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::jsonb, $9::jsonb, $10, $11)
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
```

`packages/server/tests/01_tables.test.mjs`:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, task } from './helpers.mjs';

before(reset);
after(() => pool.end());

test('all nine tables exist in schema baton', async () => {
  const { rows } = await q(
    `select tablename from pg_tables where schemaname = 'baton' order by tablename`,
  );
  assert.deepEqual(
    rows.map((r) => r.tablename),
    ['agents', 'artifacts', 'claims', 'decisions', 'events', 'messages', 'roles', 'runs', 'tasks'],
  );
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL, `01_tables` errors with `relation "baton.events" does not exist` (from `reset`).

- [ ] **Step 3: Write the migration**

`packages/server/supabase/migrations/20260922000100_baton_schema.sql`:
```sql
-- Baton spine: schema, enums, tables, indexes, key + updated_at triggers.
-- prd.md section 8.

create schema if not exists baton;

create type baton.agent_status  as enum ('idle','working','offline','error');
create type baton.task_state    as enum ('draft','ready','blocked','in_progress','review','done','failed','needs_human','cancelled');
create type baton.message_kind  as enum ('question','answer','broadcast','notice');
create type baton.artifact_kind as enum ('user_story','task_spec','design_spec','api_contract','service_contract',
                                         'pr','build','test_report','review','migration','doc','other');

create table baton.roles (
  name            text primary key,
  description     text not null,
  definition_path text not null,
  default_model   text,
  max_concurrent  int  not null default 1,
  created_at      timestamptz not null default now()
);

create table baton.agents (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  role          text not null references baton.roles(name),
  machine       text not null,
  owner_email   text,
  token_hash    text not null,
  status        baton.agent_status not null default 'offline',
  current_task  uuid,
  last_seen     timestamptz,
  created_at    timestamptz not null default now()
);

create sequence baton.task_key_seq;

create table baton.tasks (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  title         text not null,
  spec          text not null,
  acceptance    text not null,
  role          text not null references baton.roles(name),
  state         baton.task_state not null default 'draft',
  priority      int not null default 100,
  depends_on    uuid[] not null default '{}',
  consumes      jsonb not null default '[]',
  produces      jsonb not null default '[]',
  assignee      uuid references baton.agents(id),
  lease_until   timestamptz,
  attempts      int  not null default 0,
  max_attempts  int  not null default 3,
  budget_usd    numeric(10,2),
  cost_usd      numeric(10,4) not null default 0,
  parent_task   uuid references baton.tasks(id),
  github_issue  int,
  version       int  not null default 0,
  created_by    text not null default 'system',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_queue_idx      on baton.tasks (state, role, priority desc, created_at);
create index tasks_assignee_idx   on baton.tasks (assignee) where state = 'in_progress';
create index tasks_lease_idx      on baton.tasks (lease_until) where state = 'in_progress';

alter table baton.agents
  add constraint agents_current_task_fkey foreign key (current_task) references baton.tasks(id) on delete set null;

create table baton.claims (
  id          bigserial primary key,
  task_id     uuid not null references baton.tasks(id),
  agent_id    uuid not null references baton.agents(id),
  claimed_at  timestamptz not null default now(),
  released_at timestamptz,
  outcome     text,
  reason      text
);
create index claims_task_idx on baton.claims (task_id, claimed_at desc);

create table baton.artifacts (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references baton.tasks(id),
  kind           baton.artifact_kind not null,
  uri            text not null,
  sha256         text,
  schema_version text not null default 'v1',
  meta           jsonb not null default '{}',
  created_by     uuid references baton.agents(id),
  created_at     timestamptz not null default now()
);
create index artifacts_kind_idx on baton.artifacts (kind, created_at desc);
create index artifacts_task_idx on baton.artifacts (task_id);

create table baton.events (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  agent_id   uuid references baton.agents(id),
  task_id    uuid references baton.tasks(id),
  session_id text,
  type       text not null,
  payload    jsonb not null default '{}'
);
create index events_ts_idx    on baton.events (ts desc);
create index events_task_idx  on baton.events (task_id, ts desc);
create index events_agent_idx on baton.events (agent_id, ts desc);
create index events_type_idx  on baton.events (type, ts desc);

create table baton.messages (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references baton.tasks(id),
  from_agent   uuid references baton.agents(id),
  to_agent     uuid references baton.agents(id),
  to_role      text references baton.roles(name),
  kind         baton.message_kind not null,
  body         text not null,
  in_reply_to  uuid references baton.messages(id),
  delivered_at timestamptz,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index messages_to_agent_idx on baton.messages (to_agent, delivered_at) where delivered_at is null;
create index messages_to_role_idx  on baton.messages (to_role,  delivered_at) where delivered_at is null;

create table baton.runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references baton.agents(id),
  session_id  text not null,
  task_id     uuid references baton.tasks(id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  cost_usd    numeric(10,4) not null default 0,
  exit_reason text
);
create index runs_session_idx on baton.runs (session_id);

create table baton.decisions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  task_id    uuid references baton.tasks(id),
  made_by    text not null,
  created_at timestamptz not null default now()
);

-- TSK-0001 style keys, generated when the caller does not supply one.
create function baton.set_task_key() returns trigger
language plpgsql as $$
begin
  if new.key is null then
    new.key := 'TSK-' || lpad(nextval('baton.task_key_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger tasks_set_key before insert on baton.tasks
  for each row execute function baton.set_task_key();

create function baton.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger tasks_touch_updated_at before update on baton.tasks
  for each row execute function baton.touch_updated_at();

-- The service (edge functions, later phases) acts as service_role.
grant usage on schema baton to service_role;
grant all on all tables    in schema baton to service_role;
grant all on all sequences in schema baton to service_role;
grant execute on all functions in schema baton to service_role;
alter default privileges in schema baton grant all on tables    to service_role;
alter default privileges in schema baton grant all on sequences to service_role;
alter default privileges in schema baton grant execute on functions to service_role;
```

Apply with MCP `apply_migration` (`project_id` `yemmiowsudakdviqqlnt`, `name` `baton_schema`, `query` = the file contents).

- [ ] **Step 4: Write and run the dev grants for the test role**

`packages/server/supabase/dev/test_role_grants.sql` (dev only, never a migration; re-run after every migration):
```sql
-- Dev-only: let the RLS-bound baton_test role drive the Phase 1 tests.
grant usage on schema baton to baton_test;
grant all on all tables    in schema baton to baton_test;
grant all on all sequences in schema baton to baton_test;
grant execute on all functions in schema baton to baton_test;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'baton_agent') then
    execute 'grant baton_agent to baton_test';
  end if;
end $$;

-- Permissive policies so baton_test still sees everything once RLS is enabled (Task 6).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'baton' loop
    execute format('drop policy if exists dev_test_all on baton.%I', t);
    execute format('create policy dev_test_all on baton.%I for all to baton_test using (true) with check (true)', t);
  end loop;
end $$;
```

Run it with MCP `execute_sql`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS for `00_connect` and all three tests in `01_tables`.

- [ ] **Step 6: Commit**

```bash
git add packages/server/supabase packages/server/tests
git commit -m "Add baton schema, enums, tables and key trigger (migration 0100)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Dependency cycle guard and the state-change event trigger

**Files:**
- Create: `packages/server/supabase/migrations/20260922000200_baton_task_guards.sql`
- Create: `packages/server/tests/02_guards.test.mjs`

**Interfaces:**
- Consumes: `baton.tasks`, `baton.events` from Task 1.
- Produces: trigger `tasks_check_depends_on` (rejects self-dependency, unknown ids and cycles with SQLSTATE `23514`), trigger `tasks_log_state` writing events of type `task_created` and `task_state_changed` with payload keys `actor`, `from`, `to`, `attempts`. Convention: mutating functions call `set_config('baton.actor', <text>, true)` so the trigger records who acted; default actor is `'system'`.

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/02_guards.test.mjs`:
```js
import { test, before, after, beforeEach } from 'node:test';
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
  await q(`select set_config('baton.actor', 'test-suite', false)`);
  await q(`update baton.tasks set state = 'ready' where id = $1`, [t.id]);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: `02_guards` fails: the self-dependency update succeeds instead of rejecting, and no events exist.

- [ ] **Step 3: Write the migration**

`packages/server/supabase/migrations/20260922000200_baton_task_guards.sql`:
```sql
-- Guards on baton.tasks: no dependency cycles (prd.md section 16), and every
-- state change writes an event with its actor (prd.md section 13.5).

create function baton.check_depends_on() returns trigger
language plpgsql as $$
declare missing int; cyc boolean;
begin
  if coalesce(array_length(new.depends_on, 1), 0) = 0 then
    return new;
  end if;

  if new.id = any(new.depends_on) then
    raise exception 'task % cannot depend on itself', new.id using errcode = 'check_violation';
  end if;

  select count(*) into missing
    from unnest(new.depends_on) d
   where not exists (select 1 from baton.tasks t where t.id = d);
  if missing > 0 then
    raise exception 'depends_on references % unknown task(s)', missing using errcode = 'foreign_key_violation';
  end if;

  with recursive walk(id, depth) as (
    select d, 1 from unnest(new.depends_on) d
    union all
    select dd, w.depth + 1
      from walk w
      join baton.tasks t on t.id = w.id
      cross join lateral unnest(t.depends_on) dd
     where w.depth < 100
  )
  select exists (select 1 from walk where id = new.id) into cyc;
  if cyc then
    raise exception 'depends_on would create a cycle involving task %', new.id using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger tasks_check_depends_on
  before insert or update of depends_on on baton.tasks
  for each row execute function baton.check_depends_on();

create function baton.current_actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('baton.actor', true), ''), 'system');
$$;

create function baton.log_task_state_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into baton.events (agent_id, task_id, type, payload)
    values (null, new.id, 'task_created',
            jsonb_build_object('actor', coalesce(nullif(current_setting('baton.actor', true), ''), new.created_by),
                               'state', new.state, 'key', new.key, 'role', new.role));
  elsif old.state is distinct from new.state then
    insert into baton.events (agent_id, task_id, type, payload)
    values (coalesce(new.assignee, old.assignee), new.id, 'task_state_changed',
            jsonb_build_object('actor', baton.current_actor(),
                               'from', old.state, 'to', new.state, 'attempts', new.attempts));
  end if;
  return null;
end $$;

create trigger tasks_log_state
  after insert or update on baton.tasks
  for each row execute function baton.log_task_state_change();
```

Apply with MCP `apply_migration` (`name` `baton_task_guards`). Then re-run `supabase/dev/test_role_grants.sql` with `execute_sql`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS, all four tests in `02_guards`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/supabase/migrations/20260922000200_baton_task_guards.sql packages/server/tests/02_guards.test.mjs
git commit -m "Reject dependency cycles and log every task state change (migration 0200)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `consumes_satisfied` and the atomic `claim_next`

**Files:**
- Create: `packages/server/supabase/migrations/20260922000300_baton_claim.sql`
- Create: `packages/server/tests/03_claim.test.mjs`

**Interfaces:**
- Consumes: tables from Task 1, actor convention from Task 2.
- Produces: `baton.consumes_satisfied(p_task uuid) returns boolean` and `baton.claim_next(p_agent uuid, p_lease_seconds int default 1800) returns baton.tasks` (returns a null composite when nothing is claimable). `claim_next` inserts a `claims` row, sets the agent to `working`, and writes a `task_claimed` event. Executable by `service_role` only (plus the dev test role).

- [ ] **Step 1: Write the failing tests (acceptance 1, 3, 4)**

`packages/server/tests/03_claim.test.mjs`:
```js
import { test, before, after, beforeEach } from 'node:test';
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: `03_claim` fails with `function baton.claim_next(uuid, integer) does not exist`.

- [ ] **Step 3: Write the migration**

`packages/server/supabase/migrations/20260922000300_baton_claim.sql`:
```sql
-- Readiness predicate and the atomic claim (prd.md sections 9.1 and 9.2).

create function baton.consumes_satisfied(p_task uuid) returns boolean
language sql stable as $$
  select not exists (
    select 1
      from baton.tasks t, jsonb_array_elements(t.consumes) c
     where t.id = p_task
       and not exists (
         select 1 from baton.artifacts a
          where a.kind = (c->>'kind')::baton.artifact_kind
            and (c->>'from_task' is null or a.task_id = (c->>'from_task')::uuid)
       )
  );
$$;

create function baton.claim_next(p_agent uuid, p_lease_seconds int default 1800)
returns baton.tasks
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r text;
begin
  select role into r from baton.agents where id = p_agent;
  if r is null then
    return null;
  end if;

  perform set_config('baton.actor', 'agent:' || p_agent::text, true);

  update baton.tasks set
    state       = 'in_progress',
    assignee    = p_agent,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    attempts    = attempts + 1,
    version     = version + 1
  where id = (
    select id from baton.tasks
     where role = r
       and state = 'ready'
       and (assignee is null or lease_until < now())
       and not exists (
             select 1 from unnest(depends_on) d
               join baton.tasks dt on dt.id = d
              where dt.state <> 'done')
       and baton.consumes_satisfied(id)
     order by priority desc, created_at
     for update skip locked
     limit 1
  )
  returning * into t;

  if t.id is not null then
    insert into baton.claims (task_id, agent_id) values (t.id, p_agent);
    update baton.agents
       set current_task = t.id, status = 'working', last_seen = now()
     where id = p_agent;
    insert into baton.events (agent_id, task_id, type, payload)
      values (p_agent, t.id, 'task_claimed',
              jsonb_build_object('lease_until', t.lease_until, 'attempts', t.attempts));
  end if;
  return t;
end $$;

-- Identity comes from the token, never from input: only the service may name an agent.
revoke execute on function baton.claim_next(uuid, int) from public;
grant  execute on function baton.claim_next(uuid, int) to service_role;
```

Apply with MCP `apply_migration` (`name` `baton_claim`). Re-run `supabase/dev/test_role_grants.sql` with `execute_sql`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS, all six tests in `03_claim`. AT1 must report exactly one winner.

- [ ] **Step 5: Commit**

```bash
git add packages/server/supabase/migrations/20260922000300_baton_claim.sql packages/server/tests/03_claim.test.mjs
git commit -m "Add consumes_satisfied and atomic claim_next with lease (migration 0300)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Reaper, readiness promoter, and the budget and attempt caps

**Files:**
- Create: `packages/server/supabase/migrations/20260922000400_baton_reaper_and_caps.sql`
- Create: `packages/server/tests/04_reaper.test.mjs`

**Interfaces:**
- Consumes: `claim_next` from Task 3, actor convention from Task 2.
- Produces: `baton.reap_leases() returns int` (expired `in_progress` tasks go to `ready`, or `needs_human` when `attempts >= max_attempts`; closes the open claim with outcome `expired`; frees the agent; writes a `lease_expired` event), `baton.promote_ready() returns int` (moves `draft` and `blocked` tasks to `ready` when spec and acceptance are non-empty, dependencies are `done`, consumes are satisfied, and no unanswered question is open on the task), and trigger `runs_accumulate_cost` on `baton.runs` (adds run cost to the task; when `cost_usd > budget_usd` the task goes to `needs_human`, the claim closes with outcome `failed` reason `budget exceeded`, and a `budget_exceeded` event is written).

- [ ] **Step 1: Write the failing tests (acceptance 2, 5, budget)**

`packages/server/tests/04_reaper.test.mjs`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: `04_reaper` fails with `function baton.reap_leases() does not exist`.

- [ ] **Step 3: Write the migration**

`packages/server/supabase/migrations/20260922000400_baton_reaper_and_caps.sql`:
```sql
-- Reaper (9.3), readiness promoter (9.1), budget stop (9.4), attempt cap (16).

create function baton.reap_leases() returns int
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0;
begin
  perform set_config('baton.actor', 'reaper', true);

  with victims as (
    select id, assignee, attempts, max_attempts
      from baton.tasks
     where state = 'in_progress' and lease_until < now()
       for update skip locked
  ),
  upd as (
    update baton.tasks t set
      state       = case when v.attempts >= v.max_attempts
                         then 'needs_human'::baton.task_state
                         else 'ready'::baton.task_state end,
      assignee    = null,
      lease_until = null,
      version     = t.version + 1
      from victims v
     where t.id = v.id
     returning t.id
  ),
  cl as (
    update baton.claims c
       set released_at = now(), outcome = 'expired', reason = 'lease expired'
      from victims v
     where c.task_id = v.id and c.agent_id = v.assignee and c.released_at is null
     returning c.id
  ),
  ag as (
    update baton.agents a
       set current_task = null, status = 'idle'
      from victims v
     where a.id = v.assignee and a.current_task = v.id
     returning a.id
  ),
  ev as (
    insert into baton.events (agent_id, task_id, type, payload)
    select v.assignee, v.id, 'lease_expired',
           jsonb_build_object('attempts', v.attempts, 'max_attempts', v.max_attempts,
                              'to', case when v.attempts >= v.max_attempts then 'needs_human' else 'ready' end)
      from victims v
    returning id
  )
  select count(*) into n from upd;

  return n;
end $$;

create function baton.promote_ready() returns int
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0;
begin
  perform set_config('baton.actor', 'promoter', true);

  with promoted as (
    update baton.tasks t
       set state = 'ready', version = t.version + 1
     where t.state in ('draft', 'blocked')
       and length(btrim(t.spec)) > 0
       and length(btrim(t.acceptance)) > 0
       and not exists (
             select 1 from unnest(t.depends_on) d
               join baton.tasks dt on dt.id = d
              where dt.state <> 'done')
       and baton.consumes_satisfied(t.id)
       and not exists (
             select 1 from baton.messages m
              where m.task_id = t.id and m.kind = 'question' and m.answered_at is null)
     returning t.id
  )
  select count(*) into n from promoted;

  return n;
end $$;

-- Run cost accumulates onto the task; over budget means needs_human, no lease, agent freed.
create function baton.accumulate_run_cost() returns trigger
language plpgsql as $$
declare delta numeric; t baton.tasks;
begin
  if new.task_id is null then
    return null;
  end if;
  delta := new.cost_usd - coalesce(old.cost_usd, 0);
  if delta = 0 then
    return null;
  end if;

  update baton.tasks set cost_usd = cost_usd + delta where id = new.task_id returning * into t;

  if t.budget_usd is not null and t.cost_usd > t.budget_usd
     and t.state in ('ready', 'in_progress', 'blocked', 'review') then
    perform set_config('baton.actor', 'budget', true);
    update baton.tasks
       set state = 'needs_human', assignee = null, lease_until = null, version = version + 1
     where id = t.id;
    update baton.claims
       set released_at = now(), outcome = 'failed', reason = 'budget exceeded'
     where task_id = t.id and released_at is null;
    update baton.agents
       set current_task = null, status = 'idle'
     where current_task = t.id;
    insert into baton.events (agent_id, task_id, type, payload)
    values (t.assignee, t.id, 'budget_exceeded',
            jsonb_build_object('cost_usd', t.cost_usd, 'budget_usd', t.budget_usd));
  end if;
  return null;
end $$;

create trigger runs_accumulate_cost
  after insert or update of cost_usd on baton.runs
  for each row execute function baton.accumulate_run_cost();

revoke execute on function baton.reap_leases()   from public;
revoke execute on function baton.promote_ready() from public;
grant  execute on function baton.reap_leases(), baton.promote_ready() to service_role;
```

Apply with MCP `apply_migration` (`name` `baton_reaper_and_caps`). Re-run `supabase/dev/test_role_grants.sql` with `execute_sql`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS, all six tests in `04_reaper`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/supabase/migrations/20260922000400_baton_reaper_and_caps.sql packages/server/tests/04_reaper.test.mjs
git commit -m "Add lease reaper, readiness promoter and budget cap (migration 0400)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: pg_cron schedules

**Files:**
- Create: `packages/server/supabase/migrations/20260922000500_baton_cron.sql`

**Interfaces:**
- Consumes: `baton.reap_leases()`, `baton.promote_ready()` from Task 4.
- Produces: cron jobs `baton-reap` and `baton-promote`, both every minute, run as the migration's role (`postgres`).

Verification is done with MCP `execute_sql` because `cron.job` is not readable by `baton_test`.

- [ ] **Step 1: Verify the jobs do not exist yet**

MCP `execute_sql`:
```sql
select jobname, schedule, command, active from cron.job where jobname like 'baton-%' order by jobname;
```
Expected: zero rows.

- [ ] **Step 2: Write the migration**

`packages/server/supabase/migrations/20260922000500_baton_cron.sql`:
```sql
-- Every minute: return expired leases to the queue, and promote tasks whose
-- preconditions have become true (prd.md sections 9.1 and 9.3).
-- cron.schedule with an existing job name replaces that job, so this is idempotent.

select cron.schedule('baton-reap',    '* * * * *', 'select baton.reap_leases()');
select cron.schedule('baton-promote', '* * * * *', 'select baton.promote_ready()');
```

Apply with MCP `apply_migration` (`name` `baton_cron`).

- [ ] **Step 3: Verify the jobs exist and have run**

MCP `execute_sql`:
```sql
select jobname, schedule, command, active from cron.job where jobname like 'baton-%' order by jobname;
```
Expected: two rows, both `active = true`, schedule `* * * * *`.

Wait at least 70 seconds, then:
```sql
select j.jobname, r.status, r.return_message, r.start_time
  from cron.job_run_details r join cron.job j on j.jobid = r.jobid
 where j.jobname like 'baton-%' order by r.start_time desc limit 4;
```
Expected: rows with `status = 'succeeded'` for both jobs. A `failed` status with a permission message means the cron runs as a role without execute on the functions; fix by granting execute on both functions to that role in the migration and re-applying.

- [ ] **Step 4: Run the whole suite to confirm the crons do not disturb the tests**

Run: `cd packages/server && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/supabase/migrations/20260922000500_baton_cron.sql
git commit -m "Schedule reaper and readiness promoter with pg_cron (migration 0500)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Row Level Security on every table

**Files:**
- Create: `packages/server/supabase/migrations/20260922000600_baton_rls.sql`
- Create: `packages/server/tests/06_rls.test.mjs`

**Interfaces:**
- Consumes: all tables.
- Produces: Postgres role `baton_agent` (nologin, nobypassrls, granted to `authenticator` for Phase 2 PostgREST use); `baton.current_agent() returns uuid` reading `baton.agent_id` (session setting) or the `agent_id` JWT claim; `baton.current_agent_role() returns text`; RLS enabled on all nine tables; policies: agents see roles, their own agent row (never `token_hash`), tasks of their role or assigned to them, their own claims, runs and events, artefacts on visible tasks or of kinds their role consumes, messages to or from them or their role, all decisions; `authenticated` humans read everything except `agents.token_hash`; `service_role` has a permissive all-rows policy.

- [ ] **Step 1: Write the failing test**

`packages/server/tests/06_rls.test.mjs`:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, agent, task, claim } from './helpers.mjs';

let qaAgent, uiAgent, qaTask, uiTask, claimedByOther;

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: `06_rls` fails: `rls is enabled on every baton table` lists all nine tables, and `set local role baton_agent` errors with `role "baton_agent" does not exist`.

- [ ] **Step 3: Write the migration**

`packages/server/supabase/migrations/20260922000600_baton_rls.sql`:
```sql
-- Row Level Security on every table (prd.md sections 7 and 14).
-- baton_agent: the database role an authenticated agent request runs as.
-- Identity is read from a session setting (set by the service after resolving
-- the bearer token) or from a JWT claim (PostgREST path in Phase 2).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'baton_agent') then
    create role baton_agent nologin nobypassrls;
  end if;
end $$;

grant baton_agent to authenticator;

create function baton.current_agent() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('baton.agent_id', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'agent_id')::uuid
  );
$$;

create function baton.current_agent_role() returns text
language sql stable security definer set search_path = baton, pg_temp as $$
  select role from baton.agents where id = baton.current_agent();
$$;

-- Privileges. Agents read; all writes go through security definer functions.
grant usage on schema baton to baton_agent, authenticated;

grant select on baton.roles, baton.tasks, baton.claims, baton.artifacts, baton.events,
                baton.messages, baton.runs, baton.decisions to baton_agent, authenticated;
grant select (id, name, role, machine, owner_email, status, current_task, last_seen, created_at)
  on baton.agents to baton_agent, authenticated;
grant insert on baton.events, baton.decisions to baton_agent;
grant usage on all sequences in schema baton to baton_agent;

grant execute on function baton.current_agent(), baton.current_agent_role(),
                          baton.consumes_satisfied(uuid), baton.current_actor()
  to baton_agent, authenticated;

-- Enable RLS everywhere.
alter table baton.roles      enable row level security;
alter table baton.agents     enable row level security;
alter table baton.tasks      enable row level security;
alter table baton.claims     enable row level security;
alter table baton.artifacts  enable row level security;
alter table baton.events     enable row level security;
alter table baton.messages   enable row level security;
alter table baton.runs       enable row level security;
alter table baton.decisions  enable row level security;

-- service_role: the service itself. Permissive on everything.
create policy service_all on baton.roles     for all to service_role using (true) with check (true);
create policy service_all on baton.agents    for all to service_role using (true) with check (true);
create policy service_all on baton.tasks     for all to service_role using (true) with check (true);
create policy service_all on baton.claims    for all to service_role using (true) with check (true);
create policy service_all on baton.artifacts for all to service_role using (true) with check (true);
create policy service_all on baton.events    for all to service_role using (true) with check (true);
create policy service_all on baton.messages  for all to service_role using (true) with check (true);
create policy service_all on baton.runs      for all to service_role using (true) with check (true);
create policy service_all on baton.decisions for all to service_role using (true) with check (true);

-- authenticated: dashboard humans, read everything. Supervisor actions come as RPCs in Phase 6.
create policy human_read on baton.roles     for select to authenticated using (true);
create policy human_read on baton.agents    for select to authenticated using (true);
create policy human_read on baton.tasks     for select to authenticated using (true);
create policy human_read on baton.claims    for select to authenticated using (true);
create policy human_read on baton.artifacts for select to authenticated using (true);
create policy human_read on baton.events    for select to authenticated using (true);
create policy human_read on baton.messages  for select to authenticated using (true);
create policy human_read on baton.runs      for select to authenticated using (true);
create policy human_read on baton.decisions for select to authenticated using (true);

-- baton_agent: its own slice of the world.
create policy agent_read on baton.roles for select to baton_agent using (true);

create policy agent_read on baton.agents for select to baton_agent
  using (id = baton.current_agent());

create policy agent_read on baton.tasks for select to baton_agent
  using (role = baton.current_agent_role() or assignee = baton.current_agent());

create policy agent_read on baton.claims for select to baton_agent
  using (agent_id = baton.current_agent());

create policy agent_read on baton.artifacts for select to baton_agent
  using (
    exists (select 1 from baton.tasks t
             where t.id = artifacts.task_id
               and (t.assignee = baton.current_agent() or t.role = baton.current_agent_role()))
    or exists (select 1 from baton.tasks t, jsonb_array_elements(t.consumes) c
                where t.role = baton.current_agent_role()
                  and (c->>'kind') = artifacts.kind::text)
  );

create policy agent_read on baton.events for select to baton_agent
  using (agent_id = baton.current_agent());
create policy agent_write on baton.events for insert to baton_agent
  with check (agent_id = baton.current_agent());

create policy agent_read on baton.messages for select to baton_agent
  using (to_agent = baton.current_agent()
      or from_agent = baton.current_agent()
      or to_role = baton.current_agent_role());

create policy agent_read on baton.runs for select to baton_agent
  using (agent_id = baton.current_agent());

create policy agent_read  on baton.decisions for select to baton_agent using (true);
create policy agent_write on baton.decisions for insert to baton_agent with check (true);
```

Apply with MCP `apply_migration` (`name` `baton_rls`). Re-run `supabase/dev/test_role_grants.sql` with `execute_sql` (this time it also grants `baton_agent` to `baton_test` and creates the `dev_test_all` policies so `baton_test` keeps full visibility).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS, all eight tests in `06_rls`, and every earlier file still passes (proving the dev policies keep `baton_test` unrestricted).

- [ ] **Step 5: Commit**

```bash
git add packages/server/supabase/migrations/20260922000600_baton_rls.sql packages/server/tests/06_rls.test.mjs
git commit -m "Enable RLS on every baton table with agent, human and service policies (migration 0600)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Seed script and Phase 1 sign-off

**Files:**
- Create: `packages/server/supabase/seed/seed.sql`
- Create: `packages/server/tests/07_seed.test.mjs`
- Modify: `packages/server/README.md` (add a Seed section)

**Interfaces:**
- Produces: idempotent seed creating roles `analyst` and `frontend-dev`, agent `analyst-01` whose bearer token is `baton_dev_analyst_01` (stored as its sha256), and three tasks with fixed ids `11111111-...-000000000001` (analyst, ready), `...0002` (frontend-dev, draft, depends on 0001, consumes `task_spec` from 0001), `...0003` (frontend-dev, draft, consumes `design_spec`).

- [ ] **Step 1: Write the failing seed test**

`packages/server/tests/07_seed.test.mjs`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: `07_seed` fails with `ENOENT` reading `seed.sql`.

- [ ] **Step 3: Write the seed**

`packages/server/supabase/seed/seed.sql`:
```sql
-- Baton demo seed. Idempotent: safe to run repeatedly.
-- Dev agent token for analyst-01 is "baton_dev_analyst_01" (sha256 stored).

insert into baton.roles (name, description, definition_path, default_model) values
  ('analyst',      'Turns a user story into a task_spec.',                   '.claude/agents/analyst.md',      'sonnet'),
  ('frontend-dev', 'Builds UI from a design_spec and api_contract into a PR.', '.claude/agents/frontend-dev.md', 'sonnet')
on conflict (name) do nothing;

insert into baton.agents (id, name, role, machine, token_hash) values
  ('22222222-2222-2222-2222-000000000001', 'analyst-01', 'analyst', 'dev-machine',
   encode(sha256(convert_to('baton_dev_analyst_01', 'UTF8')), 'hex'))
on conflict (name) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, produces, created_by) values
  ('11111111-1111-1111-1111-000000000001',
   'Write the task spec for the login page',
   'Read the user story for the login page and write a complete task_spec covering fields, validation, error states and the API the page needs.',
   'Given the user story, when the analyst finishes, then a task_spec artefact exists that lists every field, validation rule and API call.',
   'analyst', 'ready', 200, '[{"kind":"task_spec"}]', 'seed')
on conflict (id) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, depends_on, consumes, produces, created_by) values
  ('11111111-1111-1111-1111-000000000002',
   'Build the login page',
   'Implement the login page in the Next.js app according to the task_spec.',
   'Given the task_spec, when the page is built, then a PR exists and the build artefact is registered.',
   'frontend-dev', 'draft', 150,
   array['11111111-1111-1111-1111-000000000001']::uuid[],
   '[{"kind":"task_spec","from_task":"11111111-1111-1111-1111-000000000001"}]',
   '[{"kind":"pr"},{"kind":"build"}]', 'seed')
on conflict (id) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, consumes, produces, created_by) values
  ('11111111-1111-1111-1111-000000000003',
   'Build the dashboard shell',
   'Implement the dashboard layout from the design_spec.',
   'Given the design_spec, when the shell is built, then a PR exists and the build artefact is registered.',
   'frontend-dev', 'draft', 100,
   '[{"kind":"design_spec","from_task":null}]',
   '[{"kind":"pr"},{"kind":"build"}]', 'seed')
on conflict (id) do nothing;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: PASS, all three tests in `07_seed`.

- [ ] **Step 5: Apply the seed to the database and add the README section**

MCP `execute_sql` with the contents of `seed.sql` (so the schema holds demo data for Phase 2's real Claude Code session).

Append to `packages/server/README.md`:
```markdown
## Seed
`supabase/seed/seed.sql` is idempotent. Run it with `execute_sql`. It creates roles `analyst` and
`frontend-dev`, agent `analyst-01` (dev token `baton_dev_analyst_01`), and three tasks: one ready
for the analyst and two frontend tasks waiting on its output.
```

- [ ] **Step 6: Run the complete suite one final time and record the result**

Run: `cd packages/server && pnpm test`
Expected: every file passes. Note: `07_seed` resets the schema, so re-run the seed via `execute_sql` after the suite if demo data should remain.

Confirm the migration ledger with MCP `list_migrations`: six entries named `baton_schema`, `baton_task_guards`, `baton_claim`, `baton_reaper_and_caps`, `baton_cron`, `baton_rls`, in that order.

- [ ] **Step 7: Commit and tag**

```bash
git add packages/server
git commit -m "Add idempotent demo seed and complete Phase 1 spine

Acceptance tests 1-5 from prd.md section 18 pass against the baton schema.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git tag phase-1-spine
git push origin main --tags
```

---

## Self-review

**Spec coverage (sections 8, 9, 14, 16, 18 Phase 1):**
- 8.1 types: Task 1. 8.2 all nine tables and every index: Task 1. 8.3 rules: only `ready` claimable (Task 3), readiness predicate (Tasks 3, 4), `done` never set here.
- 9.1 `consumes_satisfied` and the promoter cron: Tasks 3, 4, 5. 9.2 `claim_next`: Task 3. 9.3 reaper: Tasks 4, 5. 9.4 budget stop: Task 4.
- 14 identity from token (no `baton_agent` execute on `claim_next`), RLS on every table, no escalation path (agents cannot update tasks): Task 6. Storage signed URLs and secrets redaction are Phases 4 and 5.
- 16 circular dependency trigger: Task 2. `max_attempts` to `needs_human`: Task 4. Two agents claiming simultaneously: Task 3.
- 18 Phase 1: migrations, `claim_next`, `consumes_satisfied`, reaper cron, RLS, seed (two roles, three tasks): Tasks 1 to 7. Acceptance 1, 3, 4 in Task 3; 2 and 5 in Task 4.
- Gap accepted and noted: exposing schema `baton` through PostgREST and the `authenticated` policies are not exercised by tests here because `baton_test` cannot assume `authenticated`. Phase 2 covers the HTTP path.

**Placeholder scan:** none. Every step carries its code.

**Type consistency:** `claim_next(uuid, int)` signature is identical in Tasks 3, 6 and helpers. `reap_leases()` and `promote_ready()` names match between Tasks 4 and 5. Event types used: `task_created`, `task_state_changed` (Task 2), `task_claimed` (Task 3), `lease_expired`, `budget_exceeded` (Task 4). Claim outcomes: `expired`, `failed`. Session setting names: `baton.actor`, `baton.agent_id`.
