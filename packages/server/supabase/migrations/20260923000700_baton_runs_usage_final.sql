-- Interim usage posts are estimates; the final post (with exit_reason) carries the real
-- cost from Claude Code's result message and must win even when it is lower.
create or replace function baton.runs_usage(p_agent uuid, p_session text, p_task uuid, p_tokens_in bigint, p_tokens_out bigint,
                                            p_cost numeric, p_model text default null, p_exit_reason text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare r baton.runs;
begin
  insert into baton.runs (agent_id, session_id, task_id, tokens_in, tokens_out, cost_usd, exit_reason, ended_at)
  values (p_agent, p_session, p_task, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost, 0), p_exit_reason,
          case when p_exit_reason is null then null else now() end)
  on conflict (session_id) do update set
    task_id     = coalesce(baton.runs.task_id, excluded.task_id),
    tokens_in   = greatest(baton.runs.tokens_in, excluded.tokens_in),
    tokens_out  = greatest(baton.runs.tokens_out, excluded.tokens_out),
    cost_usd    = case when excluded.exit_reason is not null then excluded.cost_usd else greatest(baton.runs.cost_usd, excluded.cost_usd) end,
    exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason),
    ended_at    = coalesce(excluded.ended_at, baton.runs.ended_at)
  returning * into r;
  return jsonb_build_object('ok', true, 'run_id', r.id, 'cost_usd', r.cost_usd);
end $$;

-- The task cost trigger only adds deltas, so a downward correction must also flow through.
-- (accumulate_run_cost already computes new - old, which is negative here; nothing to change.)
