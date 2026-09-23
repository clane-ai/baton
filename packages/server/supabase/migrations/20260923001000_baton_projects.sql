-- Phase 9: multi-project composition (prd.md 25.4).

create table baton.projects (
  id              uuid primary key default gen_random_uuid(),
  key             text unique not null,
  name            text not null,
  repo            text unique not null,
  marketplace_ref text not null default 'main',
  created_at      timestamptz not null default now()
);

create table baton.project_plugins (
  project_id uuid not null references baton.projects(id) on delete cascade,
  plugin     text not null,
  version    text,
  scope      text not null default 'project',
  enabled    boolean not null default true,
  primary key (project_id, plugin)
);

create table baton.project_mcp (
  project_id uuid not null references baton.projects(id) on delete cascade,
  server     text not null,
  config     jsonb not null,
  primary key (project_id, server)
);

alter table baton.projects enable row level security;
alter table baton.project_plugins enable row level security;
alter table baton.project_mcp enable row level security;
create policy service_all on baton.projects for all to service_role using (true) with check (true);
create policy service_all on baton.project_plugins for all to service_role using (true) with check (true);
create policy service_all on baton.project_mcp for all to service_role using (true) with check (true);
create policy human_read on baton.projects for select to authenticated using (true);
create policy human_read on baton.project_plugins for select to authenticated using (true);
create policy human_read on baton.project_mcp for select to authenticated using (true);

create function baton.project_profile(p_repo text) returns jsonb
language sql stable security definer set search_path = baton, pg_temp as $$
  select case when p.id is null then null else jsonb_build_object(
    'ok', true,
    'project', jsonb_build_object('id', p.id, 'key', p.key, 'name', p.name, 'repo', p.repo, 'marketplace_ref', p.marketplace_ref),
    'marketplace', 'clane-ai',
    'marketplace_repo', 'clane-ai/baton',
    'plugins', (select coalesce(jsonb_agg(jsonb_build_object('plugin', pp.plugin, 'version', pp.version, 'scope', pp.scope, 'enabled', pp.enabled) order by pp.plugin), '[]'::jsonb)
                from baton.project_plugins pp where pp.project_id = p.id),
    'mcp', (select coalesce(jsonb_agg(jsonb_build_object('server', m.server, 'config', m.config) order by m.server), '[]'::jsonb)
            from baton.project_mcp m where m.project_id = p.id))
  end
  from (select * from baton.projects where lower(repo) = lower(p_repo) or key = p_repo limit 1) p;
$$;

create function baton.project_upsert(p_actor text, p_key text, p_name text, p_repo text, p_ref text default 'main') returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare p baton.projects;
begin
  if p_key !~ '^[a-z0-9][a-z0-9-]*$' then return baton.err('PRECONDITION_FAILED', 'key must be lowercase letters, digits and dashes'); end if;
  insert into baton.projects (key, name, repo, marketplace_ref) values (p_key, p_name, p_repo, coalesce(p_ref, 'main'))
  on conflict (key) do update set name = excluded.name, repo = excluded.repo, marketplace_ref = excluded.marketplace_ref
  returning * into p;
  insert into baton.events (type, payload) values ('project_upserted', jsonb_build_object('key', p_key, 'ref', p.marketplace_ref, 'by', p_actor));
  return jsonb_build_object('ok', true, 'project', jsonb_build_object('id', p.id, 'key', p.key, 'repo', p.repo, 'marketplace_ref', p.marketplace_ref));
end $$;

create function baton.project_plugin_set(p_actor text, p_key text, p_plugin text, p_version text, p_scope text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare pid uuid;
begin
  select id into pid from baton.projects where key = p_key;
  if pid is null then return baton.err('NOT_FOUND', 'no such project'); end if;
  insert into baton.project_plugins (project_id, plugin, version, scope, enabled) values (pid, p_plugin, p_version, coalesce(p_scope, 'project'), coalesce(p_enabled, true))
  on conflict (project_id, plugin) do update set version = excluded.version, scope = excluded.scope, enabled = excluded.enabled;
  insert into baton.events (type, payload) values ('project_plugin_set', jsonb_build_object('project', p_key, 'plugin', p_plugin, 'version', p_version, 'enabled', p_enabled, 'by', p_actor));
  return jsonb_build_object('ok', true);
end $$;

create function baton.project_mcp_set(p_actor text, p_key text, p_server text, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare pid uuid;
begin
  select id into pid from baton.projects where key = p_key;
  if pid is null then return baton.err('NOT_FOUND', 'no such project'); end if;
  if p_config is null then
    delete from baton.project_mcp where project_id = pid and server = p_server;
  else
    insert into baton.project_mcp (project_id, server, config) values (pid, p_server, p_config)
    on conflict (project_id, server) do update set config = excluded.config;
  end if;
  insert into baton.events (type, payload) values ('project_mcp_set', jsonb_build_object('project', p_key, 'server', p_server, 'by', p_actor));
  return jsonb_build_object('ok', true);
end $$;

create function baton.project_drift(p_actor text, p_project uuid, p_machine text, p_actions jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
begin
  insert into baton.events (type, payload)
  values ('sync_drift', jsonb_build_object('project_id', p_project, 'machine', p_machine, 'actions', coalesce(p_actions, '[]'::jsonb),
          'count', jsonb_array_length(coalesce(p_actions, '[]'::jsonb)), 'by', p_actor));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function baton.project_profile(text), baton.project_upsert(text, text, text, text, text),
  baton.project_plugin_set(text, text, text, text, text, boolean), baton.project_mcp_set(text, text, text, jsonb), baton.project_drift(text, uuid, text, jsonb) from public;
grant execute on function baton.project_profile(text), baton.project_upsert(text, text, text, text, text),
  baton.project_plugin_set(text, text, text, text, text, boolean), baton.project_mcp_set(text, text, text, jsonb), baton.project_drift(text, uuid, text, jsonb) to service_role;
