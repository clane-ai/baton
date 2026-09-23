-- A CASE of unknown literals resolves to text, which cannot be assigned to the enum column.
create or replace function baton.session_start(p_agent uuid, p_session text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare t baton.tasks; r baton.runs;
begin
  t := baton.live_task(p_agent);
  insert into baton.runs (agent_id, session_id, task_id)
  values (p_agent, p_session, t.id)
  on conflict (session_id) do update set task_id = coalesce(baton.runs.task_id, excluded.task_id)
  returning * into r;
  update baton.agents
     set last_seen = now(),
         status = case when t.id is null then 'idle'::baton.agent_status else 'working'::baton.agent_status end
   where id = p_agent;
  insert into baton.events (agent_id, task_id, session_id, type, payload)
  values (p_agent, t.id, p_session, 'session_start', coalesce(p_payload, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'run_id', r.id, 'task_id', t.id);
end $$;
