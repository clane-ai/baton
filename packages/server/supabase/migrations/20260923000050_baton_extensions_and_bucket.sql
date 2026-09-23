-- pg_jsonschema for artefact validation in the completion gate (prd.md 10.3), and
-- the private artifacts bucket (prd.md 7, 14).
create extension if not exists pg_jsonschema with schema extensions;

insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;
