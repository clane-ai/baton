-- How long a task has been in its current state.
--
-- A board that surfaces stalled work needs to sort by how long something has been waiting, and neither
-- existing column says that. `created_at` is when the task was made, which for a task that has moved
-- through four states is the wrong number. `updated_at` is worse than wrong: a BEFORE trigger touches
-- it on every update, and a working agent heartbeats its lease every few minutes, so the tasks that
-- have been in progress longest look like the ones that were touched most recently.
--
-- The honest measure is already recorded: every state change writes a `task_state_changed` event. But
-- a board cannot sort on a correlated subquery over the event table at volume, so this denormalises it
-- into a column maintained by the same trigger path that already exists.

alter table baton.tasks add column if not exists state_since timestamptz not null default now();

-- Backfill from the events that already hold the truth: the last state change, else creation.
update baton.tasks t
   set state_since = coalesce(
     (select max(e.ts) from baton.events e where e.task_id = t.id and e.type = 'task_state_changed'),
     t.created_at);

-- Maintained where updated_at already is, so there is one trigger touching the row before a write
-- rather than two. Only a state change moves it; a heartbeat, a progress note or a budget change
-- deliberately does not.
create or replace function baton.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.state is distinct from new.state then
    new.state_since := now();
  end if;
  return new;
end $$;

comment on column baton.tasks.state_since is
  'When the task entered its current state. Unlike updated_at, a heartbeat does not move it, so "oldest waiting" means what it says.';

-- Expose it, additively: every existing field keeps its name and position.
create or replace function baton.task_json(t baton.tasks) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.key, 'title', t.title, 'spec', t.spec, 'acceptance', t.acceptance,
    'role', t.role, 'state', t.state, 'priority', t.priority, 'depends_on', to_jsonb(t.depends_on),
    'consumes', t.consumes, 'produces', t.produces, 'scope', to_jsonb(t.scope),
    'assignee', t.assignee, 'lease_until', t.lease_until, 'attempts', t.attempts,
    'max_attempts', t.max_attempts, 'budget_usd', t.budget_usd, 'cost_usd', t.cost_usd,
    'parent_task', t.parent_task, 'github_issue', t.github_issue, 'version', t.version,
    'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'state_since', t.state_since);
$$;

-- The board asks for one state and the oldest rows in it, so the index carries both.
create index if not exists tasks_state_since_idx on baton.tasks (state, state_since);
create index if not exists tasks_created_at_idx on baton.tasks (created_at);
