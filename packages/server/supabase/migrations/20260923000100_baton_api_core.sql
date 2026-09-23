-- Phase 2: the SQL behind the MCP tools (prd.md section 10).
-- Every function returns jsonb: {ok:true, ...} or {ok:false, error:{code,message,retryable}}.
-- Functions that act for an agent take p_agent, which the service resolved from the
-- bearer token. baton_agent never gets execute on them (identity from the token, 13.5).

alter table baton.agents add column revoked_at timestamptz;
alter table baton.agents add column inbox_checked_at timestamptz;
alter table baton.tasks  add column scope text[] not null default '{}';
alter table baton.artifacts add column content jsonb;

create table baton.operators (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  email      text,
  token_hash text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table baton.operators enable row level security;
create policy service_all on baton.operators for all to service_role using (true) with check (true);

create table baton.idempotency (
  agent_id   uuid not null references baton.agents(id),
  key        text not null,
  tool       text not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (agent_id, key)
);
alter table baton.idempotency enable row level security;
create policy service_all on baton.idempotency for all to service_role using (true) with check (true);

-- Broadcasts are visible to every agent.
drop policy agent_read on baton.messages;
create policy agent_read on baton.messages for select to baton_agent
  using (kind = 'broadcast'
      or to_agent = baton.current_agent()
      or from_agent = baton.current_agent()
      or to_role = baton.current_agent_role());

-- ---------------------------------------------------------------- helpers

create function baton.err(p_code text, p_message text, p_retryable boolean default false) returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', false,
           'error', jsonb_build_object('code', p_code, 'message', p_message, 'retryable', p_retryable));
$$;

create function baton.lease_error(p_code text) returns jsonb
language sql immutable as $$
  select case p_code
    when 'LEASE_LOST'   then baton.err('LEASE_LOST', 'Your lease on this task is gone. Stop work immediately, change nothing further, and exit.')
    when 'NOT_ASSIGNED' then baton.err('NOT_ASSIGNED', 'This task is not assigned to you.')
    when 'NOT_FOUND'    then baton.err('NOT_FOUND', 'No such task.')
    else baton.err(p_code, p_code)
  end;
$$;

-- null when the agent holds a live lease on the task; otherwise the error code.
create function baton.check_lease(p_agent uuid, p_task uuid) returns text
language plpgsql stable as $$
declare t baton.tasks;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then
    return 'NOT_FOUND';
  end if;
  if t.assignee = p_agent and t.state = 'in_progress' and t.lease_until is not null and t.lease_until >= now() then
    return null;
  end if;
  if exists (select 1 from baton.claims c where c.task_id = p_task and c.agent_id = p_agent) then
    return 'LEASE_LOST';
  end if;
  return 'NOT_ASSIGNED';
end $$;

create function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd,
    'parent_task', t.parent_task, 'github_issue', t.github_issue, 'version', t.version,
    'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at);
$$;

-- Readiness promoter now takes an optional single task (used after create/answer).
-- The cron job text 'select baton.promote_ready()' keeps working through the default.
drop function baton.promote_ready();
create function baton.promote_ready(p_task uuid default null) returns int
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0;
begin
  perform set_config('baton.actor', coalesce(nullif(current_setting('baton.actor', true), ''), 'promoter'), true);

  with promoted as (
    update baton.tasks t
       set state = 'ready', version = t.version + 1
     where t.state in ('draft', 'blocked')
       and (p_task is null or t.id = p_task)
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

-- ---------------------------------------------------------------- lease tools

create function baton.task_heartbeat(p_agent uuid, p_task uuid, p_extend_seconds int default 1800) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; lu timestamptz;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  update baton.tasks set lease_until = now() + make_interval(secs => p_extend_seconds)
   where id = p_task returning lease_until into lu;
  update baton.agents set last_seen = now() where id = p_agent;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'heartbeat', jsonb_build_object('lease_until', lu));
  return jsonb_build_object('ok', true, 'lease_until', lu);
end $$;

create function baton.task_progress(p_agent uuid, p_task uuid, p_note text, p_pct int default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'progress', jsonb_build_object('note', p_note, 'pct', p_pct));
  update baton.agents set last_seen = now() where id = p_agent;
  return jsonb_build_object('ok', true);
end $$;

create function baton.task_release(p_agent uuid, p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; s baton.task_state;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks
     set state = case when attempts >= max_attempts then 'needs_human'::baton.task_state else 'ready'::baton.task_state end,
         assignee = null, lease_until = null, version = version + 1
   where id = p_task returning state into s;
  update baton.claims set released_at = now(), outcome = 'released', reason = p_reason
   where task_id = p_task and agent_id = p_agent and released_at is null;
  update baton.agents set current_task = null, status = 'idle', last_seen = now() where id = p_agent;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'task_released', jsonb_build_object('reason', p_reason, 'to', s));
  return jsonb_build_object('ok', true, 'state', s);
end $$;

