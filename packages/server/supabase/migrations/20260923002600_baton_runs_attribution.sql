-- A run that reports usage without naming its task (the Clane runtime posts once, after the task
-- is already submitted) is attributed to the last task the agent claimed during that session, so
-- credits and dollars land on the task and on the workflow run.
create or replace function baton.runs_usage(p_agent uuid, p_session text, p_task uuid, p_tokens_in bigint, p_tokens_out bigint,
                                            p_cost numeric, p_model text default null, p_exit_reason text default null,
                                            p_credits numeric default 0) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare r baton.runs; task uuid := p_task; started timestamptz;
begin
  if task is null then
    select min(ts) into started from baton.events where session_id = p_session and agent_id = p_agent;
    select c.task_id into task from baton.claims c
     where c.agent_id = p_agent and (started is null or c.claimed_at >= started - interval '1 minute')
     order by c.claimed_at desc limit 1;
  end if;
  insert into baton.runs (agent_id, session_id, task_id, tokens_in, tokens_out, cost_usd, credits, exit_reason, ended_at)
  values (p_agent, p_session, task, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost, 0), coalesce(p_credits, 0), p_exit_reason,
          case when p_exit_reason is null then null else now() end)
  on conflict (session_id) do update set
    task_id     = coalesce(baton.runs.task_id, excluded.task_id),
    tokens_in   = greatest(baton.runs.tokens_in, excluded.tokens_in),
    tokens_out  = greatest(baton.runs.tokens_out, excluded.tokens_out),
    cost_usd    = case when excluded.exit_reason is not null then excluded.cost_usd else greatest(baton.runs.cost_usd, excluded.cost_usd) end,
    credits     = case when excluded.exit_reason is not null then excluded.credits else greatest(baton.runs.credits, excluded.credits) end,
    exit_reason = coalesce(excluded.exit_reason, baton.runs.exit_reason),
    ended_at    = coalesce(excluded.ended_at, baton.runs.ended_at)
  returning * into r;
  return jsonb_build_object('ok', true, 'run_id', r.id, 'task_id', r.task_id, 'cost_usd', r.cost_usd, 'credits', r.credits);
end $$;

-- Backfill today's unattributed Clane runs the same way, and push their credits onto the tasks.
with fixed as (
  update baton.runs r set task_id = (
    select c.task_id from baton.claims c
     where c.agent_id = r.agent_id and c.claimed_at >= r.started_at - interval '1 minute' and c.claimed_at <= coalesce(r.ended_at, now())
     order by c.claimed_at desc limit 1)
  where r.task_id is null and r.session_id like 'clane-%' and r.started_at > now() - interval '1 day'
  returning r.task_id, r.credits, r.cost_usd)
update baton.tasks t set cost_credits = t.cost_credits + f.credits, cost_usd = t.cost_usd + f.cost_usd
  from fixed f where f.task_id = t.id and (f.credits > 0 or f.cost_usd > 0);
