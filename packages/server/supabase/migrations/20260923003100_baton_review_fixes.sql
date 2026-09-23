-- Fixes from the 23 Sep 2026 review (docs/p2p-simulation.md, section "Review"), applied before the procure-to-pay runs.
--
--  1. condition_satisfied compared ANY artefact of the kind on the deciding task; it now reads the latest
--     one only, so a corrected artefact cannot ready both branches of a gateway.
--  2. claim_next counted a resume (after task_ask or task_delegate) as an attempt; only fresh claims count.
--  3. needs_human and failed were terminal. task_retry(actor, task, reset_attempts, budget) puts a task back
--     into the queue (blocked, then promoted if its preconditions hold). Event task_retried.
--  4. workflow_run_status treats tasks cancelled by the gateway cascade (event cancelled_upstream) like the
--     branch not taken, so a run whose rejected branch ended cleanly reads done, not cancelled.
--  5. enforce_deadlines also raises approval_overdue (once) for an operator task waiting past its deadline,
--     so a webhook or the human can escalate. It does not decide for the human.

-- 1. latest artefact decides
create or replace function baton.condition_satisfied(p_task uuid) returns boolean
language sql stable as $$
  select case
    when t.condition is null then true
    else coalesce((
      select a.content ->> (t.condition->>'field') = (t.condition->>'equals')
        from baton.tasks d
        join baton.artifacts a on a.task_id = d.id and a.kind::text = (t.condition->>'kind')
       where d.id = (t.condition->>'task')::uuid and d.state = 'done'
       order by a.created_at desc limit 1), false)
    end
  from baton.tasks t where t.id = p_task;
$$;

-- 2. resumes do not burn attempts
create or replace function baton.claim_next(p_agent uuid, p_lease_seconds integer default 1800) returns baton.tasks
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r text; a_name text; a_machine text;
begin
  select role, name, machine into r, a_name, a_machine from baton.agents where id = p_agent;
  if r is null then return null; end if;
  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set
    state = 'in_progress', assignee = p_agent, lease_until = now() + make_interval(secs => p_lease_seconds),
    -- a claim that resumes work parked by task_ask or task_delegate is not a new attempt
    attempts = attempts + case when (
        select c.outcome = 'released' and c.reason like 'blocked:%' from baton.claims c
         where c.task_id = baton.tasks.id order by c.claimed_at desc limit 1)
      then 0 else 1 end,
    version = version + 1
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

-- 3. operator retry for parked tasks
create or replace function baton.task_retry(p_actor text, p_task uuid, p_reset_attempts boolean default true, p_budget_usd numeric default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; s baton.task_state;
begin
  select * into t from baton.tasks where id = p_task for update;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.state not in ('needs_human', 'failed') then return baton.err('PRECONDITION_FAILED', 'only a needs_human or failed task can be retried (state ' || t.state || ')'); end if;
  if t.role = 'operator' then return baton.err('PRECONDITION_FAILED', 'an approval is decided with approve or reject, not retried'); end if;
  perform set_config('baton.actor', p_actor, true);
  update baton.tasks
     set state = 'blocked', assignee = null, lease_until = null,
         attempts = case when p_reset_attempts then 0 else attempts end,
         budget_usd = coalesce(p_budget_usd, budget_usd),
         waiting_on = case when waiting_on is not null and exists (select 1 from baton.tasks c where c.id = t.waiting_on and c.state in ('done', 'cancelled', 'failed')) then null else waiting_on end,
         version = version + 1
   where id = p_task;
  perform baton.promote_ready(p_task);
  select state into s from baton.tasks where id = p_task;
  insert into baton.events (task_id, type, payload)
  values (p_task, 'task_retried', jsonb_build_object('by', p_actor, 'from', t.state, 'to', s, 'reset_attempts', p_reset_attempts, 'budget_usd', p_budget_usd, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'state', s);
end $$;
revoke execute on function baton.task_retry(text, uuid, boolean, numeric, text) from public;
grant  execute on function baton.task_retry(text, uuid, boolean, numeric, text) to service_role;

-- 4. cascade-cancelled tasks are branches not taken
create or replace function baton.workflow_run_status(p_key text) returns text
language sql stable as $$
  select case
    when count(*) = 0 then 'empty'
    when bool_or(t.state = 'needs_human') then 'needs_human'
    when bool_or(t.state = 'failed') then 'failed'
    when bool_and(t.state = 'done' or (t.state = 'cancelled' and (t.condition is not null
           or exists (select 1 from baton.events e where e.task_id = t.id and e.type = 'cancelled_upstream')))) then 'done'
    when bool_and(t.state in ('done', 'cancelled')) then 'cancelled'
    when bool_or(t.state in ('in_progress', 'review')) then 'running'
    when bool_or(t.state = 'blocked') then 'blocked'
    else 'pending' end
  from baton.tasks t where t.workflow_run = p_key;
$$;

-- 5. overdue approvals raise an event, once
create or replace function baton.enforce_deadlines() returns integer
language plpgsql security definer set search_path = baton, pg_temp as $$
declare n int := 0; m int := 0;
begin
  perform set_config('baton.actor', 'deadline', true);
  with late as (
    update baton.tasks set state = 'needs_human', version = version + 1
     where deadline is not null and deadline < now() and state in ('draft', 'ready', 'blocked')
     returning id, key, deadline)
  insert into baton.events (task_id, type, payload)
  select id, 'deadline_passed', jsonb_build_object('key', key, 'deadline', deadline) from late;
  get diagnostics n = row_count;
  insert into baton.events (task_id, type, payload)
  select t.id, 'approval_overdue', jsonb_build_object('key', t.key, 'deadline', t.deadline, 'waiting_minutes', floor(extract(epoch from now() - t.deadline) / 60))
    from baton.tasks t
   where t.role = 'operator' and t.state = 'needs_human' and t.deadline is not null and t.deadline < now()
     and not exists (select 1 from baton.events e where e.task_id = t.id and e.type = 'approval_overdue');
  get diagnostics m = row_count;
  return n + m;
end $$;