create function baton.task_ask(p_agent uuid, p_task uuid, p_question text, p_to_role text default null, p_to_agent uuid default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; m uuid;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  if length(btrim(coalesce(p_question, ''))) = 0 then
    return baton.err('PRECONDITION_FAILED', 'question must not be empty');
  end if;
  if p_to_role is not null and not exists (select 1 from baton.roles where name = p_to_role) then
    return baton.err('PRECONDITION_FAILED', 'unknown role ' || p_to_role);
  end if;
  if p_to_agent is not null and not exists (select 1 from baton.agents where id = p_to_agent) then
    return baton.err('PRECONDITION_FAILED', 'unknown agent');
  end if;

  insert into baton.messages (task_id, from_agent, to_agent, to_role, kind, body)
  values (p_task, p_agent, p_to_agent, p_to_role, 'question', p_question)
  returning id into m;

  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set state = 'blocked', assignee = null, lease_until = null, version = version + 1
   where id = p_task;
  update baton.claims set released_at = now(), outcome = 'released', reason = 'blocked: asked a question'
   where task_id = p_task and agent_id = p_agent and released_at is null;
  update baton.agents set current_task = null, status = 'idle', last_seen = now() where id = p_agent;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'task_asked',
          jsonb_build_object('message_id', m, 'to_role', p_to_role, 'to_agent', p_to_agent, 'question', p_question));
  return jsonb_build_object('ok', true, 'message_id', m, 'state', 'blocked');
end $$;

-- ---------------------------------------------------------------- creating work

create function baton.task_create(p_actor text, p_fields jsonb) returns jsonb
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
                             parent_task, scope, budget_usd, max_attempts, created_by)
    values (f->>'title', f->>'spec', f->>'acceptance', f->>'role',
            coalesce((f->>'priority')::int, 100),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(f->'depends_on', '[]'::jsonb)) x), '{}'::uuid[]),
            coalesce(f->'consumes', '[]'::jsonb),
            coalesce(f->'produces', '[]'::jsonb),
            (f->>'parent_task')::uuid,
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'scope', '[]'::jsonb)) x), '{}'::text[]),
            (f->>'budget_usd')::numeric,
            coalesce((f->>'max_attempts')::int, 3),
            p_actor)
    returning * into t;
  exception when check_violation or foreign_key_violation or invalid_text_representation then
    return baton.err('PRECONDITION_FAILED', sqlerrm);
  end;

  perform baton.promote_ready(t.id);
  select * into t from baton.tasks where id = t.id;
  return jsonb_build_object('ok', true, 'task', baton.task_json(t));
end $$;

create function baton.task_split(p_agent uuid, p_task uuid, p_children jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; parent baton.tasks; c jsonb; r jsonb; out_tasks jsonb := '[]'::jsonb;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) = 0 then
    return baton.err('PRECONDITION_FAILED', 'children must be a non-empty array');
  end if;
  select * into parent from baton.tasks where id = p_task;
  for c in select * from jsonb_array_elements(p_children) loop
    r := baton.task_create('agent:' || p_agent::text,
           c || jsonb_build_object('parent_task', p_task, 'role', coalesce(c->>'role', parent.role)));
    if not (r->>'ok')::boolean then
      raise exception 'task_split: %', r->'error'->>'message' using errcode = 'check_violation';
    end if;
    out_tasks := out_tasks || (r->'task');
  end loop;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'task_split', jsonb_build_object('children', (select jsonb_agg(x->'id') from jsonb_array_elements(out_tasks) x)));
  return jsonb_build_object('ok', true, 'tasks', out_tasks);
exception when check_violation then
  return baton.err('PRECONDITION_FAILED', sqlerrm);
end $$;

-- ---------------------------------------------------------------- messages

create function baton.message_json(m baton.messages) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'body', m.body, 'task_id', m.task_id,
    'task_key', (select key from baton.tasks where id = m.task_id),
    'from_agent', m.from_agent,
    'from_name', coalesce((select name from baton.agents where id = m.from_agent), 'operator'),
    'to_agent', m.to_agent, 'to_role', m.to_role, 'in_reply_to', m.in_reply_to,
    'created_at', m.created_at, 'answered_at', m.answered_at);
$$;

