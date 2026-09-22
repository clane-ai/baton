-- Readiness predicate and the atomic claim (prd.md sections 9.1 and 9.2).

create function baton.consumes_satisfied(p_task uuid) returns boolean
language sql stable as $$
  select not exists (
    select 1
      from baton.tasks t, jsonb_array_elements(t.consumes) c
     where t.id = p_task
       and not exists (
         select 1 from baton.artifacts a
          where a.kind = (c->>'kind')::baton.artifact_kind
            and (c->>'from_task' is null or a.task_id = (c->>'from_task')::uuid)
       )
  );
$$;

create function baton.claim_next(p_agent uuid, p_lease_seconds int default 1800)
returns baton.tasks
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r text;
begin
  select role into r from baton.agents where id = p_agent;
  if r is null then
    return null;
  end if;

  perform set_config('baton.actor', 'agent:' || p_agent::text, true);

  update baton.tasks set
    state       = 'in_progress',
    assignee    = p_agent,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    attempts    = attempts + 1,
    version     = version + 1
  where id = (
    select id from baton.tasks
     where role = r
       and state = 'ready'
       and (assignee is null or lease_until < now())
       and not exists (
             select 1 from unnest(depends_on) d
               join baton.tasks dt on dt.id = d
              where dt.state <> 'done')
       and baton.consumes_satisfied(id)
     order by priority desc, created_at
     for update skip locked
     limit 1
  )
  returning * into t;

  if t.id is not null then
    insert into baton.claims (task_id, agent_id) values (t.id, p_agent);
    update baton.agents
       set current_task = t.id, status = 'working', last_seen = now()
     where id = p_agent;
    insert into baton.events (agent_id, task_id, type, payload)
      values (p_agent, t.id, 'task_claimed',
              jsonb_build_object('lease_until', t.lease_until, 'attempts', t.attempts));
  end if;
  return t;
end $$;

-- Identity comes from the token, never from input: only the service may name an agent.
revoke execute on function baton.claim_next(uuid, int) from public;
grant  execute on function baton.claim_next(uuid, int) to service_role;
