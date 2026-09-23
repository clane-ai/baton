-- Delegation (docs/delegation.md): hand part of a task to another role, sleep, resume with the result.
alter table baton.tasks add column waiting_on uuid references baton.tasks(id);
create index tasks_waiting_on_idx on baton.tasks (waiting_on) where waiting_on is not null;

create or replace function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd,
    'parent_task', t.parent_task, 'waiting_on', t.waiting_on, 'github_issue', t.github_issue, 'version', t.version,
    'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at);
$$;

-- A task waiting on a delegated child is never promoted by inputs alone; the child's gate wakes it.
create or replace function baton.promote_ready(p_task uuid default null) returns int
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0;
begin
  perform set_config('baton.actor', coalesce(nullif(current_setting('baton.actor', true), ''), 'promoter'), true);
  with promoted as (
    update baton.tasks t
       set state = 'ready', version = t.version + 1
     where t.state in ('draft', 'blocked')
       and (p_task is null or t.id = p_task)
       and t.waiting_on is null
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

create function baton.task_delegate(p_agent uuid, p_task uuid, p_role text, p_title text, p_spec text, p_acceptance text,
                                    p_produces jsonb, p_priority int default null, p_scope text[] default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; parent baton.tasks; r jsonb; child baton.tasks; k text; cons jsonb;
begin
  e := baton.check_lease(p_agent, p_task, 'task_delegate');
  if e is not null then return baton.lease_error(e); end if;
  select * into parent from baton.tasks where id = p_task;
  if parent.waiting_on is not null then return baton.err('PRECONDITION_FAILED', 'already waiting on a delegated task'); end if;
  if p_produces is null or jsonb_typeof(p_produces) <> 'array' or jsonb_array_length(p_produces) = 0 then
    return baton.err('PRECONDITION_FAILED', 'produces must name at least one artefact kind');
  end if;
  for k in select x from jsonb_array_elements_text(p_produces) x loop
    if not exists (select 1 from pg_enum where enumtypid = 'baton.artifact_kind'::regtype and enumlabel = k) then
      return baton.err('PRECONDITION_FAILED', 'unknown artefact kind ' || k);
    end if;
  end loop;

  r := baton.task_create('agent:' || p_agent::text, jsonb_build_object(
         'title', p_title, 'spec', p_spec, 'acceptance', p_acceptance, 'role', p_role,
         'priority', coalesce(p_priority, parent.priority + 10),
         'produces', (select jsonb_agg(jsonb_build_object('kind', x)) from jsonb_array_elements_text(p_produces) x),
         'parent_task', p_task,
         'scope', coalesce(to_jsonb(p_scope), '[]'::jsonb),
         'budget_usd', parent.budget_usd));
  if not (r ->> 'ok')::boolean then return r; end if;
  select * into child from baton.tasks where id = (r #>> '{task,id}')::uuid;

  cons := coalesce(parent.consumes, '[]'::jsonb)
          || (select jsonb_agg(jsonb_build_object('kind', x, 'from_task', child.id)) from jsonb_array_elements_text(p_produces) x);
  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set state = 'blocked', waiting_on = child.id, consumes = cons, assignee = null, lease_until = null, version = version + 1
   where id = p_task;
  update baton.claims set released_at = now(), outcome = 'released', reason = 'blocked: delegated to ' || child.key
   where task_id = p_task and agent_id = p_agent and released_at is null;
  update baton.agents set current_task = null, status = 'idle', last_seen = now() where id = p_agent;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'task_delegated', jsonb_build_object('child_id', child.id, 'child_key', child.key, 'role', p_role, 'produces', p_produces));
  return jsonb_build_object('ok', true, 'child', jsonb_build_object('id', child.id, 'key', child.key, 'role', child.role, 'state', child.state),
           'state', 'blocked',
           'message', 'Your task is blocked until ' || child.key || ' is done. Exit now. You will be respawned with its artefacts in your consumes.');
end $$;

-- When a delegated child finishes, wake the parent (done) or hand it to a human (cancelled, failed).
create function baton.delegation_on_task() returns trigger
language plpgsql as $$
declare parent baton.tasks; kinds text;
begin
  if new.state in ('done', 'cancelled', 'failed') and old.state is distinct from new.state then
    for parent in select * from baton.tasks where waiting_on = new.id loop
      if new.state = 'done' then
        select string_agg(p ->> 'kind', ', ') into kinds from jsonb_array_elements(new.produces) p;
        update baton.tasks set waiting_on = null, version = version + 1 where id = parent.id;
        insert into baton.messages (task_id, to_role, kind, body)
        values (parent.id, parent.role, 'notice',
                'Delegated task ' || new.key || ' (' || new.title || ') is done. Its artefacts (' || coalesce(kinds, 'none') || ') are in the consumes of ' ||
                parent.key || '. Claim ' || parent.key || ' with task_next and read them with artifact_get task_id=' || new.id::text || '.');
        insert into baton.events (task_id, type, payload)
        values (parent.id, 'delegation_returned', jsonb_build_object('child_id', new.id, 'child_key', new.key, 'produces', new.produces, 'cost_usd', new.cost_usd));
        perform baton.promote_ready(parent.id);
      else
        update baton.tasks set waiting_on = null, state = 'needs_human', version = version + 1 where id = parent.id;
        insert into baton.events (task_id, type, payload)
        values (parent.id, 'delegation_failed', jsonb_build_object('child_id', new.id, 'child_key', new.key, 'child_state', new.state));
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger tasks_delegation after update of state on baton.tasks
  for each row execute function baton.delegation_on_task();
