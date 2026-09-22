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
