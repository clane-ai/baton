-- Session-scoped leases (review finding E, 23 Sep 2026).
-- Two Claude Code sessions of the same agent could overlap (the daemon spawned a second one while the
-- first was still starting); when the idle one ended, session_end released the live task, which belonged
-- to the sibling. The claim now records the daemon's session id (header X-Baton-Session on the MCP face),
-- and session_end only releases a task whose open claim was made in that session. A session_end without
-- a session id keeps the old behaviour (release whatever the agent holds), for hooks and older daemons.

alter table baton.claims add column if not exists session_id text;
create index if not exists claims_session_idx on baton.claims (session_id) where session_id is not null;

drop function if exists baton.claim_next(uuid, integer);
create function baton.claim_next(p_agent uuid, p_lease_seconds integer default 1800, p_session text default null) returns baton.tasks
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r text; a_name text; a_machine text;
begin
  select role, name, machine into r, a_name, a_machine from baton.agents where id = p_agent;
  if r is null then return null; end if;
  perform set_config('baton.actor', 'agent:' || p_agent::text, true);
  update baton.tasks set
    state = 'in_progress', assignee = p_agent, lease_until = now() + make_interval(secs => p_lease_seconds),
    attempts = attempts + case when (
        select c.outcome = 'released' and c.reason like 'blocked:%' from baton.claims c
         where c.task_id = baton.tasks.id order by c.claimed_at desc limit 1)
      then 0 else 1 end,
    version = version + 1
  where id = (
    select id from baton.tasks
     where role = r and state = 'ready'
       and (assignee is null or lease_until < now())
       and (affinity is null or affinity = a_name or affinity = a_machine)
       and not exists (select 1 from unnest(depends_on) d join baton.tasks dt on dt.id = d where dt.state <> 'done')
       and baton.consumes_satisfied(id)
     order by priority desc, created_at
     for update skip locked
     limit 1)
  returning * into t;
  if t.id is not null then
    insert into baton.claims (task_id, agent_id, session_id) values (t.id, p_agent, p_session);
    update baton.agents set current_task = t.id, status = 'working', last_seen = now() where id = p_agent;
    insert into baton.events (agent_id, task_id, type, payload)
      values (p_agent, t.id, 'task_claimed', jsonb_build_object('lease_until', t.lease_until, 'attempts', t.attempts, 'session', p_session));
  end if;
  return t;
end $$;
revoke execute on function baton.claim_next(uuid, integer, text) from public;
grant  execute on function baton.claim_next(uuid, integer, text) to service_role;

drop function if exists baton.session_end(uuid, text, text, jsonb);
create function baton.session_end(p_agent uuid, p_session text, p_reason text, p_payload jsonb default '{}'::jsonb, p_claim_session text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; released uuid; owner text;
begin
  insert into baton.runs (agent_id, session_id, ended_at, exit_reason) values (p_agent, p_session, now(), p_reason)
  on conflict (session_id) do update set ended_at = now(), exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason);
  t := baton.live_task(p_agent);
  if t.id is not null then
    select c.session_id into owner from baton.claims c where c.task_id = t.id and c.released_at is null order by c.claimed_at desc limit 1;
    if p_claim_session is null or owner is null or owner = p_claim_session then
      perform baton.task_release(p_agent, t.id, 'session ended: ' || coalesce(p_reason, 'unknown'));
      released := t.id;
    else
      -- the task belongs to another live session of this agent; leave it alone
      insert into baton.events (agent_id, task_id, session_id, type, payload)
      values (p_agent, t.id, p_session, 'session_end_skipped_release', jsonb_build_object('held_by_session', owner, 'ending_session', p_claim_session));
      t := null;
    end if;
  end if;
  if released is not null or t.id is null then
    update baton.agents set last_seen = now(), status = case when released is not null then 'idle' else status end,
           current_task = case when released is not null then null else current_task end where id = p_agent;
  end if;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, coalesce(released, (select task_id from baton.runs where session_id = p_session)), p_session, 'session_end',
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('reason', p_reason, 'released_task', released, 'claim_session', p_claim_session));
  return jsonb_build_object('ok', true, 'released_task', released);
end $$;
revoke execute on function baton.session_end(uuid, text, text, jsonb, text) from public;
grant  execute on function baton.session_end(uuid, text, text, jsonb, text) to service_role;
