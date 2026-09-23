-- Workflow runs and outbound event webhooks (docs/clane-integration.md, decision 2).
-- A run key groups the tasks an orchestrator compiled from one workflow instance; children inherit it.
-- Webhooks let an orchestrator advance its run from Baton's events instead of polling /admin/events.

alter table baton.tasks add column workflow_run text;
create index tasks_workflow_run_idx on baton.tasks (workflow_run) where workflow_run is not null;

create function baton.tasks_inherit_run() returns trigger
language plpgsql as $$
begin
  if new.workflow_run is null and new.parent_task is not null then
    select workflow_run into new.workflow_run from baton.tasks where id = new.parent_task;
  end if;
  return new;
end $$;
create trigger tasks_inherit_run before insert on baton.tasks
  for each row execute function baton.tasks_inherit_run();

create or replace function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd,
    'parent_task', t.parent_task, 'waiting_on', t.waiting_on, 'workflow_run', t.workflow_run,
    'github_issue', t.github_issue, 'version', t.version,
    'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at);
$$;

create or replace function baton.task_create(p_actor text, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if length(btrim(coalesce(f->>'title', ''))) = 0
     or length(btrim(coalesce(f->>'spec', ''))) = 0
     or length(btrim(coalesce(f->>'acceptance', ''))) = 0 then
    return baton.err('PRECONDITION_FAILED', 'title, spec and acceptance are required');
  end if;
  if not exists (select 1 from baton.roles where name = f->>'role') then
    return baton.err('PRECONDITION_FAILED', 'unknown role ' || coalesce(f->>'role', '(none)'));
  end if;

  perform set_config('baton.actor', p_actor, true);
  begin
    insert into baton.tasks (title, spec, acceptance, role, priority, depends_on, consumes, produces,
                             parent_task, scope, budget_usd, max_attempts, created_by, workflow_run)
    values (f->>'title', f->>'spec', f->>'acceptance', f->>'role',
            coalesce((f->>'priority')::int, 100),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(f->'depends_on', '[]'::jsonb)) x), '{}'::uuid[]),
            coalesce(f->'consumes', '[]'::jsonb),
            coalesce(f->'produces', '[]'::jsonb),
            (f->>'parent_task')::uuid,
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'scope', '[]'::jsonb)) x), '{}'::text[]),
            (f->>'budget_usd')::numeric,
            coalesce((f->>'max_attempts')::int, 3),
            p_actor,
            nullif(btrim(coalesce(f->>'workflow_run', '')), ''))
    returning * into t;
  exception when check_violation or foreign_key_violation or invalid_text_representation then
    return baton.err('PRECONDITION_FAILED', sqlerrm);
  end;

  perform baton.promote_ready(t.id);
  select * into t from baton.tasks where id = t.id;
  return jsonb_build_object('ok', true, 'task', baton.task_json(t));
end $$;

-- ---------------------------------------------------------------- webhooks
create table baton.webhooks (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  secret      text not null,
  events      text[],                    -- null = every event type; entries may end with * as a prefix
  active      boolean not null default true,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create table baton.webhook_deliveries (
  id          bigserial primary key,
  webhook_id  uuid not null references baton.webhooks(id) on delete cascade,
  event_id    bigint not null references baton.events(id) on delete cascade,
  attempts    int not null default 0,
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);
create index webhook_deliveries_pending_idx on baton.webhook_deliveries (id) where sent_at is null;
alter table baton.webhooks enable row level security;
alter table baton.webhook_deliveries enable row level security;
create policy service_all on baton.webhooks for all to service_role using (true) with check (true);
create policy service_all on baton.webhook_deliveries for all to service_role using (true) with check (true);

create function baton.webhook_matches(p_events text[], p_type text) returns boolean
language sql immutable as $$
  select p_events is null or exists (
    select 1 from unnest(p_events) e
     where e = p_type or e = '*' or (right(e, 1) = '*' and left(p_type, length(e) - 1) = left(e, length(e) - 1)));
$$;

create function baton.events_enqueue_webhooks() returns trigger
language plpgsql as $$
begin
  insert into baton.webhook_deliveries (webhook_id, event_id)
  select w.id, new.id from baton.webhooks w where w.active and baton.webhook_matches(w.events, new.type);
  return null;
end $$;
create trigger events_enqueue_webhooks after insert on baton.events
  for each row execute function baton.events_enqueue_webhooks();

-- What the edge function sends: the event with its task key, agent name and run key.
create function baton.webhook_pending(p_limit int default 20) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', d.id, 'webhook_id', w.id, 'url', w.url, 'secret', w.secret, 'attempts', d.attempts,
           'event', jsonb_build_object('id', e.id, 'ts', e.ts, 'type', e.type, 'payload', e.payload, 'session_id', e.session_id,
             'task_id', e.task_id, 'task_key', (select key from baton.tasks where id = e.task_id),
             'workflow_run', (select workflow_run from baton.tasks where id = e.task_id),
             'agent_id', e.agent_id, 'agent', (select name from baton.agents where id = e.agent_id)))
           order by d.id), '[]'::jsonb)
    from (select * from baton.webhook_deliveries where sent_at is null and attempts < 5 order by id limit p_limit) d
    join baton.webhooks w on w.id = d.webhook_id
    join baton.events e on e.id = d.event_id;
$$;

create function baton.webhook_delivery_done(p_id bigint, p_ok boolean, p_error text default null) returns void
language sql as $$
  update baton.webhook_deliveries
     set attempts = attempts + 1, sent_at = case when p_ok then now() else null end, error = p_error
   where id = p_id;
$$;
