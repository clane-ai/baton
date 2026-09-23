-- Phase 7: GitHub integration (prd.md 12.4, 10.3 step 3, section 18 phase 7).
-- Inbound webhooks update pr artefacts and drive the gate. Outbound calls are queued
-- by state transitions into gh_outbox and sent by the service, never from the hook face.

create table baton.gh_outbox (
  id         bigserial primary key,
  kind       text not null,                -- open_pr | promote_issue | completion_comment | close_issue
  task_id    uuid references baton.tasks(id),
  repo       text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  error      text
);
create index gh_outbox_pending_idx on baton.gh_outbox (created_at) where sent_at is null;
alter table baton.gh_outbox enable row level security;
create policy service_all on baton.gh_outbox for all to service_role using (true) with check (true);
create policy human_read on baton.gh_outbox for select to authenticated using (true);

-- Latest pr artefact for a repo and PR number, or for a head sha.
create function baton.pr_artifacts(p_repo text, p_number int, p_head_sha text) returns setof baton.artifacts
language sql stable as $$
  select a.* from baton.artifacts a
   where a.kind = 'pr'
     and (p_repo is null or lower(a.meta->>'repo') = lower(p_repo))
     and ((p_number is not null and (a.meta->>'number')::int = p_number)
       or (p_head_sha is not null and a.meta->>'head_sha' = p_head_sha))
   order by a.created_at desc;
$$;

-- pull_request webhook: keep the artefact current; a merge closes the promoted issue.
create function baton.gh_pr_event(p_repo text, p_number int, p_head_sha text, p_action text, p_url text, p_merged boolean, p_branch text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.artifacts; touched uuid[] := '{}'; t baton.tasks;
begin
  for a in
    select * from baton.artifacts x
     where x.kind = 'pr' and lower(x.meta->>'repo') = lower(p_repo)
       and ((x.meta->>'number')::int = p_number or (p_branch is not null and x.meta->>'branch' = p_branch and x.meta->>'number' is null))
  loop
    update baton.artifacts
       set meta = meta || jsonb_strip_nulls(jsonb_build_object('number', p_number, 'url', p_url, 'head_sha', p_head_sha, 'merged', p_merged)),
           uri = coalesce(p_url, uri)
     where id = a.id;
    touched := touched || a.task_id;
    insert into baton.events (task_id, type, payload)
    values (a.task_id, 'gh_pull_request', jsonb_build_object('action', p_action, 'number', p_number, 'head_sha', p_head_sha, 'merged', p_merged));
    if p_action = 'closed' and p_merged then
      select * into t from baton.tasks where id = a.task_id;
      if t.github_issue is not null then
        insert into baton.gh_outbox (kind, task_id, repo, payload)
        values ('close_issue', t.id, p_repo, jsonb_build_object('issue', t.github_issue, 'pr', p_number));
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'tasks', to_jsonb(touched));
end $$;

