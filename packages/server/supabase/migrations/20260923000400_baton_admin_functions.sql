-- Operator actions (prd.md section 15: reprioritise, cancel, answer, force-release),
-- agent and role lifecycle, run accounting, and the read models the dashboard and CLI use.

create unique index runs_session_uidx on baton.runs (session_id);

create function baton.task_cancel(p_actor text, p_task uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.state in ('done', 'cancelled') then return baton.err('PRECONDITION_FAILED', 'task is already ' || t.state); end if;
  perform set_config('baton.actor', p_actor, true);
  update baton.tasks set state = 'cancelled', assignee = null, lease_until = null, version = version + 1 where id = p_task;
  update baton.claims set released_at = now(), outcome = 'released', reason = 'cancelled: ' || coalesce(p_reason, '')
   where task_id = p_task and released_at is null;
  update baton.agents set current_task = null, status = 'idle' where current_task = p_task;
  if t.assignee is not null then
    insert into baton.messages (task_id, to_agent, kind, body)
    values (p_task, t.assignee, 'notice', 'Task ' || t.key || ' was cancelled by ' || p_actor || '. Stop work on it.');
  end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (t.assignee, p_task, 'task_cancelled', jsonb_build_object('reason', p_reason, 'by', p_actor));
  return jsonb_build_object('ok', true, 'state', 'cancelled');
end $$;

create function baton.task_force_release(p_actor text, p_task uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.state not in ('in_progress', 'review') then return baton.err('PRECONDITION_FAILED', 'task holds no lease (state ' || t.state || ')'); end if;
  perform set_config('baton.actor', p_actor, true);
  update baton.tasks set state = 'ready', assignee = null, lease_until = null, version = version + 1 where id = p_task;
  update baton.claims set released_at = coalesce(released_at, now()), outcome = 'released', reason = 'forced by ' || p_actor
   where task_id = p_task and (released_at is null or outcome = 'submitted');
  update baton.agents set current_task = null, status = 'idle' where current_task = p_task;
  if t.assignee is not null then
    insert into baton.messages (task_id, to_agent, kind, body)
    values (p_task, t.assignee, 'notice', 'Your lease on ' || t.key || ' was force-released by ' || p_actor || '. Stop work on it.');
  end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (t.assignee, p_task, 'task_force_released', jsonb_build_object('by', p_actor, 'from', t.state));
  return jsonb_build_object('ok', true, 'state', 'ready');
end $$;

create function baton.task_reprioritise(p_actor text, p_task uuid, p_priority int) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  perform set_config('baton.actor', p_actor, true);
  update baton.tasks set priority = p_priority, version = version + 1 where id = p_task;
  if t.assignee is not null then
    insert into baton.messages (task_id, to_agent, kind, body)
    values (p_task, t.assignee, 'notice', 'Priority of ' || t.key || ' changed from ' || t.priority || ' to ' || p_priority || ' by ' || p_actor || '.');
  end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (t.assignee, p_task, 'task_reprioritised', jsonb_build_object('from', t.priority, 'to', p_priority, 'by', p_actor));
  return jsonb_build_object('ok', true, 'priority', p_priority);
end $$;

create function baton.role_upsert(p_actor text, p_name text, p_description text, p_definition_path text default null,
                                  p_default_model text default null, p_max_concurrent int default 1) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
begin
  if p_name !~ '^[a-z][a-z0-9-]*$' then return baton.err('PRECONDITION_FAILED', 'role name must be lowercase letters, digits and dashes'); end if;
  insert into baton.roles (name, description, definition_path, default_model, max_concurrent)
  values (p_name, p_description, coalesce(p_definition_path, '.claude/agents/' || p_name || '.md'), p_default_model, coalesce(p_max_concurrent, 1))
  on conflict (name) do update set description = excluded.description, definition_path = excluded.definition_path,
    default_model = excluded.default_model, max_concurrent = excluded.max_concurrent;
  insert into baton.events (type, payload) values ('role_upserted', jsonb_build_object('role', p_name, 'by', p_actor));
  return jsonb_build_object('ok', true, 'role', p_name);
end $$;

create function baton.agent_create(p_actor text, p_name text, p_role text, p_machine text, p_owner_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.agents;
begin
  if not exists (select 1 from baton.roles where name = p_role) then return baton.err('PRECONDITION_FAILED', 'unknown role ' || p_role); end if;
  if exists (select 1 from baton.agents where name = p_name) then return baton.err('PRECONDITION_FAILED', 'agent name already exists'); end if;
  insert into baton.agents (name, role, machine, owner_email, token_hash)
  values (p_name, p_role, p_machine, p_owner_email, p_token_hash) returning * into a;
  insert into baton.events (agent_id, type, payload) values (a.id, 'agent_created', jsonb_build_object('name', p_name, 'role', p_role, 'machine', p_machine, 'by', p_actor));
  return jsonb_build_object('ok', true, 'agent', jsonb_build_object('id', a.id, 'name', a.name, 'role', a.role, 'machine', a.machine));
end $$;

create function baton.agent_revoke(p_actor text, p_agent uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.agents;
begin
  select * into a from baton.agents where id = p_agent;
  if a.id is null then return baton.err('NOT_FOUND', 'no such agent'); end if;
  update baton.agents set revoked_at = now(), status = 'offline' where id = p_agent;
  if a.current_task is not null then
    perform baton.task_force_release(p_actor, a.current_task);
  end if;
  insert into baton.events (agent_id, type, payload) values (a.id, 'agent_revoked', jsonb_build_object('by', p_actor));
  return jsonb_build_object('ok', true);
end $$;

-- Cumulative usage for one session, posted by the supervisor daemon (prd.md 9.4, 11).
create function baton.runs_usage(p_agent uuid, p_session text, p_task uuid, p_tokens_in bigint, p_tokens_out bigint,
                                 p_cost numeric, p_model text default null, p_exit_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare r baton.runs;
begin
  insert into baton.runs (agent_id, session_id, task_id, tokens_in, tokens_out, cost_usd, exit_reason, ended_at)
  values (p_agent, p_session, p_task, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost, 0), p_exit_reason,
          case when p_exit_reason is null then null else now() end)
  on conflict (session_id) do update set
    task_id     = coalesce(baton.runs.task_id, excluded.task_id),
    tokens_in   = greatest(baton.runs.tokens_in, excluded.tokens_in),
    tokens_out  = greatest(baton.runs.tokens_out, excluded.tokens_out),
    cost_usd    = greatest(baton.runs.cost_usd, excluded.cost_usd),
    exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason),
    ended_at    = coalesce(excluded.ended_at, baton.runs.ended_at)
  returning * into r;
  return jsonb_build_object('ok', true, 'run_id', r.id, 'cost_usd', r.cost_usd);
end $$;

-- Read models ----------------------------------------------------------------

create function baton.status_summary() returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'agents', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', a.id, 'name', a.name, 'role', a.role, 'machine', a.machine, 'status', a.status,
                 'last_seen', a.last_seen, 'revoked', a.revoked_at is not null,
                 'current_task', (select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'state', t.state, 'lease_until', t.lease_until)
                                    from baton.tasks t where t.id = a.current_task)) order by a.role, a.name), '[]'::jsonb)
               from baton.agents a where a.revoked_at is null),
    'counts', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
               from (select state::text as state, count(*)::int as n from baton.tasks group by state) s),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'key', t.key, 'title', t.title, 'role', t.role, 'state', t.state, 'attempts', t.attempts,
                    'cost_usd', t.cost_usd, 'budget_usd', t.budget_usd, 'updated_at', t.updated_at,
                    'question', (select jsonb_build_object('id', m.id, 'body', m.body, 'from', (select name from baton.agents where id = m.from_agent), 'to_role', m.to_role, 'created_at', m.created_at)
                                   from baton.messages m where m.task_id = t.id and m.kind = 'question' and m.answered_at is null
                                  order by m.created_at limit 1),
                    'last_event', (select jsonb_build_object('type', e.type, 'payload', e.payload, 'ts', e.ts)
                                     from baton.events e where e.task_id = t.id order by e.id desc limit 1))
                    order by (t.state = 'blocked') desc, t.updated_at desc), '[]'::jsonb)
                  from baton.tasks t where t.state in ('needs_human', 'blocked')));
