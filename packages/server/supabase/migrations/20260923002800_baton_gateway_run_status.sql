-- Run status with gateways: a branch not taken is a cancelled task with a condition, and a run whose
-- only cancelled tasks are such branches counts as done, not cancelled. The step JSON carries the
-- condition so the dashboard can draw the gateway. (Applied to the project on 23 Sep 2026; filed here
-- so the repository matches the database.)

create or replace function baton.workflow_run_status(p_key text) returns text
language sql stable as $$
  select case
    when count(*) = 0 then 'empty'
    when bool_or(state = 'needs_human') then 'needs_human'
    when bool_or(state = 'failed') then 'failed'
    when bool_and(state = 'done' or (state = 'cancelled' and condition is not null)) then 'done'
    when bool_and(state in ('done', 'cancelled')) then 'cancelled'
    when bool_or(state in ('in_progress', 'review')) then 'running'
    when bool_or(state = 'blocked') then 'blocked'
    else 'pending' end
  from baton.tasks where workflow_run = p_key;
$$;

create or replace function baton.workflow_run_json(p_key text) returns jsonb
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
                'produces', t.produces, 'condition', t.condition) order by t.priority desc, t.created_at), '[]'::jsonb)
              from baton.tasks t where t.workflow_run = r.key))
  from baton.workflow_runs r where r.key = p_key;
$$;
