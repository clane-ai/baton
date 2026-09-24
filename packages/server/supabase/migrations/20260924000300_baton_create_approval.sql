-- Creating an approval, rather than creating work and waiting for the engine to park it.
--
-- The human inbox is a query over tasks in needs_human or failed, plus unanswered questions, so every
-- row a person sees is a task. But needs_human was only ever reachable through the engine's own
-- transitions: attempts exhausted, budget spent, deadline passed, a delegation that failed. A caller
-- with something for a person to decide — a Clane workflow reaching its approval step — had nothing to
-- call, which is how a product ends up growing a second inbox beside the one it has.
--
-- Rebuilt from the gateways migration, which is the current definition. Two fields are optional and no
-- existing caller changes: `state`, accepted only as needs_human, and the run key, which this already
-- accepted and is kept here unchanged.

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
                             parent_task, scope, budget_usd, max_attempts, created_by, workflow_run, affinity, deadline, condition)
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
            case when jsonb_typeof(f->'condition') = 'object' then f->'condition' else null end)
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
