-- Documents live with the engine, not on the agent machine (docs/ui-brief.md; platform proxy contract with f5).
-- A workspace is a named folder of files (requisitions, invoices, emails) that agents read and integrations write.
-- Files are uploaded to the artifacts bucket under docs/<workspace>/<path> and indexed here so a screen can list and
-- stream them by id through the operator API. A run names its workspace; tasks inherit it through the run.

alter table baton.workflow_runs add column if not exists workspace text;

create table if not exists baton.documents (
  id            uuid primary key default gen_random_uuid(),
  workspace     text not null,
  path          text not null,
  content_type  text not null default 'application/octet-stream',
  bytes         bigint not null default 0,
  sha256        text,
  uploaded_by   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace, path)
);
create index if not exists documents_workspace_idx on baton.documents (workspace);
alter table baton.documents enable row level security;
grant select, insert, update on baton.documents to service_role;

-- The workspace a task's documents belong to: its run's workspace, else 'default'.
create or replace function baton.task_workspace(p_task uuid) returns text
language sql stable as $$
  select coalesce((select r.workspace from baton.workflow_runs r join baton.tasks t on t.workflow_run = r.key where t.id = p_task), 'default');
$$;

create or replace function baton.document_upsert(p_workspace text, p_path text, p_content_type text, p_bytes bigint, p_sha256 text, p_by text) returns jsonb
language plpgsql security definer set search_path = baton, pg_temp as $$
declare d baton.documents;
begin
  if p_path like '%..%' or p_path like '/%' or p_path like '%:%' or p_path like '%\%' then return baton.err('PRECONDITION_FAILED', 'path must be relative, with forward slashes and no ..'); end if;
  insert into baton.documents (workspace, path, content_type, bytes, sha256, uploaded_by)
  values (p_workspace, p_path, coalesce(p_content_type, 'application/octet-stream'), p_bytes, p_sha256, p_by)
  on conflict (workspace, path) do update set content_type = excluded.content_type, bytes = excluded.bytes, sha256 = excluded.sha256, uploaded_by = excluded.uploaded_by, updated_at = now()
  returning * into d;
  return jsonb_build_object('ok', true, 'id', d.id, 'workspace', d.workspace, 'path', d.path, 'bytes', d.bytes, 'content_type', d.content_type);
end $$;
revoke execute on function baton.document_upsert(text, text, text, bigint, text, text) from public;
grant execute on function baton.document_upsert(text, text, text, bigint, text, text) to service_role;