-- check_suite / check_run / workflow_run / status webhook: CI verdict for a head sha.
-- success  -> re-run the gate for tasks in review
-- failure  -> the task is failed and a fix task for the originating role is created,
--             consuming a test_report built from the check (prd.md 18 acceptance 20)
create function baton.gh_check_event(p_repo text, p_head_sha text, p_status text, p_details jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare a baton.artifacts; t baton.tasks; results jsonb := '[]'::jsonb; r jsonb; fix jsonb; rep uuid;
begin
  if p_status not in ('pending', 'success', 'failure') then
    return baton.err('PRECONDITION_FAILED', 'status must be pending, success or failure');
  end if;
  for a in select distinct on (task_id) * from baton.pr_artifacts(p_repo, null, p_head_sha) order by task_id, created_at desc loop
    update baton.artifacts set meta = meta || jsonb_build_object('ci_status', p_status) where id = a.id;
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

-- Outbound triggers: state transitions queue GitHub calls.
create function baton.gh_queue_on_task() returns trigger
language plpgsql as $$
declare pr baton.artifacts;
begin
  -- Promotion rule (12.4): a task that needs a human decision outlives the agent run.
  if new.state = 'needs_human' and old.state is distinct from 'needs_human' and new.github_issue is null then
    insert into baton.gh_outbox (kind, task_id, repo, payload)
    select 'promote_issue', new.id, coalesce(pr.meta->>'repo', current_setting('baton.default_repo', true), ''), jsonb_build_object('key', new.key, 'title', new.title)
      from (select * from baton.artifacts where task_id = new.id and kind = 'pr' order by created_at desc limit 1) pr
      right join (select 1) x on true
     where coalesce(pr.meta->>'repo', current_setting('baton.default_repo', true), '') <> '';
  end if;
  -- One completion summary on the PR when the gate passes.
  if new.state = 'done' and old.state is distinct from 'done' then
    select * into pr from baton.artifacts where task_id = new.id and kind = 'pr' and meta->>'number' is not null order by created_at desc limit 1;
    if pr.id is not null then
      insert into baton.gh_outbox (kind, task_id, repo, payload)
      values ('completion_comment', new.id, pr.meta->>'repo', jsonb_build_object('number', (pr.meta->>'number')::int, 'key', new.key, 'title', new.title, 'cost_usd', new.cost_usd, 'attempts', new.attempts));
    end if;
  end if;
  return null;
end $$;
create trigger tasks_gh_queue after update of state on baton.tasks for each row execute function baton.gh_queue_on_task();

create function baton.gh_queue_on_artifact() returns trigger
language plpgsql as $$
begin
  if new.kind = 'pr' and new.meta->>'branch' is not null and new.meta->>'number' is null and new.meta->>'repo' is not null then
    insert into baton.gh_outbox (kind, task_id, repo, payload)
    select 'open_pr', new.id, new.meta->>'repo', jsonb_build_object('artifact_id', new.id, 'branch', new.meta->>'branch', 'key', t.key, 'title', t.title, 'body', t.spec)
      from baton.tasks t where t.id = new.task_id;
  end if;
  return null;
end $$;
create trigger artifacts_gh_queue after insert on baton.artifacts for each row execute function baton.gh_queue_on_artifact();

-- The service marks results.
create function baton.gh_outbox_done(p_id bigint, p_result jsonb, p_error text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare o baton.gh_outbox;
begin
  update baton.gh_outbox set attempts = attempts + 1, sent_at = case when p_error is null then now() else null end, error = p_error
   where id = p_id returning * into o;
  if o.id is null then return baton.err('NOT_FOUND', 'no such outbox row'); end if;
  if p_error is null then
    if o.kind = 'promote_issue' and (p_result->>'number') is not null then
      update baton.tasks set github_issue = (p_result->>'number')::int where id = o.task_id;
    end if;
    if o.kind = 'open_pr' and (p_result->>'number') is not null then
      update baton.artifacts set meta = meta || jsonb_build_object('number', (p_result->>'number')::int, 'url', p_result->>'html_url', 'ci_status', 'pending'),
             uri = coalesce(p_result->>'html_url', uri)
       where id = (o.payload->>'artifact_id')::uuid;
    end if;
    insert into baton.events (task_id, type, payload) values (o.task_id, 'gh_' || o.kind, jsonb_build_object('result', p_result));
  else
    insert into baton.events (task_id, type, payload) values (o.task_id, 'gh_' || o.kind || '_failed', jsonb_build_object('error', p_error, 'attempts', o.attempts));
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function baton.gh_pr_event(text, int, text, text, text, boolean, text), baton.gh_check_event(text, text, text, jsonb),
  baton.gh_outbox_done(bigint, jsonb, text), baton.pr_artifacts(text, int, text) from public;
grant execute on function baton.gh_pr_event(text, int, text, text, text, boolean, text), baton.gh_check_event(text, text, text, jsonb),
  baton.gh_outbox_done(bigint, jsonb, text), baton.pr_artifacts(text, int, text) to service_role;
