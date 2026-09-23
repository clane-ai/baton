-- Baton refinements after the first runs (23 September 2026, evening):
--   affinity   a task may be pinned to one machine or one agent (shared queues across machines)
--   credits    runs and tasks account gateway credits beside dollars (Clane workers report credits)
--   deadlines  a task past its deadline before it is done goes to needs_human
--   approvals  an operator role whose tasks are human decisions: approve or reject
--   runs       workflow definitions and runs are first-class, with a status derived from their tasks

-- ---------------------------------------------------------------- columns
alter table baton.tasks add column affinity text;
alter table baton.tasks add column deadline timestamptz;
alter table baton.tasks add column cost_credits numeric(12,2) not null default 0;
alter table baton.runs  add column credits numeric(12,2) not null default 0;
create index tasks_deadline_idx on baton.tasks (deadline) where deadline is not null;

-- ---------------------------------------------------------------- claim with affinity
drop function baton.claim_next(uuid, int);
create function baton.claim_next(p_agent uuid, p_lease_seconds int default 1800)
returns baton.tasks
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r text; a_name text; a_machine text;
begin
  select role, name, machine into r, a_name, a_machine from baton.agents where id = p_agent;
  if r is null then return null; end if;
  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set
    state = 'in_progress', assignee = p_agent, lease_until = now() + make_interval(secs => p_lease_seconds),
    attempts = attempts + 1, version = version + 1
  where id = (
    select id from baton.tasks
     where role = r and state = 'ready'
       and (assignee is null or lease_until < now())
       and (affinity is null or affinity = a_name or affinity = a_machine)
       and not exists (select 1 from unnest(depends_on) d join baton.tasks dt on dt.id = d where dt.state <> 'done')
       and baton.consumes_satisfied(id)
     order by priority desc, created_at
     for update skip locked
     limit 1)
  returning * into t;
  if t.id is not null then
    insert into baton.claims (task_id, agent_id) values (t.id, p_agent);
    update baton.agents set current_task = t.id, status = 'working', last_seen = now() where id = p_agent;
    insert into baton.events (agent_id, task_id, type, payload)
      values (p_agent, t.id, 'task_claimed', jsonb_build_object('lease_until', t.lease_until, 'attempts', t.attempts));
  end if;
  return t;
end $$;
revoke execute on function baton.claim_next(uuid, int) from public;
grant  execute on function baton.claim_next(uuid, int) to service_role;

drop function baton.work_available(text);
create function baton.work_available(p_role text, p_agent uuid default null) returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true, 'role', p_role,
    'ready', (select count(*)::int from baton.tasks t
               where t.role = p_role and t.state = 'ready'
                 and (t.affinity is null or p_agent is null
                      or t.affinity in (select name from baton.agents where id = p_agent)
                      or t.affinity in (select machine from baton.agents where id = p_agent))
                 and not exists (select 1 from unnest(t.depends_on) d join baton.tasks dt on dt.id = d where dt.state <> 'done')
                 and baton.consumes_satisfied(t.id)),
    'questions', (select count(*)::int from baton.messages m
                   where m.kind = 'question' and m.answered_at is null
                     and (m.to_role = p_role or m.to_agent in (select id from baton.agents where role = p_role and revoked_at is null))
                     and (m.delivered_at is null or m.delivered_at < now() - interval '10 minutes')),
    'max_concurrent', (select max_concurrent from baton.roles where name = p_role),
    'working', (select count(*)::int from baton.agents where role = p_role and status = 'working'));
$$;

-- ---------------------------------------------------------------- credits
drop function baton.runs_usage(uuid, text, uuid, bigint, bigint, numeric, text, text);
create function baton.runs_usage(p_agent uuid, p_session text, p_task uuid, p_tokens_in bigint, p_tokens_out bigint,
                                 p_cost numeric, p_model text default null, p_exit_reason text default null,
                                 p_credits numeric default 0) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare r baton.runs;
