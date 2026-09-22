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
