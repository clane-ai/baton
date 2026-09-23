-- Every rejected mutating call is logged (prd.md 13.5: there is no silent path; acceptance 23).
-- check_lease now records a tool_rejected event when it refuses, so callers need no change.
-- The two-argument overload must go, or existing callers would keep resolving to it.
drop function if exists baton.check_lease(uuid, uuid);
create function baton.check_lease(p_agent uuid, p_task uuid, p_tool text default null) returns text
language plpgsql as $$
declare t baton.tasks; code text;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then
    code := 'NOT_FOUND';
  elsif t.assignee = p_agent and t.state = 'in_progress' and t.lease_until is not null and t.lease_until >= now() then
    return null;
  elsif exists (select 1 from baton.claims c where c.task_id = p_task and c.agent_id = p_agent) then
    code := 'LEASE_LOST';
  else
    code := 'NOT_ASSIGNED';
  end if;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, t.id, 'tool_rejected', jsonb_build_object('code', code, 'tool', p_tool, 'assignee', t.assignee, 'state', t.state));
  return code;
end $$;
