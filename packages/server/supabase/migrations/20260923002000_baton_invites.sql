-- One-time invite codes: an operator mints one naming the roles and machine; `baton join <code>`
-- redeems it once, which creates the agents and hands their tokens to that machine only.
create table baton.invites (
  id            uuid primary key default gen_random_uuid(),
  code_hash     text unique not null,
  roles         text[] not null,
  machine       text,
  name_prefix   text not null,
  project_key   text,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_at   timestamptz,
  redeemed_from text,
  agent_ids     uuid[] not null default '{}'
);
alter table baton.invites enable row level security;
create policy service_all on baton.invites for all to service_role using (true) with check (true);

create function baton.invite_create(p_actor text, p_roles text[], p_machine text, p_name_prefix text, p_code_hash text,
                                    p_ttl interval default interval '24 hours', p_project_key text default null) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare inv baton.invites; r text;
begin
  if p_roles is null or cardinality(p_roles) = 0 then return baton.err('PRECONDITION_FAILED', 'at least one role'); end if;
  foreach r in array p_roles loop
    if not exists (select 1 from baton.roles where name = r) then return baton.err('PRECONDITION_FAILED', 'unknown role ' || r); end if;
    if exists (select 1 from baton.agents where name = p_name_prefix || '-' || r) then
      return baton.err('PRECONDITION_FAILED', 'agent name already exists: ' || p_name_prefix || '-' || r);
    end if;
  end loop;
  insert into baton.invites (code_hash, roles, machine, name_prefix, project_key, created_by, expires_at)
  values (p_code_hash, p_roles, p_machine, p_name_prefix, p_project_key, p_actor, now() + p_ttl) returning * into inv;
  insert into baton.events (type, payload) values ('invite_created',
    jsonb_build_object('invite_id', inv.id, 'roles', p_roles, 'machine', p_machine, 'name_prefix', p_name_prefix, 'expires_at', inv.expires_at, 'by', p_actor));
  return jsonb_build_object('ok', true, 'invite', jsonb_build_object('id', inv.id, 'roles', inv.roles, 'machine', inv.machine,
    'name_prefix', inv.name_prefix, 'expires_at', inv.expires_at));
end $$;

-- p_token_hashes: {"<role>": "<sha256 of the token the caller generated>"}; one per role on the invite.
create function baton.invite_redeem(p_code_hash text, p_machine text, p_token_hashes jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare inv baton.invites; r text; created jsonb := '[]'::jsonb; a jsonb; ids uuid[] := '{}'; mach text;
begin
  update baton.invites set redeemed_at = now(), redeemed_from = p_machine
   where code_hash = p_code_hash and redeemed_at is null and expires_at > now()
   returning * into inv;
  if inv.id is null then
    if exists (select 1 from baton.invites where code_hash = p_code_hash and redeemed_at is not null) then
      return baton.err('PRECONDITION_FAILED', 'invite already redeemed');
    elsif exists (select 1 from baton.invites where code_hash = p_code_hash) then
      return baton.err('PRECONDITION_FAILED', 'invite expired');
    end if;
    return baton.err('NOT_FOUND', 'no such invite');
  end if;
  mach := coalesce(inv.machine, p_machine, 'unknown');
  foreach r in array inv.roles loop
    if p_token_hashes ->> r is null then raise exception 'missing token hash for role %', r; end if;
    a := baton.agent_create('invite:' || inv.id, inv.name_prefix || '-' || r, r, mach, null, p_token_hashes ->> r);
    if not (a ->> 'ok')::boolean then raise exception '%', a #>> '{error,message}'; end if;
    ids := ids || ((a #>> '{agent,id}')::uuid);
    created := created || (a -> 'agent');
  end loop;
  update baton.invites set agent_ids = ids where id = inv.id;
  insert into baton.events (type, payload) values ('invite_redeemed',
    jsonb_build_object('invite_id', inv.id, 'machine', mach, 'agents', created));
  return jsonb_build_object('ok', true, 'machine', mach, 'agents', created, 'project_key', inv.project_key);
end $$;

create function baton.invite_list() returns jsonb
language sql security definer set search_path = baton, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'roles', roles, 'machine', machine, 'name_prefix', name_prefix,
           'created_by', created_by, 'created_at', created_at, 'expires_at', expires_at, 'redeemed_at', redeemed_at,
           'redeemed_from', redeemed_from) order by created_at desc), '[]'::jsonb)
  from baton.invites;
$$;