create function baton.inbox(p_agent uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.agents; direct jsonb; casts jsonb;
begin
  select * into a from baton.agents where id = p_agent;
  if a.id is null then return baton.err('NOT_FOUND', 'unknown agent'); end if;

  with picked as (
    update baton.messages m set delivered_at = now()
     where m.delivered_at is null
       and m.kind <> 'broadcast'
       and (m.to_agent = p_agent or (m.to_agent is null and m.to_role = a.role))
     returning m.*
  )
  select coalesce(jsonb_agg(baton.message_json(m.*) order by m.created_at), '[]'::jsonb) into direct
    from picked join baton.messages m on m.id = picked.id;

  select coalesce(jsonb_agg(baton.message_json(m.*) order by m.created_at), '[]'::jsonb) into casts
    from baton.messages m
   where m.kind = 'broadcast'
     and m.from_agent is distinct from p_agent
     and m.created_at > coalesce(a.inbox_checked_at, a.created_at);

  update baton.agents set inbox_checked_at = now(), last_seen = now() where id = p_agent;
  return jsonb_build_object('ok', true, 'messages', direct || casts);
end $$;

create function baton.answer(p_actor text, p_agent uuid, p_message uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare q baton.messages; s baton.task_state; ans uuid;
begin
  select * into q from baton.messages where id = p_message and kind = 'question';
  if q.id is null then return baton.err('NOT_FOUND', 'no such question'); end if;
  if q.answered_at is not null then return baton.err('PRECONDITION_FAILED', 'question already answered'); end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then return baton.err('PRECONDITION_FAILED', 'answer must not be empty'); end if;

  insert into baton.messages (task_id, from_agent, to_agent, kind, body, in_reply_to)
  values (q.task_id, p_agent, q.from_agent, 'answer', p_body, q.id) returning id into ans;
  update baton.messages set answered_at = now() where id = q.id;

  perform set_config('baton.actor', p_actor, true);
  if q.task_id is not null then
    perform baton.promote_ready(q.task_id);
    select state into s from baton.tasks where id = q.task_id;
  end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, q.task_id, 'question_answered', jsonb_build_object('message_id', q.id, 'answer_id', ans, 'by', p_actor));
  return jsonb_build_object('ok', true, 'answer_id', ans, 'task_state', s);
end $$;

create function baton.broadcast(p_agent uuid, p_body text, p_task uuid default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int; m uuid;
begin
  select count(*) into n from baton.messages
   where from_agent = p_agent and kind = 'broadcast' and created_at > now() - interval '1 hour';
  if n >= 10 then
    return baton.err('RATE_LIMITED', 'broadcast limit is 10 per agent per hour', true);
  end if;
  insert into baton.messages (task_id, from_agent, kind, body) values (p_task, p_agent, 'broadcast', p_body) returning id into m;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'broadcast', jsonb_build_object('message_id', m));
  return jsonb_build_object('ok', true, 'message_id', m);
end $$;

-- ---------------------------------------------------------------- misc tools

create function baton.decision_log(p_agent uuid, p_title text, p_body text, p_task uuid default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare d uuid; who text;
begin
  select name into who from baton.agents where id = p_agent;
  insert into baton.decisions (title, body, task_id, made_by) values (p_title, p_body, p_task, coalesce(who, 'operator')) returning id into d;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'decision_logged', jsonb_build_object('decision_id', d, 'title', p_title));
  return jsonb_build_object('ok', true, 'decision_id', d);
end $$;

create function baton.board(p_agent uuid, p_role text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare r text; counts jsonb; own jsonb;
begin
  select coalesce(p_role, role) into r from baton.agents where id = p_agent;
  select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) into counts
    from (select state::text as state, count(*)::int as n from baton.tasks where role = r group by state) s;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'key', key, 'title', title, 'state', state, 'lease_until', lease_until) order by updated_at desc), '[]'::jsonb)
    into own from baton.tasks where assignee = p_agent;
  return jsonb_build_object('ok', true, 'role', r, 'counts', counts, 'own', own);
end $$;

create function baton.work_available(p_role text) returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'role', p_role,
    'ready', (select count(*)::int from baton.tasks t
               where t.role = p_role and t.state = 'ready'
                 and not exists (select 1 from unnest(t.depends_on) d join baton.tasks dt on dt.id = d where dt.state <> 'done')
                 and baton.consumes_satisfied(t.id)),
    'max_concurrent', (select max_concurrent from baton.roles where name = p_role),
    'working', (select count(*)::int from baton.agents where role = p_role and status = 'working'));
$$;

-- ---------------------------------------------------------------- grants

revoke execute on function
  baton.task_heartbeat(uuid, uuid, int), baton.task_progress(uuid, uuid, text, int),
  baton.task_release(uuid, uuid, text), baton.task_ask(uuid, uuid, text, text, uuid),
  baton.task_create(text, jsonb), baton.task_split(uuid, uuid, jsonb),
  baton.inbox(uuid), baton.answer(text, uuid, uuid, text), baton.broadcast(uuid, text, uuid),
  baton.decision_log(uuid, text, text, uuid), baton.board(uuid, text), baton.work_available(text),
  baton.promote_ready(uuid)
from public;
grant execute on function
  baton.task_heartbeat(uuid, uuid, int), baton.task_progress(uuid, uuid, text, int),
  baton.task_release(uuid, uuid, text), baton.task_ask(uuid, uuid, text, text, uuid),
  baton.task_create(text, jsonb), baton.task_split(uuid, uuid, jsonb),
  baton.inbox(uuid), baton.answer(text, uuid, uuid, text), baton.broadcast(uuid, text, uuid),
  baton.decision_log(uuid, text, text, uuid), baton.board(uuid, text), baton.work_available(text),
  baton.promote_ready(uuid)
to service_role;
grant execute on function baton.task_json(baton.tasks), baton.message_json(baton.messages), baton.err(text, text, boolean)
to baton_agent, authenticated, service_role;
