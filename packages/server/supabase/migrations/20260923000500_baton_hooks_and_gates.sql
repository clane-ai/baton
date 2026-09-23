-- Phase 4 hook face (prd.md section 11) and the enforcement gates of section 13.4
-- that change agent behaviour most: no lease no write, scope, stop, exit.

-- Live task for an agent: assigned, in progress, lease not expired.
create function baton.live_task(p_agent uuid) returns baton.tasks
language sql stable as $$
  select t from baton.tasks t
   where t.assignee = p_agent and t.state = 'in_progress' and t.lease_until > now()
   limit 1;
$$;

create function baton.session_start(p_agent uuid, p_session text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r baton.runs;
begin
  t := baton.live_task(p_agent);
  insert into baton.runs (agent_id, session_id, task_id)
  values (p_agent, p_session, t.id)
  on conflict (session_id) do update set task_id = coalesce(baton.runs.task_id, excluded.task_id)
  returning * into r;
  update baton.agents set last_seen = now(), status = case when t.id is null then 'idle' else 'working' end where id = p_agent;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, t.id, p_session, 'session_start', coalesce(p_payload, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'run_id', r.id, 'task_id', t.id);
end $$;

-- Generic hook event. Links the run to the task the agent holds now and back-fills
-- earlier events of the session that had no task yet (claim happens after start).
create function baton.hook_event(p_agent uuid, p_session text, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; run_task uuid;
begin
  t := baton.live_task(p_agent);
  insert into baton.runs (agent_id, session_id, task_id) values (p_agent, p_session, t.id)
  on conflict (session_id) do update set task_id = coalesce(baton.runs.task_id, excluded.task_id)
  returning task_id into run_task;
  if run_task is not null then
    update baton.events set task_id = run_task where session_id = p_session and task_id is null;
  end if;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, coalesce(t.id, run_task), p_session, p_type, coalesce(p_payload, '{}'::jsonb));
  update baton.agents set last_seen = now() where id = p_agent;
  return jsonb_build_object('ok', true, 'task_id', coalesce(t.id, run_task));
end $$;

-- Exit gate (13.4 d): unconditional. Closes the run and releases any lease still held.
create function baton.session_end(p_agent uuid, p_session text, p_reason text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; released uuid;
begin
  insert into baton.runs (agent_id, session_id, ended_at, exit_reason) values (p_agent, p_session, now(), p_reason)
  on conflict (session_id) do update set ended_at = now(), exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason);
  t := baton.live_task(p_agent);
  if t.id is not null then
    perform baton.task_release(p_agent, t.id, 'session ended: ' || coalesce(p_reason, 'unknown'));
    released := t.id;
  end if;
  update baton.agents set last_seen = now(), status = 'idle', current_task = null where id = p_agent;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, coalesce(t.id, (select task_id from baton.runs where session_id = p_session)), p_session, 'session_end',
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('reason', p_reason, 'released_task', released));
  return jsonb_build_object('ok', true, 'released_task', released);
end $$;

-- Context injection (section 11): undelivered messages plus a one-line task state.
create function baton.context_for(p_agent uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; msgs jsonb; line text;
begin
  msgs := baton.inbox(p_agent) -> 'messages';
  t := baton.live_task(p_agent);
  if t.id is not null then
    line := 'You hold task ' || t.key || ' (' || t.title || '), lease until ' || to_char(t.lease_until at time zone 'UTC', 'HH24:MI:SS') || ' UTC, attempt ' || t.attempts || ' of ' || t.max_attempts || '. Resume it.';
  else
    line := 'You hold no task. Call whoami, then task_next.';
  end if;
  return jsonb_build_object('ok', true, 'messages', msgs, 'task_line', line,
           'task', case when t.id is null then null else jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'lease_until', t.lease_until) end);
end $$;

