-- Guards on baton.tasks: no dependency cycles (prd.md section 16), and every
-- state change writes an event with its actor (prd.md section 13.5).

create function baton.check_depends_on() returns trigger
language plpgsql as $$
declare missing int; cyc boolean;
begin
  if coalesce(array_length(new.depends_on, 1), 0) = 0 then
    return new;
  end if;

  if new.id = any(new.depends_on) then
    raise exception 'task % cannot depend on itself', new.id using errcode = 'check_violation';
  end if;

  select count(*) into missing
    from unnest(new.depends_on) d
   where not exists (select 1 from baton.tasks t where t.id = d);
  if missing > 0 then
    raise exception 'depends_on references % unknown task(s)', missing using errcode = 'foreign_key_violation';
  end if;

  with recursive walk(id, depth) as (
    select d, 1 from unnest(new.depends_on) d
    union all
    select dd, w.depth + 1
      from walk w
      join baton.tasks t on t.id = w.id
      cross join lateral unnest(t.depends_on) dd
     where w.depth < 100
  )
  select exists (select 1 from walk where id = new.id) into cyc;
  if cyc then
    raise exception 'depends_on would create a cycle involving task %', new.id using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger tasks_check_depends_on
  before insert or update of depends_on on baton.tasks
  for each row execute function baton.check_depends_on();

create function baton.current_actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('baton.actor', true), ''), 'system');
$$;

create function baton.log_task_state_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into baton.events (agent_id, task_id, type, payload)
    values (null, new.id, 'task_created',
            jsonb_build_object('actor', coalesce(nullif(current_setting('baton.actor', true), ''), new.created_by),
                               'state', new.state, 'key', new.key, 'role', new.role));
  elsif old.state is distinct from new.state then
    insert into baton.events (agent_id, task_id, type, payload)
    values (coalesce(new.assignee, old.assignee), new.id, 'task_state_changed',
            jsonb_build_object('actor', baton.current_actor(),
                               'from', old.state, 'to', new.state, 'attempts', new.attempts));
  end if;
  return null;
end $$;

create trigger tasks_log_state
  after insert or update on baton.tasks
  for each row execute function baton.log_task_state_change();
