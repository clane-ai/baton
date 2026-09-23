-- Artefacts and the completion gate (prd.md sections 10.3 and 13.5).
-- Schemas live in the database so the gate is enforced where the agent has no reach.

create table baton.artifact_schemas (
  kind       baton.artifact_kind not null,
  version    text not null default 'v1',
  schema     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (kind, version)
);
alter table baton.artifact_schemas enable row level security;
create policy service_all on baton.artifact_schemas for all to service_role using (true) with check (true);
create policy human_read  on baton.artifact_schemas for select to authenticated using (true);
create policy agent_read  on baton.artifact_schemas for select to baton_agent using (true);
grant select on baton.artifact_schemas to baton_agent, authenticated;

create function baton.artifact_json(a baton.artifacts) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'task_id', a.task_id, 'task_key', (select key from baton.tasks where id = a.task_id),
    'kind', a.kind, 'uri', a.uri, 'sha256', a.sha256, 'schema_version', a.schema_version,
    'meta', a.meta, 'content', a.content, 'created_by', a.created_by, 'created_at', a.created_at);
$$;

-- null when valid (or no schema registered), else a human-readable list of problems.
create function baton.validate_artifact(p_kind baton.artifact_kind, p_version text, p_content jsonb, p_meta jsonb) returns text
language plpgsql stable as $$
declare s jsonb; inst jsonb; errs text[];
begin
  select schema into s from baton.artifact_schemas where kind = p_kind and version = coalesce(p_version, 'v1');
  if s is null then return null; end if;
  inst := coalesce(p_content, p_meta, '{}'::jsonb);
  errs := extensions.jsonschema_validation_errors(s, inst);
  if coalesce(array_length(errs, 1), 0) = 0 then return null; end if;
  return p_kind::text || ' ' || coalesce(p_version, 'v1') || ': ' || array_to_string(errs, '; ');
end $$;

create function baton.artifact_put(p_agent uuid, p_task uuid, p_kind text, p_uri text, p_sha256 text default null,
                                   p_schema_version text default 'v1', p_meta jsonb default '{}'::jsonb,
                                   p_content jsonb default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; k baton.artifact_kind; v text; a uuid;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;
  begin
    k := p_kind::baton.artifact_kind;
  exception when invalid_text_representation then
    return baton.err('INVALID_ARTIFACT', 'unknown artefact kind ' || coalesce(p_kind, '(none)'));
  end;
  if length(btrim(coalesce(p_uri, ''))) = 0 then
    return baton.err('INVALID_ARTIFACT', 'uri is required');
  end if;
  v := baton.validate_artifact(k, p_schema_version, p_content, p_meta);
  if v is not null then
    insert into baton.events (agent_id, task_id, type, payload)
    values (p_agent, p_task, 'artifact_rejected', jsonb_build_object('kind', k, 'schema_version', p_schema_version, 'errors', v));
    return baton.err('INVALID_ARTIFACT', v);
  end if;
  insert into baton.artifacts (task_id, kind, uri, sha256, schema_version, meta, content, created_by)
  values (p_task, k, p_uri, p_sha256, coalesce(p_schema_version, 'v1'), coalesce(p_meta, '{}'::jsonb), p_content, p_agent)
  returning id into a;
  insert into baton.events (agent_id, task_id, type, payload)
  values (p_agent, p_task, 'artifact_registered', jsonb_build_object('artifact_id', a, 'kind', k, 'uri', p_uri));
  return jsonb_build_object('ok', true, 'artifact_id', a, 'uri', p_uri);
end $$;

-- The gate. Runs on a task in review; decides done / still waiting for CI / failed.
create function baton.run_gate(p_task uuid) returns jsonb
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
  for a in select distinct on (kind) * from baton.artifacts where task_id = t.id order by kind, created_at desc loop
    v := baton.validate_artifact(a.kind, a.schema_version, a.content, a.meta);
    if v is not null then problems := problems || v; end if;
  end loop;

  -- 3. a pr artefact needs green CI
  if exists (select 1 from jsonb_array_elements(t.produces) p where p->>'kind' = 'pr') then
    select meta->>'ci_status' into pr_status from baton.artifacts
     where task_id = t.id and kind = 'pr' order by created_at desc limit 1;
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

create function baton.task_submit(p_agent uuid, p_task uuid, p_artifacts jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare e text; x jsonb; r jsonb;
begin
  e := baton.check_lease(p_agent, p_task);
  if e is not null then return baton.lease_error(e); end if;

  for x in select * from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) loop
    r := baton.artifact_put(p_agent, p_task, x->>'kind', x->>'uri', x->>'sha256',
                            coalesce(x->>'schema_version', 'v1'), coalesce(x->'meta', '{}'::jsonb), x->'content');
    if not (r->>'ok')::boolean then
      return r;   -- task stays in_progress so the agent can fix the artefact
    end if;
  end loop;

  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set state = 'review', lease_until = null, version = version + 1 where id = p_task;
  update baton.claims set released_at = now(), outcome = 'submitted'
   where task_id = p_task and agent_id = p_agent and released_at is null;
  update baton.agents set current_task = null, status = 'idle', last_seen = now() where id = p_agent;
  insert into baton.events (agent_id, task_id, type, payload) values (p_agent, p_task, 'task_submitted', '{}'::jsonb);

  return baton.run_gate(p_task);
end $$;

revoke execute on function
  baton.artifact_put(uuid, uuid, text, text, text, text, jsonb, jsonb), baton.run_gate(uuid),
  baton.task_submit(uuid, uuid, jsonb)
from public;
grant execute on function
  baton.artifact_put(uuid, uuid, text, text, text, text, jsonb, jsonb), baton.run_gate(uuid),
  baton.task_submit(uuid, uuid, jsonb)
to service_role;
grant execute on function baton.artifact_json(baton.artifacts), baton.validate_artifact(baton.artifact_kind, text, jsonb, jsonb)
to baton_agent, authenticated, service_role;
