-- Row Level Security on every table (prd.md sections 7 and 14).
-- baton_agent: the database role an authenticated agent request runs as.
-- Identity is read from a session setting (set by the service after resolving
-- the bearer token) or from a JWT claim (PostgREST path in Phase 2).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'baton_agent') then
    create role baton_agent nologin nobypassrls;
  end if;
end $$;

grant baton_agent to authenticator;

create function baton.current_agent() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('baton.agent_id', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'agent_id')::uuid
  );
$$;

create function baton.current_agent_role() returns text
language sql stable security definer set search_path = baton, pg_temp as $$
  select role from baton.agents where id = baton.current_agent();
$$;

-- Privileges. Agents read; all writes go through security definer functions.
grant usage on schema baton to baton_agent, authenticated;

grant select on baton.roles, baton.tasks, baton.claims, baton.artifacts, baton.events,
                baton.messages, baton.runs, baton.decisions to baton_agent, authenticated;
grant select (id, name, role, machine, owner_email, status, current_task, last_seen, created_at)
  on baton.agents to baton_agent, authenticated;
grant insert on baton.events, baton.decisions to baton_agent;
grant usage on all sequences in schema baton to baton_agent;

grant execute on function baton.current_agent(), baton.current_agent_role(),
                          baton.consumes_satisfied(uuid), baton.current_actor()
  to baton_agent, authenticated;

-- Enable RLS everywhere.
alter table baton.roles      enable row level security;
alter table baton.agents     enable row level security;
alter table baton.tasks      enable row level security;
alter table baton.claims     enable row level security;
alter table baton.artifacts  enable row level security;
alter table baton.events     enable row level security;
alter table baton.messages   enable row level security;
alter table baton.runs       enable row level security;
alter table baton.decisions  enable row level security;

-- service_role: the service itself. Permissive on everything.
create policy service_all on baton.roles     for all to service_role using (true) with check (true);
create policy service_all on baton.agents    for all to service_role using (true) with check (true);
create policy service_all on baton.tasks     for all to service_role using (true) with check (true);
create policy service_all on baton.claims    for all to service_role using (true) with check (true);
create policy service_all on baton.artifacts for all to service_role using (true) with check (true);
create policy service_all on baton.events    for all to service_role using (true) with check (true);
create policy service_all on baton.messages  for all to service_role using (true) with check (true);
create policy service_all on baton.runs      for all to service_role using (true) with check (true);
create policy service_all on baton.decisions for all to service_role using (true) with check (true);

-- authenticated: dashboard humans, read everything. Supervisor actions come as RPCs in Phase 6.
create policy human_read on baton.roles     for select to authenticated using (true);
create policy human_read on baton.agents    for select to authenticated using (true);
create policy human_read on baton.tasks     for select to authenticated using (true);
create policy human_read on baton.claims    for select to authenticated using (true);
create policy human_read on baton.artifacts for select to authenticated using (true);
create policy human_read on baton.events    for select to authenticated using (true);
create policy human_read on baton.messages  for select to authenticated using (true);
create policy human_read on baton.runs      for select to authenticated using (true);
create policy human_read on baton.decisions for select to authenticated using (true);

-- baton_agent: its own slice of the world.
create policy agent_read on baton.roles for select to baton_agent using (true);

create policy agent_read on baton.agents for select to baton_agent
  using (id = baton.current_agent());

create policy agent_read on baton.tasks for select to baton_agent
  using (role = baton.current_agent_role() or assignee = baton.current_agent());

create policy agent_read on baton.claims for select to baton_agent
  using (agent_id = baton.current_agent());

create policy agent_read on baton.artifacts for select to baton_agent
  using (
    exists (select 1 from baton.tasks t
             where t.id = artifacts.task_id
               and (t.assignee = baton.current_agent() or t.role = baton.current_agent_role()))
    or exists (select 1 from baton.tasks t, jsonb_array_elements(t.consumes) c
                where t.role = baton.current_agent_role()
                  and (c->>'kind') = artifacts.kind::text)
  );

create policy agent_read on baton.events for select to baton_agent
  using (agent_id = baton.current_agent());
create policy agent_write on baton.events for insert to baton_agent
  with check (agent_id = baton.current_agent());

create policy agent_read on baton.messages for select to baton_agent
  using (to_agent = baton.current_agent()
      or from_agent = baton.current_agent()
      or to_role = baton.current_agent_role());

create policy agent_read on baton.runs for select to baton_agent
  using (agent_id = baton.current_agent());

create policy agent_read  on baton.decisions for select to baton_agent using (true);
create policy agent_write on baton.decisions for insert to baton_agent with check (true);