$$;

create function baton.task_detail(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = baton, pg_temp as $$
declare t baton.tasks;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  return jsonb_build_object(
    'ok', true,
    'task', baton.task_json(t),
    'assignee_name', (select name from baton.agents where id = t.assignee),
    'depends_on', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'title', d.title, 'state', d.state)), '[]'::jsonb)
                   from baton.tasks d where d.id = any(t.depends_on)),
    'dependents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'title', d.title, 'state', d.state)), '[]'::jsonb)
                   from baton.tasks d where t.id = any(d.depends_on)),
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'title', d.title, 'state', d.state)), '[]'::jsonb)
                 from baton.tasks d where d.parent_task = t.id),
    'artifacts', (select coalesce(jsonb_agg(baton.artifact_json(a) order by a.created_at desc), '[]'::jsonb) from baton.artifacts a where a.task_id = t.id),
    'consumed', (select coalesce(jsonb_agg(baton.artifact_json(a) order by a.created_at desc), '[]'::jsonb)
                 from baton.artifacts a, jsonb_array_elements(t.consumes) c
                 where a.kind::text = c->>'kind' and (c->>'from_task' is null or a.task_id = (c->>'from_task')::uuid)),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'agent', (select name from baton.agents where id = c.agent_id),
                 'claimed_at', c.claimed_at, 'released_at', c.released_at, 'outcome', c.outcome, 'reason', c.reason) order by c.claimed_at desc), '[]'::jsonb)
               from baton.claims c where c.task_id = t.id),
    'messages', (select coalesce(jsonb_agg(baton.message_json(m) order by m.created_at), '[]'::jsonb) from baton.messages m where m.task_id = t.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'ts', e.ts, 'type', e.type, 'payload', e.payload, 'session_id', e.session_id,
                 'agent', (select name from baton.agents where id = e.agent_id)) order by e.id desc), '[]'::jsonb)
               from (select * from baton.events where task_id = t.id order by id desc limit 100) e));