begin
  insert into baton.runs (agent_id, session_id, task_id, tokens_in, tokens_out, cost_usd, credits, exit_reason, ended_at)
  values (p_agent, p_session, p_task, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost, 0), coalesce(p_credits, 0), p_exit_reason,
          case when p_exit_reason is null then null else now() end)
  on conflict (session_id) do update set
    task_id     = coalesce(baton.runs.task_id, excluded.task_id),
    tokens_in   = greatest(baton.runs.tokens_in, excluded.tokens_in),
    tokens_out  = greatest(baton.runs.tokens_out, excluded.tokens_out),
    cost_usd    = case when excluded.exit_reason is not null then excluded.cost_usd else greatest(baton.runs.cost_usd, excluded.cost_usd) end,
    credits     = case when excluded.exit_reason is not null then excluded.credits else greatest(baton.runs.credits, excluded.credits) end,
    exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason),
    ended_at    = coalesce(excluded.ended_at, baton.runs.ended_at)
  returning * into r;
  return jsonb_build_object('ok', true, 'run_id', r.id, 'cost_usd', r.cost_usd, 'credits', r.credits);
end $$;
revoke execute on function baton.runs_usage(uuid, text, uuid, bigint, bigint, numeric, text, text, numeric) from public;
grant  execute on function baton.runs_usage(uuid, text, uuid, bigint, bigint, numeric, text, text, numeric) to service_role;

create or replace function baton.accumulate_run_cost() returns trigger
language plpgsql as $$
declare delta numeric; dcred numeric; t baton.tasks;
begin
  if new.task_id is null then return null; end if;
  delta := new.cost_usd - coalesce(old.cost_usd, 0);
  dcred := new.credits - coalesce(old.credits, 0);
  if delta = 0 and dcred = 0 then return null; end if;
  update baton.tasks set cost_usd = cost_usd + delta, cost_credits = cost_credits + dcred where id = new.task_id returning * into t;
  if t.budget_usd is not null and t.cost_usd > t.budget_usd and t.state in ('ready', 'in_progress', 'blocked', 'review') then
    perform set_config('baton.actor', 'budget', true);
    update baton.tasks set state = 'needs_human', assignee = null, lease_until = null, version = version + 1 where id = t.id;
    update baton.claims set released_at = now(), outcome = 'failed', reason = 'budget exceeded' where task_id = t.id and released_at is null;
    update baton.agents set current_task = null, status = 'idle' where current_task = t.id;
    insert into baton.events (agent_id, task_id, type, payload)
    values (t.assignee, t.id, 'budget_exceeded', jsonb_build_object('cost_usd', t.cost_usd, 'budget_usd', t.budget_usd));
  end if;
  return null;
end $$;
drop trigger if exists runs_accumulate_cost on baton.runs;
create trigger runs_accumulate_cost after insert or update of cost_usd, credits on baton.runs
  for each row execute function baton.accumulate_run_cost();

create or replace function baton.spend_summary() returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'total_usd', (select coalesce(sum(cost_usd), 0) from baton.runs),
    'total_credits', (select coalesce(sum(credits), 0) from baton.runs),
    'by_task', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'role', t.role, 'state', t.state,
                  'cost_usd', t.cost_usd, 'cost_credits', t.cost_credits, 'budget_usd', t.budget_usd) order by t.cost_usd desc, t.cost_credits desc), '[]'::jsonb)
                from baton.tasks t where t.cost_usd > 0 or t.cost_credits > 0),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'cost_usd', r.c, 'credits', r.cr) order by r.c desc, r.cr desc), '[]'::jsonb)
                from (select a.role, sum(ru.cost_usd) as c, sum(ru.credits) as cr from baton.runs ru join baton.agents a on a.id = ru.agent_id group by a.role) r),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cost_usd', d.c, 'credits', d.cr) order by d.day), '[]'::jsonb)
               from (select date_trunc('day', started_at)::date as day, sum(cost_usd) as c, sum(credits) as cr from baton.runs group by 1) d));
$$;

