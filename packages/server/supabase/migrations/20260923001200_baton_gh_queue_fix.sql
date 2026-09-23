-- The plpgsql variable and the subquery alias were both called pr, which makes pr.meta ambiguous.
create or replace function baton.gh_queue_on_task() returns trigger
language plpgsql as $$
declare prow baton.artifacts; repo text;
begin
  -- Promotion rule (12.4): a task that needs a human decision outlives the agent run.
  if new.state = 'needs_human' and old.state is distinct from 'needs_human' and new.github_issue is null then
    select * into prow from baton.artifacts where task_id = new.id and kind = 'pr' order by created_at desc limit 1;
    repo := coalesce(prow.meta->>'repo', nullif(current_setting('baton.default_repo', true), ''));
    if repo is not null then
      insert into baton.gh_outbox (kind, task_id, repo, payload)
      values ('promote_issue', new.id, repo, jsonb_build_object('key', new.key, 'title', new.title));
    end if;
  end if;
  -- One completion summary on the PR when the gate passes.
  if new.state = 'done' and old.state is distinct from 'done' then
    select * into prow from baton.artifacts where task_id = new.id and kind = 'pr' and meta->>'number' is not null order by created_at desc limit 1;
    if prow.id is not null then
      insert into baton.gh_outbox (kind, task_id, repo, payload)
      values ('completion_comment', new.id, prow.meta->>'repo', jsonb_build_object('number', (prow.meta->>'number')::int, 'key', new.key, 'title', new.title, 'cost_usd', new.cost_usd, 'attempts', new.attempts));
    end if;
  end if;
  return null;
end $$;
