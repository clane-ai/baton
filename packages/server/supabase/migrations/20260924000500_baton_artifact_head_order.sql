-- One head per task and kind, chosen the same way everywhere.
--
-- The completion gate picks the artefact it validates with `distinct on (kind) ... order by kind,
-- created_at desc`, which is not a total order: two artefacts of the same kind written in the same
-- millisecond — a fast retry, a batch — have no defined winner, and two executions of the same query
-- can pick different rows. Nothing has gone wrong yet because the clock has been kind.
--
-- It matters now because a queue projection will hold that head as a row. If the projection and the
-- gate can disagree, a screen shows one document while the gate validated another, and both are
-- internally consistent. That is the silent-success shape again: nothing errors, and the wrong thing
-- is displayed beside a decision somebody is about to take.
--
-- So the tiebreak is the artefact id, descending, in the same direction as the timestamp, and the
-- projection will use exactly this ordering. Chosen because it is total, stable across executions, and
-- already the natural reading of "the most recent one": of two rows written in the same instant, the
-- one inserted second has the greater id.

create or replace function baton.run_gate(p_task uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; missing text[]; problems text[] := '{}'; a record; v text;
        pr_status text; pending boolean := false; s baton.task_state; failed boolean;
begin
  select * into t from baton.tasks where id = p_task;
  if t.id is null then return baton.err('NOT_FOUND', 'no such task'); end if;
  if t.state <> 'review' then return baton.err('PRECONDITION_FAILED', 'task is not in review'); end if;

  -- 1. every declared kind is present
  select array_agg(p->>'kind') into missing
    from jsonb_array_elements(t.produces) p
   where not exists (select 1 from baton.artifacts x where x.task_id = t.id and x.kind::text = p->>'kind');
  missing := coalesce(missing, '{}');

  -- 2. each latest artefact per kind validates
  for a in select distinct on (kind) * from baton.artifacts where task_id = t.id order by kind, created_at desc, id desc loop
    v := baton.validate_artifact(a.kind, a.schema_version, a.content, a.meta);
    if v is not null then problems := problems || v; end if;
  end loop;

  -- 3. a pr artefact needs green CI
  if exists (select 1 from jsonb_array_elements(t.produces) p where p->>'kind' = 'pr') then
    select meta->>'ci_status' into pr_status from baton.artifacts
     where task_id = t.id and kind = 'pr' order by created_at desc, id desc limit 1;
    if pr_status = 'failure' then
      problems := problems || 'CI failed for the pull request';
    elsif pr_status is distinct from 'success' and array_length(missing, 1) is null then
      pending := true;
    end if;
  end if;

  failed := array_length(missing, 1) is not null or array_length(problems, 1) is not null;

  if not failed and not pending then
    perform set_config('baton.actor', 'gate', true);
    update baton.tasks set state = 'done', assignee = null, lease_until = null, version = version + 1 where id = t.id;
    update baton.claims set released_at = coalesce(released_at, now()), outcome = 'completed'
     where task_id = t.id and outcome in ('submitted') ;
    update baton.agents set current_task = null, status = 'idle' where current_task = t.id;
    insert into baton.events (agent_id, task_id, type, payload) values (t.assignee, t.id, 'gate_passed', '{}'::jsonb);
    perform baton.promote_ready();
    return jsonb_build_object('ok', true, 'state', 'done');
  end if;

  if not failed and pending then
    insert into baton.events (agent_id, task_id, type, payload)
    values (t.assignee, t.id, 'gate_pending_ci', jsonb_build_object('ci_status', pr_status));
    return jsonb_build_object('ok', true, 'state', 'review', 'pending', 'ci');
  end if;

  perform set_config('baton.actor', 'gate', true);
  update baton.tasks
     set state = case when attempts >= max_attempts then 'needs_human'::baton.task_state else 'ready'::baton.task_state end,
         assignee = null, lease_until = null, version = version + 1
   where id = t.id returning state into s;
  update baton.claims set released_at = coalesce(released_at, now()), outcome = 'failed', reason = 'gate failed'
   where task_id = t.id and outcome = 'submitted';
  update baton.agents set current_task = null, status = 'idle' where current_task = t.id;
  insert into baton.events (agent_id, task_id, type, payload)
  values (t.assignee, t.id, 'gate_failed', jsonb_build_object('missing', to_jsonb(missing), 'problems', to_jsonb(problems), 'to', s));
  return jsonb_build_object('ok', false, 'state', s,
           'error', jsonb_build_object('code', 'GATE_FAILED', 'retryable', false,
             'message', 'Completion gate failed. Missing: ' || array_to_string(missing, ', ') || '. Problems: ' || array_to_string(problems, '; '),
             'missing', to_jsonb(missing), 'problems', to_jsonb(problems)));
end $$;

-- The gate's own lookup had no index that matched it: the kind index is global and the task index
-- carries neither the kind nor an ordering, so finding the latest per kind for one task was doing more
-- work than it needed on every gate run. The projection will make this moot for the queue, but the gate
-- still runs the query.
create index if not exists artifacts_task_kind_head_idx
  on baton.artifacts (task_id, kind, created_at desc, id desc);

-- KNOWN, NOT FIXED HERE. The same non-total ordering appears in four more places, all of them the
-- GitHub face selecting the latest pull-request artefact for a task, in the github and gh-queue-fix
-- migrations. They have the same fault and a smaller consequence: a tie picks an arbitrary one of two
-- pull-request rows for the same task, which affects a comment or a status rather than a document
-- somebody approves. They are left for a follow-up rather than swept into a correctness change to the
-- gate, so that this migration remains reviewable as one idea. The remaining two, in task_detail, are
-- list orderings rather than head selections: a tie changes display order and picks nothing.
