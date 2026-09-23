-- Exclusive gateways (BPMN "decision"): a task may carry a condition on the outcome of an earlier
-- task. It becomes ready only when that task is done and its named artefact field has the expected
-- value; when the deciding task finishes with a different outcome, the task is cancelled as a branch
-- not taken. Cancelling a task also cancels its not-yet-started dependants, so a run never hangs.
--
--   condition = {"task": "<uuid of the deciding task>", "kind": "review", "field": "verdict", "equals": "approve", "outcome": "yes"}

alter table baton.tasks add column condition jsonb;

create function baton.condition_satisfied(p_task uuid) returns boolean
language sql stable as $$
  select case
    when t.condition is null then true
    else exists (
      select 1 from baton.tasks d
        join baton.artifacts a on a.task_id = d.id and a.kind::text = (t.condition->>'kind')
       where d.id = (t.condition->>'task')::uuid and d.state = 'done'
         and a.content ->> (t.condition->>'field') = (t.condition->>'equals')
       order by a.created_at desc limit 1)
    end
  from baton.tasks t where t.id = p_task;
$$;

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
       and baton.condition_satisfied(t.id)
       and not exists (
             select 1 from baton.messages m
              where m.task_id = t.id and m.kind = 'question' and m.answered_at is null)
     returning t.id
  )
  select count(*) into n from promoted;
  return n;
end $$;

-- task_create reads condition; task_json exposes it.
create or replace function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd, 'cost_credits', t.cost_credits,
    'parent_task', t.parent_task, 'waiting_on', t.waiting_on, 'workflow_run', t.workflow_run,
    'affinity', t.affinity, 'deadline', t.deadline, 'condition', t.condition,
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
                             parent_task, scope, budget_usd, max_attempts, created_by, workflow_run, affinity, deadline, condition)
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
            (f->>'deadline')::timestamptz,
            case when jsonb_typeof(f->'condition') = 'object' then f->'condition' else null end)
    returning * into t;
  exception when check_violation or foreign_key_violation or invalid_text_representation or datetime_field_overflow then
    return baton.err('PRECONDITION_FAILED', sqlerrm);
  end;
  perform baton.promote_ready(t.id);
  select * into t from baton.tasks where id = t.id;
  return jsonb_build_object('ok', true, 'task', baton.task_json(t));
end $$;

-- Rejecting an approval records the decision as a review with verdict request_changes and completes
-- the approval task, so a gateway can route the "no" branch. Dependants without a condition are
-- cancelled (the plain case: no branch, nothing may proceed).
create or replace function baton.task_approve(p_actor text, p_task uuid, p_verdict text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; g jsonb; v text;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.role <> 'operator' then return baton.err('PRECONDITION_FAILED', 'only operator (approval) tasks can be approved or rejected; cancel or prioritise other tasks'); end if;
  if t.state in ('done', 'cancelled') then return baton.err('PRECONDITION_FAILED', 'task is already ' || t.state); end if;
  if p_verdict not in ('approve', 'reject') then return baton.err('PRECONDITION_FAILED', 'verdict must be approve or reject'); end if;
  v := case when p_verdict = 'approve' then 'approve' else 'request_changes' end;
  perform set_config('baton.actor', p_actor, true);
  insert into baton.artifacts (task_id, kind, uri, schema_version, meta, content)
  values (t.id, 'review', 'baton://approval/' || t.key, 'v1', jsonb_build_object('by', p_actor),
          jsonb_build_object('verdict', v, 'summary', coalesce(nullif(p_reason, ''), initcap(p_verdict) || 'd by ' || p_actor), 'findings', '[]'::jsonb));
  update baton.tasks set state = 'review', version = version + 1 where id = t.id;
  insert into baton.events (task_id, type, payload) values (t.id, case when v = 'approve' then 'approved' else 'rejected' end, jsonb_build_object('by', p_actor, 'reason', p_reason));
  g := baton.run_gate(t.id);
  if v = 'request_changes' then
    -- Plain dependants (no gateway) may not proceed after a rejection.
    perform baton.task_cancel(p_actor, d.id, 'upstream approval ' || t.key || ' rejected')
      from baton.tasks d where t.id = any(d.depends_on) and d.condition is null and d.state in ('draft', 'ready', 'blocked');
  end if;
  return jsonb_build_object('ok', true, 'verdict', v, 'state', (select state from baton.tasks where id = t.id), 'gate', g);
end $$;

-- Branches not taken, and dependants of a cancelled task, are cancelled so a run cannot hang.
create function baton.branches_on_task() returns trigger
language plpgsql as $$
declare d record;
begin
  if new.state = 'done' and old.state is distinct from 'done' then
    for d in select id, key from baton.tasks x where x.condition->>'task' = new.id::text and x.state in ('draft', 'ready', 'blocked') and not baton.condition_satisfied(x.id) loop
      perform set_config('baton.actor', 'gateway', true);
      update baton.tasks set state = 'cancelled', version = version + 1 where id = d.id;
      insert into baton.events (task_id, type, payload) values (d.id, 'branch_not_taken', jsonb_build_object('decided_by', new.key, 'outcome_required', (select condition->>'outcome' from baton.tasks where id = d.id)));
    end loop;
  end if;
  if new.state = 'cancelled' and old.state is distinct from 'cancelled' then
    for d in select id, key from baton.tasks x where new.id = any(x.depends_on) and x.state in ('draft', 'ready', 'blocked') loop
      perform set_config('baton.actor', 'gateway', true);
      update baton.tasks set state = 'cancelled', version = version + 1 where id = d.id;
      insert into baton.events (task_id, type, payload) values (d.id, 'cancelled_upstream', jsonb_build_object('because', new.key));
    end loop;
  end if;
  return null;
end $$;
create trigger tasks_branches after update of state on baton.tasks
  for each row execute function baton.branches_on_task();