end $$;

create function baton.spend_summary() returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'total_usd', (select coalesce(sum(cost_usd), 0) from baton.runs),
    'by_task', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'role', t.role, 'state', t.state,
                  'cost_usd', t.cost_usd, 'budget_usd', t.budget_usd) order by t.cost_usd desc), '[]'::jsonb)
                from baton.tasks t where t.cost_usd > 0),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'cost_usd', r.c) order by r.c desc), '[]'::jsonb)
                from (select a.role, sum(ru.cost_usd) as c from baton.runs ru join baton.agents a on a.id = ru.agent_id group by a.role) r),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cost_usd', d.c) order by d.day), '[]'::jsonb)
               from (select date_trunc('day', started_at)::date as day, sum(cost_usd) as c from baton.runs group by 1) d));
$$;

revoke execute on function
  baton.task_cancel(text, uuid, text), baton.task_force_release(text, uuid), baton.task_reprioritise(text, uuid, int),
  baton.role_upsert(text, text, text, text, text, int), baton.agent_create(text, text, text, text, text, text),
  baton.agent_revoke(text, uuid), baton.runs_usage(uuid, text, uuid, bigint, bigint, numeric, text, text),
  baton.status_summary(), baton.task_detail(uuid), baton.spend_summary()
from public;
grant execute on function
  baton.task_cancel(text, uuid, text), baton.task_force_release(text, uuid), baton.task_reprioritise(text, uuid, int),
  baton.role_upsert(text, text, text, text, text, int), baton.agent_create(text, text, text, text, text, text),
  baton.agent_revoke(text, uuid), baton.runs_usage(uuid, text, uuid, bigint, bigint, numeric, text, text),
  baton.status_summary(), baton.task_detail(uuid), baton.spend_summary()
to service_role;
