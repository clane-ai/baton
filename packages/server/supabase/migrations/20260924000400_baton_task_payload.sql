-- A task that carries what a machine needs to do it.
--
-- A Clane code node has no claimant: the engine hands work out, and a node's source is not work anyone
-- can pick up. It becomes claimable if a worker inside Clane runs it, but that worker is a machine with
-- an agent token and no session, so it cannot go back to Clane and ask what it is supposed to execute.
-- The task has to be self-contained.
--
-- Hence a payload: an opaque object the engine stores and hands back, never interprets. The engine's
-- own vocabulary is roles, artefacts and conditions, and that does not change here. The alternative was
-- smuggling JSON inside the spec text, which turns a machine contract into something parsed out of
-- prose, and which nobody would have chosen deliberately.

alter table baton.tasks add column if not exists payload jsonb;

comment on column baton.tasks.payload is
  'Opaque instructions for whoever claims the task, stored and returned unchanged. Carries everything a machine worker needs so it does not have to ask anyone what to run. The engine never reads inside it.';

-- Exposed additively. Rebuilt from the create-approval migration, which is the current definition;
-- every existing field keeps its name and position and one is added at the end.
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
    'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'state_since', t.state_since, 'payload', t.payload);
$$;

-- The role that claims these. Registered here rather than created by hand so it exists in every
-- deployment, and described by what it does rather than by what it is called.
insert into baton.roles (name, description, max_concurrent)
values ('clane-worker',
        'A worker inside Clane that executes a workflow node — its code today, its app actions next — and registers the output as an artefact. Claims tasks whose payload it understands and refuses the rest.',
        4)
on conflict (name) do update set description = excluded.description;

-- The create route accepts it. Rebuilt from the create-approval migration, which is the current
-- definition: every existing field keeps its name and position, and the payload is appended.
create or replace function baton.task_create(p_actor text, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; f jsonb := coalesce(p_fields, '{}'::jsonb); s text;
begin
  if length(btrim(coalesce(f->>'title', ''))) = 0
     or length(btrim(coalesce(f->>'spec', ''))) = 0
     or length(btrim(coalesce(f->>'acceptance', ''))) = 0 then
    return baton.err('PRECONDITION_FAILED', 'title, spec and acceptance are required');
  end if;
  if not exists (select 1 from baton.roles where name = f->>'role') then
    return baton.err('PRECONDITION_FAILED', 'unknown role ' || coalesce(f->>'role', '(none)'));
  end if;

  -- The only state a caller may ask for. Everything else is a consequence the engine reaches on its
  -- own, and backfilling history through this door would put rows in the audit trail that describe
  -- work nobody did. Refused by name so the message says what is allowed rather than that something
  -- was wrong.
  s := nullif(btrim(coalesce(f->>'state', '')), '');
  if s is not null and s <> 'needs_human' then
    return baton.err('PRECONDITION_FAILED',
      'state may only be set to needs_human when creating a task for a person to decide; ' ||
      s || ' is reached by the engine, not by a caller');
  end if;
  -- An approval is an operator task: that is what makes it decidable, because approve and reject
  -- refuse any other role. Creating one for a different role would put a row in the inbox that nobody
  -- can act on, which looks like a product fault rather than a caller mistake.
  if s = 'needs_human' and coalesce(f->>'role', '') <> 'operator' then
    return baton.err('PRECONDITION_FAILED',
      'a task created in needs_human must have role operator, since only operator tasks can be approved or rejected');
  end if;

  perform set_config('baton.actor', p_actor, true);
  begin
    insert into baton.tasks (title, spec, acceptance, role, state, priority, depends_on, consumes, produces,
                             parent_task, scope, budget_usd, max_attempts, created_by, workflow_run, affinity, deadline, condition, payload)
    values (f->>'title', f->>'spec', f->>'acceptance', f->>'role',
            coalesce(s, 'draft')::baton.task_state,
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
            case when jsonb_typeof(f->'condition') = 'object' then f->'condition' else null end,
            case when jsonb_typeof(f->'payload') = 'object' then f->'payload' else null end)
    returning * into t;
  exception when check_violation or foreign_key_violation or invalid_text_representation or datetime_field_overflow then
    return baton.err('PRECONDITION_FAILED', sqlerrm);
  end;

  -- The inbox works out how long something has been waiting from the latest of approval_required,
  -- task_state_changed, deadline_passed or gate_failed. A task created straight into needs_human has
  -- none of those, so without this its waiting time would be empty and it would sort oddly against
  -- everything else. This is the same event the engine emits when it parks a task itself, so the two
  -- kinds of approval are indistinguishable downstream, which is the point.
  if t.state = 'needs_human' then
    insert into baton.events (task_id, type, payload)
    values (t.id, 'approval_required',
            jsonb_build_object('by', p_actor, 'created_directly', true,
                               'workflow_run', t.workflow_run, 'deadline', t.deadline));
  end if;

  -- A no-op for a task already in needs_human: the promoter only moves draft and blocked rows.
  perform baton.promote_ready(t.id);
  select * into t from baton.tasks where id = t.id;
  return jsonb_build_object('ok', true, 'task', baton.task_json(t));
end $$;
