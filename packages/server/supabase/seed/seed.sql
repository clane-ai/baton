-- Baton demo seed. Idempotent: safe to run repeatedly.
-- Dev agent token for analyst-01 is "baton_dev_analyst_01" (sha256 stored).

insert into baton.roles (name, description, definition_path, default_model) values
  ('analyst',      'Turns a user story into a task_spec.',                     '.claude/agents/analyst.md',      'sonnet'),
  ('frontend-dev', 'Builds UI from a design_spec and api_contract into a PR.', '.claude/agents/frontend-dev.md', 'sonnet')
on conflict (name) do nothing;

insert into baton.agents (id, name, role, machine, token_hash) values
  ('22222222-2222-2222-2222-000000000001', 'analyst-01', 'analyst', 'dev-machine',
   encode(sha256(convert_to('baton_dev_analyst_01', 'UTF8')), 'hex'))
on conflict (name) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, produces, created_by) values
  ('11111111-1111-1111-1111-000000000001',
   'Write the task spec for the login page',
   'Read the user story for the login page and write a complete task_spec covering fields, validation, error states and the API the page needs.',
   'Given the user story, when the analyst finishes, then a task_spec artefact exists that lists every field, validation rule and API call.',
   'analyst', 'ready', 200, '[{"kind":"task_spec"}]', 'seed')
on conflict (id) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, depends_on, consumes, produces, created_by) values
  ('11111111-1111-1111-1111-000000000002',
   'Build the login page',
   'Implement the login page in the Next.js app according to the task_spec.',
   'Given the task_spec, when the page is built, then a PR exists and the build artefact is registered.',
   'frontend-dev', 'draft', 150,
   array['11111111-1111-1111-1111-000000000001']::uuid[],
   '[{"kind":"task_spec","from_task":"11111111-1111-1111-1111-000000000001"}]',
   '[{"kind":"pr"},{"kind":"build"}]', 'seed')
on conflict (id) do nothing;

insert into baton.tasks (id, title, spec, acceptance, role, state, priority, consumes, produces, created_by) values
  ('11111111-1111-1111-1111-000000000003',
   'Build the dashboard shell',
   'Implement the dashboard layout from the design_spec.',
   'Given the design_spec, when the shell is built, then a PR exists and the build artefact is registered.',
   'frontend-dev', 'draft', 100,
   '[{"kind":"design_spec","from_task":null}]',
   '[{"kind":"pr"},{"kind":"build"}]', 'seed')
on conflict (id) do nothing;
