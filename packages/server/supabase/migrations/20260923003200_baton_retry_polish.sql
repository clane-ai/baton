-- task_retry follow-ups from the review of 20260923003100:
--   1. a task retried after its deadline passed would bounce back to needs_human on the next deadline tick;
--      task_retry now takes p_deadline (null keeps, 'clear' removes) and refuses a past deadline unless given a new one.
--   2. a parent whose delegated child ended cancelled or failed kept consumes pinned to that child, so it sat in
--      blocked forever; those pins are removed and an event says so.

drop function if exists baton.task_retry(text, uuid, boolean, numeric, text);
create or replace function baton.task_retry(p_actor text, p_task uuid, p_reset_attempts boolean default true, p_budget_usd numeric default null, p_reason text default null, p_deadline text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; s baton.task_state; new_deadline timestamptz; dropped jsonb;
begin
  select * into t from baton.tasks where id = p_task for update;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.state not in ('needs_human', 'failed') then return baton.err('PRECONDITION_FAILED', 'only a needs_human or failed task can be retried (state ' || t.state || ')'); end if;
  if t.role = 'operator' then return baton.err('PRECONDITION_FAILED', 'an approval is decided with approve or reject, not retried'); end if;
  new_deadline := case when p_deadline is null then t.deadline when p_deadline = 'clear' then null else p_deadline::timestamptz end;
  if new_deadline is not null and new_deadline < now() then
    return baton.err('PRECONDITION_FAILED', 'the deadline ' || new_deadline::text || ' has passed; retry with --deadline <new time> or --deadline clear');
  end if;
  -- consumes pinned to a child that will never deliver are dropped, so the promoter can ready the task
  select coalesce(jsonb_agg(c), '[]'::jsonb) into dropped
    from jsonb_array_elements(t.consumes) c
    join baton.tasks ch on ch.id = (c->>'from_task')::uuid
   where ch.state in ('cancelled', 'failed');
  perform set_config('baton.actor', p_actor, true);
  update baton.tasks
     set state = 'blocked', assignee = null, lease_until = null,
         attempts = case when p_reset_attempts then 0 else attempts end,
         budget_usd = coalesce(p_budget_usd, budget_usd),
         deadline = new_deadline,
         waiting_on = case when waiting_on is not null and exists (select 1 from baton.tasks c where c.id = t.waiting_on and c.state in ('done', 'cancelled', 'failed')) then null else waiting_on end,
         consumes = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(t.consumes) c
                      where not exists (select 1 from baton.tasks ch where ch.id = (c->>'from_task')::uuid and ch.state in ('cancelled', 'failed'))),
         version = version + 1
   where id = p_task;
  perform baton.promote_ready(p_task);
  select state into s from baton.tasks where id = p_task;
  insert into baton.events (task_id, type, payload)
  values (p_task, 'task_retried', jsonb_build_object('by', p_actor, 'from', t.state, 'to', s, 'reset_attempts', p_reset_attempts, 'budget_usd', p_budget_usd,
          'deadline', new_deadline, 'dropped_consumes', dropped, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'state', s, 'dropped_consumes', dropped);
end $$;
revoke execute on function baton.task_retry(text, uuid, boolean, numeric, text, text) from public;
grant  execute on function baton.task_retry(text, uuid, boolean, numeric, text, text) to service_role;
