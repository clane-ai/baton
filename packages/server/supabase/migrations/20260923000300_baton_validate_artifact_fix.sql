-- pg_jsonschema takes json (not jsonb) for the schema argument.
create or replace function baton.validate_artifact(p_kind baton.artifact_kind, p_version text, p_content jsonb, p_meta jsonb) returns text
language plpgsql stable as $$
declare s jsonb; inst jsonb; errs text[];
begin
  select schema into s from baton.artifact_schemas where kind = p_kind and version = coalesce(p_version, 'v1');
  if s is null then return null; end if;
  inst := coalesce(p_content, p_meta, '{}'::jsonb);
  errs := extensions.jsonschema_validation_errors(s::json, inst::json);
  if coalesce(array_length(errs, 1), 0) = 0 then return null; end if;
  return p_kind::text || ' ' || coalesce(p_version, 'v1') || ': ' || array_to_string(errs, '; ');
end $$;
