-- Dev-only: let the RLS-bound baton_test role drive the Phase 1 tests.
grant usage on schema baton to baton_test;
grant all on all tables    in schema baton to baton_test;
grant all on all sequences in schema baton to baton_test;
grant execute on all functions in schema baton to baton_test;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'baton_agent') then
    execute 'grant baton_agent to baton_test';
  end if;
end $$;

-- Permissive policies so baton_test still sees everything once RLS is enabled (Task 6).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'baton' loop
    execute format('drop policy if exists dev_test_all on baton.%I', t);
    execute format('create policy dev_test_all on baton.%I for all to baton_test using (true) with check (true)', t);
  end loop;
end $$;
