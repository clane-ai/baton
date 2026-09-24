-- Withdrawing an invite. Until now a code could only expire or be redeemed, so a code minted by
-- mistake, or sent to the wrong person, could not be taken back: whoever held it could still turn it
-- into a set of agent tokens on their machine. This adds revocation.
--
-- Withdrawing a code and disabling a fleet are deliberately different actions. Revoking an invite
-- stops it being redeemed; it never touches agents already created from it, which are revoked one by
-- one through baton.agent_revoke. Collapsing the two would mean a mistyped invite silently stopping
-- machines that are working.

alter table baton.invites add column if not exists revoked_at timestamptz;
alter table baton.invites add column if not exists revoked_by text;

-- Withdraw an unredeemed code. Idempotent: revoking twice is not an error, because the caller's
-- intent (this code must not work) is already satisfied.
create or replace function baton.invite_revoke(p_actor text, p_invite uuid) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare inv baton.invites;
begin
  select * into inv from baton.invites where id = p_invite;
  if inv.id is null then return baton.err('NOT_FOUND', 'no such invite'); end if;

  -- A redeemed code has already become agents. Refusing here rather than revoking quietly keeps the
  -- two actions distinct: the agents it created are listed so the caller can revoke them by hand.
  if inv.redeemed_at is not null then
    return baton.err('PRECONDITION_FAILED',
      'invite already redeemed; revoke the agents it created individually');
  end if;

  if inv.revoked_at is not null then
    return jsonb_build_object('ok', true, 'already_revoked', true,
      'invite', jsonb_build_object('id', inv.id, 'revoked_at', inv.revoked_at, 'revoked_by', inv.revoked_by));
  end if;

  update baton.invites set revoked_at = now(), revoked_by = p_actor where id = p_invite returning * into inv;
  insert into baton.events (type, payload) values ('invite_revoked',
    jsonb_build_object('invite_id', inv.id, 'roles', inv.roles, 'machine', inv.machine,
                       'name_prefix', inv.name_prefix, 'by', p_actor));
  return jsonb_build_object('ok', true, 'invite', jsonb_build_object('id', inv.id, 'roles', inv.roles,
    'machine', inv.machine, 'name_prefix', inv.name_prefix, 'revoked_at', inv.revoked_at, 'revoked_by', inv.revoked_by));
end $$;

-- Redemption now refuses a revoked code, with its own message rather than the expiry one, so the
-- person holding it is told what actually happened.
create or replace function baton.invite_redeem(p_code_hash text, p_machine text, p_token_hashes jsonb) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare inv baton.invites; r text; created jsonb := '[]'::jsonb; a jsonb; ids uuid[] := '{}'; mach text;
begin
  update baton.invites set redeemed_at = now(), redeemed_from = p_machine
   where code_hash = p_code_hash and redeemed_at is null and revoked_at is null and expires_at > now()
   returning * into inv;
  if inv.id is null then
    if exists (select 1 from baton.invites where code_hash = p_code_hash and redeemed_at is not null) then
      return baton.err('PRECONDITION_FAILED', 'invite already redeemed');
    elsif exists (select 1 from baton.invites where code_hash = p_code_hash and revoked_at is not null) then
      return baton.err('PRECONDITION_FAILED', 'invite revoked');
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

-- The listing carries the state so a screen can show it without re-deriving the rules, and so the
-- four states are named in one place: redeemed, revoked, expired, pending.
create or replace function baton.invite_list() returns jsonb
language sql security definer set search_path = baton, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'roles', roles, 'machine', machine, 'name_prefix', name_prefix,
           'created_by', created_by, 'created_at', created_at, 'expires_at', expires_at, 'redeemed_at', redeemed_at,
           'redeemed_from', redeemed_from, 'revoked_at', revoked_at, 'revoked_by', revoked_by,
           'state', case when redeemed_at is not null then 'redeemed'
                         when revoked_at is not null then 'revoked'
                         when expires_at <= now() then 'expired'
                         else 'pending' end,
           'agent_ids', agent_ids) order by created_at desc), '[]'::jsonb)
  from baton.invites;
$$;

revoke execute on function baton.invite_revoke(text, uuid) from public;
grant execute on function baton.invite_revoke(text, uuid) to service_role;