-- ---------------------------------------------------------------- task json and create
create or replace function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd, 'cost_credits', t.cost_credits,
    'parent_task', t.parent_task, 'waiting_on', t.waiting_on, 'workflow_run', t.workflow_run,
    'affinity', t.affinity, 'deadline', t.deadline,
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
                             parent_task, scope, budget_usd, max_attempts, created_by, workflow_run, affinity, deadline)
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
            nullif(btrim(coalesce(f->>'workflow_run', '')), ''),
            nullif(btrim(coalesce(f->>'affinity', '')), ''),
            (f->>'deadline')::timestamptz)
    returning * into t;
  exception when check_violation or foreign_key_violation or invalid_text_representation or datetime_field_overflow then
    return baton.err('PRECONDITION_FAILED', sqlerrm);
  end;
  perform baton.promote_ready(t.id);
  select * into t from baton.tasks where id = t.id;
  return jsonb_build_object('ok', true, 'task', baton.task_json(t));
end $$;

-- ---------------------------------------------------------------- deadlines
create function baton.enforce_deadlines() returns int
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0;
begin
  perform set_config('baton.actor', 'deadline', true);
  with late as (
    update baton.tasks set state = 'needs_human', version = version + 1
     where deadline is not null and deadline < now() and state in ('draft', 'ready', 'blocked')
     returning id, key, deadline)
  insert into baton.events (task_id, type, payload)
  select id, 'deadline_passed', jsonb_build_object('key', key, 'deadline', deadline) from late;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function baton.enforce_deadlines() from public;
grant  execute on function baton.enforce_deadlines() to service_role;
select cron.schedule('baton-deadlines', '* * * * *', 'select baton.enforce_deadlines()');

-- ---------------------------------------------------------------- approvals: the operator role
insert into baton.roles (name, description, definition_path, max_concurrent)
values ('operator', 'A human decision. Tasks for this role are approvals: an operator approves or rejects them; no agent ever claims them.', '(human)', 0)
on conflict (name) do nothing;

create function baton.operator_tasks_need_human() returns trigger
language plpgsql as $$
begin
  if new.role = 'operator' and new.state = 'ready' then
    new.state := 'needs_human';
    insert into baton.events (task_id, type, payload) values (new.id, 'approval_required', jsonb_build_object('key', new.key, 'title', new.title));
  end if;
  return new;
end $$;
create trigger tasks_operator_gate before insert or update of state on baton.tasks
  for each row execute function baton.operator_tasks_need_human();