-- Glob (** * ?) to an anchored regex. Paths are compared with forward slashes.
create function baton.glob_to_regex(p_glob text) returns text
language plpgsql immutable as $$
declare g text := p_glob; res text := ''; i int := 1; c text;
begin
  while i <= length(g) loop
    c := substr(g, i, 1);
    if substr(g, i, 3) = '**/' then res := res || '(.*/)?'; i := i + 3;
    elsif substr(g, i, 2) = '**' then res := res || '.*'; i := i + 2;
    elsif c = '*' then res := res || '[^/]*'; i := i + 1;
    elsif c = '?' then res := res || '[^/]'; i := i + 1;
    elsif c ~ '[.+^$(){}|\[\]\\]' then res := res || '\' || c; i := i + 1;
    else res := res || c; i := i + 1;
    end if;
  end loop;
  return '^' || res || '$';
end $$;

create function baton.path_in_scope(p_path text, p_scope text[]) returns boolean
language sql immutable as $$
  select coalesce(array_length(p_scope, 1), 0) = 0
      or exists (select 1 from unnest(p_scope) g where replace(p_path, '\', '/') ~ baton.glob_to_regex(g));
$$;

-- Gate a (no lease, no write) and gate b (scope), one call.
create function baton.gate_pretool(p_agent uuid, p_session text, p_tool text, p_path text, p_cwd text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; rel text;
begin
  t := baton.live_task(p_agent);
  if t.id is null then
    insert into baton.events (agent_id, task_id, session_id, type, payload)
    values (p_agent, null, p_session, 'no_lease', jsonb_build_object('tool', p_tool, 'path', p_path));
    return jsonb_build_object('allow', false, 'reason', 'No active Baton lease. Call task_next before editing anything.');
  end if;
  if p_path is not null and coalesce(array_length(t.scope, 1), 0) > 0 then
    rel := replace(p_path, '\', '/');
    if p_cwd is not null and position(replace(p_cwd, '\', '/') || '/' in rel) = 1 then
      rel := substr(rel, length(replace(p_cwd, '\', '/')) + 2);
    end if;
    if not baton.path_in_scope(rel, t.scope) then
      insert into baton.events (agent_id, task_id, session_id, type, payload)
      values (p_agent, t.id, p_session, 'scope_violation', jsonb_build_object('tool', p_tool, 'path', rel, 'scope', to_jsonb(t.scope)));
      return jsonb_build_object('allow', false, 'task_key', t.key,
               'reason', 'Path ' || rel || ' is outside the scope of ' || t.key || ' (' || array_to_string(t.scope, ', ') || '). Stay inside your task scope or create a task for the owning role.');
    end if;
  end if;
  return jsonb_build_object('allow', true, 'task_key', t.key);
end $$;

-- Gate c (stop): an agent holding a live lease may not stop until it submits, asks or releases.
create function baton.gate_stop(p_agent uuid, p_session text) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; n int;
begin
  t := baton.live_task(p_agent);
  if t.id is null then return jsonb_build_object('block', false); end if;
  select count(*) into n from baton.events where session_id = p_session and type = 'stop_blocked';
  if n >= 3 then
    insert into baton.events (agent_id, task_id, session_id, type, payload)
    values (p_agent, t.id, p_session, 'stop_gate_exhausted', jsonb_build_object('blocks', n));
    return jsonb_build_object('block', false, 'exhausted', true);
  end if;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, t.id, p_session, 'stop_blocked', jsonb_build_object('attempt', n + 1));
  return jsonb_build_object('block', true, 'task_key', t.key,
           'reason', 'You have an open task ' || t.key || '. Submit it with task_submit, ask with task_ask, or release it with task_release before stopping.');
end $$;

revoke execute on function
  baton.session_start(uuid, text, jsonb), baton.hook_event(uuid, text, text, jsonb), baton.session_end(uuid, text, text, jsonb),
  baton.context_for(uuid), baton.gate_pretool(uuid, text, text, text, text), baton.gate_stop(uuid, text), baton.live_task(uuid)
from public;
grant execute on function
  baton.session_start(uuid, text, jsonb), baton.hook_event(uuid, text, text, jsonb), baton.session_end(uuid, text, text, jsonb),
  baton.context_for(uuid), baton.gate_pretool(uuid, text, text, text, text), baton.gate_stop(uuid, text), baton.live_task(uuid)
to service_role;
grant execute on function baton.glob_to_regex(text), baton.path_in_scope(text, text[]) to baton_agent, authenticated, service_role;
