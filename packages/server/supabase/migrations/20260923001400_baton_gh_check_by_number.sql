-- CI webhooks carry the pull request numbers as well as the head sha. Match pr artefacts by
-- either, and remember the head sha on the artefact, so an agent that registered only the
-- PR number still gets its gate driven by CI.
drop function if exists baton.gh_check_event(text, text, text, jsonb);
create function baton.gh_check_event(p_repo text, p_head_sha text, p_status text, p_details jsonb default '{}'::jsonb, p_numbers int[] default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.artifacts; t baton.tasks; results jsonb := '[]'::jsonb; r jsonb; fix jsonb; rep uuid;
begin
  if p_status not in ('pending', 'success', 'failure') then
    return baton.err('PRECONDITION_FAILED', 'status must be pending, success or failure');
  end if;
  for a in
    select distinct on (x.task_id) x.* from baton.artifacts x
     where x.kind = 'pr' and lower(x.meta->>'repo') = lower(p_repo)
       and ((p_head_sha <> '' and x.meta->>'head_sha' = p_head_sha)
         or (p_numbers is not null and (x.meta->>'number')::int = any(p_numbers)))
     order by x.task_id, x.created_at desc
  loop
    update baton.artifacts set meta = meta || jsonb_build_object('ci_status', p_status) || case when p_head_sha <> '' then jsonb_build_object('head_sha', p_head_sha) else '{}'::jsonb end where id = a.id;
    select * into t from baton.tasks where id = a.task_id;
    insert into baton.events (agent_id, task_id, type, payload)
    values (t.assignee, t.id, 'gh_check', jsonb_build_object('status', p_status, 'head_sha', p_head_sha) || coalesce(p_details, '{}'::jsonb));

    if t.state <> 'review' then
      results := results || jsonb_build_object('task', t.key, 'state', t.state, 'note', 'not in review');
      continue;
    end if;
    if p_status = 'success' then
      r := baton.run_gate(t.id);
      results := results || jsonb_build_object('task', t.key, 'gate', r);
    elsif p_status = 'failure' then
      perform set_config('baton.actor', 'github', true);
      insert into baton.artifacts (task_id, kind, uri, schema_version, meta, content)
      values (t.id, 'test_report', coalesce(p_details->>'url', 'github://' || p_repo || '/' || p_head_sha), 'v1',
              jsonb_build_object('source', 'github', 'head_sha', p_head_sha),
              jsonb_build_object('build_sha', p_head_sha, 'suite', coalesce(p_details->>'name', 'ci'), 'passed', 0, 'failed', 1, 'skipped', 0,
                'failures', jsonb_build_array(jsonb_build_object('name', coalesce(p_details->>'name', 'ci'), 'message', coalesce(p_details->>'conclusion', 'failure') || coalesce(': ' || (p_details->>'summary'), ''))),
                'summary', 'CI failed on ' || left(p_head_sha, 7) || ' for ' || t.key))
      returning id into rep;
      update baton.tasks set state = 'failed', assignee = null, lease_until = null, version = version + 1 where id = t.id;
      update baton.claims set released_at = coalesce(released_at, now()), outcome = 'failed', reason = 'CI failed' where task_id = t.id and outcome = 'submitted';
      fix := baton.task_create('github', jsonb_build_object(
        'title', 'Fix CI failure on ' || t.key || ': ' || t.title,
        'spec', 'CI failed on head ' || p_head_sha || ' for pull request ' || coalesce(a.meta->>'url', a.uri) || '. Read the test_report artefact from ' || t.key || ', fix the cause on the same branch (' || coalesce(a.meta->>'branch', 'the PR branch') || '), push, and register the pr artefact again. Original spec follows.' || E'\n\n' || t.spec,
        'acceptance', t.acceptance,
        'role', t.role, 'priority', t.priority + 10, 'parent_task', t.id, 'scope', to_jsonb(t.scope),
        'consumes', jsonb_build_array(jsonb_build_object('kind', 'test_report', 'from_task', t.id)),
        'produces', t.produces, 'budget_usd', t.budget_usd, 'max_attempts', t.max_attempts));
      insert into baton.events (task_id, type, payload)
      values (t.id, 'fix_task_created', jsonb_build_object('fix_task', fix->'task'->>'id', 'fix_key', fix->'task'->>'key', 'test_report', rep));
      results := results || jsonb_build_object('task', t.key, 'state', 'failed', 'fix_task', fix->'task'->>'key');
    else
      results := results || jsonb_build_object('task', t.key, 'state', 'review', 'note', 'ci pending');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'results', results);
end $$;
revoke execute on function baton.gh_check_event(text, text, text, jsonb, int[]) from public;
grant execute on function baton.gh_check_event(text, text, text, jsonb, int[]) to service_role;