create function baton.task_approve(p_actor text, p_task uuid, p_verdict text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; g jsonb;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.role <> 'operator' then return baton.err('PRECONDITION_FAILED', 'only operator (approval) tasks can be approved or rejected; cancel or prioritise other tasks'); end if;
  if t.state in ('done', 'cancelled') then return baton.err('PRECONDITION_FAILED', 'task is already ' || t.state); end if;
  perform set_config('baton.actor', p_actor, true);
  if p_verdict = 'approve' then
    insert into baton.artifacts (task_id, kind, uri, schema_version, meta, content)
    values (t.id, 'review', 'baton://approval/' || t.key, 'v1', jsonb_build_object('by', p_actor),
            jsonb_build_object('verdict', 'approve', 'summary', coalesce(nullif(p_reason, ''), 'Approved by ' || p_actor), 'findings', '[]'::jsonb));
    update baton.tasks set state = 'review', version = version + 1 where id = t.id;
    insert into baton.events (task_id, type, payload) values (t.id, 'approved', jsonb_build_object('by', p_actor, 'reason', p_reason));
    g := baton.run_gate(t.id);
    return jsonb_build_object('ok', true, 'state', (select state from baton.tasks where id = t.id), 'gate', g);
  elsif p_verdict = 'reject' then
    insert into baton.events (task_id, type, payload) values (t.id, 'rejected', jsonb_build_object('by', p_actor, 'reason', p_reason));
    return baton.task_cancel(p_actor, t.id, 'rejected: ' || coalesce(p_reason, ''));
  end if;
  return baton.err('PRECONDITION_FAILED', 'verdict must be approve or reject');
end $$;
revoke execute on function baton.task_approve(text, uuid, text, text) from public;
grant  execute on function baton.task_approve(text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------- workflows and runs
create table baton.workflows (
  key         text primary key,
  name        text not null,
  version     text not null default '',
  manifest    jsonb not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table baton.workflow_runs (
  key           text primary key,
  workflow_key  text references baton.workflows(key),
  workflow_name text,
  input         text,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
alter table baton.workflows enable row level security;
alter table baton.workflow_runs enable row level security;
create policy service_all on baton.workflows for all to service_role using (true) with check (true);
create policy service_all on baton.workflow_runs for all to service_role using (true) with check (true);
grant select on baton.workflows, baton.workflow_runs to authenticated;
create policy authenticated_read on baton.workflows for select to authenticated using (true);
create policy authenticated_read on baton.workflow_runs for select to authenticated using (true);

create function baton.workflow_run_status(p_key text) returns text
language sql stable as $$
  select case
    when count(*) = 0 then 'empty'
    when bool_or(state = 'needs_human') then 'needs_human'
    when bool_or(state = 'failed') then 'failed'
    when bool_and(state = 'done') then 'done'
    when bool_and(state in ('done', 'cancelled')) then 'cancelled'
    when bool_or(state in ('in_progress', 'review')) then 'running'
    when bool_or(state = 'blocked') then 'blocked'
    else 'pending' end
  from baton.tasks where workflow_run = p_key;
$$;

create function baton.workflow_run_json(p_key text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'key', r.key, 'workflow_key', r.workflow_key, 'workflow_name', r.workflow_name, 'input', r.input,
    'created_by', r.created_by, 'created_at', r.created_at, 'finished_at', r.finished_at,
    'status', baton.workflow_run_status(r.key),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select state::text as s, count(*) as n from baton.tasks where workflow_run = r.key group by 1) c),
    'cost_usd', (select coalesce(sum(cost_usd), 0) from baton.tasks where workflow_run = r.key),
    'cost_credits', (select coalesce(sum(cost_credits), 0) from baton.tasks where workflow_run = r.key),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'role', t.role, 'state', t.state,
                'attempts', t.attempts, 'cost_usd', t.cost_usd, 'cost_credits', t.cost_credits, 'depends_on', to_jsonb(t.depends_on),
                'assignee', (select name from baton.agents where id = t.assignee), 'updated_at', t.updated_at,
                'produces', t.produces) order by t.priority desc, t.created_at), '[]'::jsonb)
              from baton.tasks t where t.workflow_run = r.key))
  from baton.workflow_runs r where r.key = p_key;
$$;

create function baton.workflow_runs_json(p_limit int default 100) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(baton.workflow_run_json(r.key) - 'steps' order by r.created_at desc), '[]'::jsonb)
    from (select key, created_at from baton.workflow_runs order by created_at desc limit p_limit) r;
$$;

-- Stamp finished_at when a run reaches a terminal status.
create function baton.workflow_runs_finish() returns trigger
language plpgsql as $$
declare st text;
begin
  if new.workflow_run is null then return null; end if;
  st := baton.workflow_run_status(new.workflow_run);
  if st in ('done', 'failed', 'cancelled') then
    update baton.workflow_runs set finished_at = coalesce(finished_at, now()) where key = new.workflow_run;
    if not exists (select 1 from baton.events where type = 'workflow_run_finished' and payload->>'run' = new.workflow_run) then
      insert into baton.events (task_id, type, payload) values (new.id, 'workflow_run_finished', jsonb_build_object('run', new.workflow_run, 'status', st));
    end if;
  else
    update baton.workflow_runs set finished_at = null where key = new.workflow_run and finished_at is not null;
  end if;
  return null;
end $$;
create trigger tasks_workflow_runs_finish after update of state on baton.tasks
  for each row execute function baton.workflow_runs_finish();
