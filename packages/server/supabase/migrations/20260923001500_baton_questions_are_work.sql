-- An unanswered question addressed to a role is work for that role: the supervisor spawns
-- an agent to answer it. Questions already delivered get a retry window before they count again.
create or replace function baton.work_available(p_role text) returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'role', p_role,
    'ready', (select count(*)::int from baton.tasks t
               where t.role = p_role and t.state = 'ready'
                 and not exists (select 1 from unnest(t.depends_on) d join baton.tasks dt on dt.id = d where dt.state <> 'done')
                 and baton.consumes_satisfied(t.id)),
    'questions', (select count(*)::int from baton.messages m
                   where m.kind = 'question' and m.answered_at is null
                     and (m.to_role = p_role or m.to_agent in (select id from baton.agents where role = p_role and revoked_at is null))
                     and (m.delivered_at is null or m.delivered_at < now() - interval '10 minutes')),
    'max_concurrent', (select max_concurrent from baton.roles where name = p_role),
    'working', (select count(*)::int from baton.agents where role = p_role and status = 'working'));
$$;
