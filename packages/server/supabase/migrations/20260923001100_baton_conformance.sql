-- Phase 8: the conformance report (prd.md 13.6). How you find out the process is being bypassed.

create table baton.conformance_reports (
  id         bigserial primary key,
  day        date unique not null,
  report     jsonb not null,
  created_at timestamptz not null default now()
);
alter table baton.conformance_reports enable row level security;
create policy service_all on baton.conformance_reports for all to service_role using (true) with check (true);
create policy human_read on baton.conformance_reports for select to authenticated using (true);

create function baton.conformance_report(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    -- file edits with no active claim: shadow work
    'shadow_edits', (select coalesce(jsonb_agg(jsonb_build_object('ts', e.ts, 'agent', (select name from baton.agents where id = e.agent_id), 'session_id', e.session_id,
                        'tool', e.payload->>'tool_name', 'path', coalesce(e.payload->'tool_input'->>'file_path', e.payload->'tool_input'->>'command'))), '[]'::jsonb)
                     from baton.events e where e.ts >= p_from and e.ts < p_to and e.type = 'tool' and e.task_id is null
                       and e.payload->>'tool_name' in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash')),
    -- writes the lease gate denied
    'no_lease_denials', (select coalesce(jsonb_agg(jsonb_build_object('ts', e.ts, 'agent', (select name from baton.agents where id = e.agent_id), 'session_id', e.session_id, 'tool', e.payload->>'tool', 'path', e.payload->>'path')), '[]'::jsonb)
                         from baton.events e where e.ts >= p_from and e.ts < p_to and e.type = 'no_lease'),
    -- scope violations
    'scope_violations', (select coalesce(jsonb_agg(jsonb_build_object('ts', e.ts, 'agent', (select name from baton.agents where id = e.agent_id), 'task', (select key from baton.tasks where id = e.task_id), 'path', e.payload->>'path', 'scope', e.payload->'scope')), '[]'::jsonb)
                         from baton.events e where e.ts >= p_from and e.ts < p_to and e.type = 'scope_violation'),
    -- tasks completed with no registered artefact
    'done_without_artifacts', (select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'title', t.title, 'role', t.role, 'updated_at', t.updated_at)), '[]'::jsonb)
                               from baton.tasks t where t.state = 'done' and t.updated_at >= p_from and t.updated_at < p_to
                                 and not exists (select 1 from baton.artifacts a where a.task_id = t.id)),
    -- heartbeat gaps longer than the lease: claims held past expiry with no heartbeat event in the last lease window
    'heartbeat_gaps', (select coalesce(jsonb_agg(jsonb_build_object('task', (select key from baton.tasks where id = c.task_id), 'agent', (select name from baton.agents where id = c.agent_id),
                          'claimed_at', c.claimed_at, 'released_at', c.released_at, 'outcome', c.outcome)), '[]'::jsonb)
                       from baton.claims c where c.claimed_at >= p_from and c.claimed_at < p_to and c.outcome = 'expired'),
    -- sessions that started but never matched a claim
    'unmatched_sessions', (select coalesce(jsonb_agg(jsonb_build_object('session_id', r.session_id, 'agent', (select name from baton.agents where id = r.agent_id), 'started_at', r.started_at, 'ended_at', r.ended_at, 'cost_usd', r.cost_usd)), '[]'::jsonb)
                           from baton.runs r where r.started_at >= p_from and r.started_at < p_to and r.task_id is null),
    -- rejected credentials
    'auth_rejections', (select count(*) from baton.events e where e.ts >= p_from and e.ts < p_to and e.type = 'auth_rejected'));
$$;

create function baton.conformance_daily() returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare d date := (now() at time zone 'UTC')::date - 1; rep jsonb;
begin
  rep := baton.conformance_report(d::timestamptz, (d + 1)::timestamptz);
  insert into baton.conformance_reports (day, report) values (d, rep) on conflict (day) do update set report = excluded.report;
  insert into baton.events (type, payload) values ('conformance_report', jsonb_build_object('day', d,
    'shadow_edits', jsonb_array_length(rep->'shadow_edits'), 'no_lease_denials', jsonb_array_length(rep->'no_lease_denials'),
    'scope_violations', jsonb_array_length(rep->'scope_violations'), 'done_without_artifacts', jsonb_array_length(rep->'done_without_artifacts'),
    'heartbeat_gaps', jsonb_array_length(rep->'heartbeat_gaps'), 'unmatched_sessions', jsonb_array_length(rep->'unmatched_sessions')));
  return rep;
end $$;

select cron.schedule('baton-conformance', '5 6 * * *', 'select baton.conformance_daily()');

revoke execute on function baton.conformance_report(timestamptz, timestamptz), baton.conformance_daily() from public;
grant execute on function baton.conformance_report(timestamptz, timestamptz), baton.conformance_daily() to service_role;
