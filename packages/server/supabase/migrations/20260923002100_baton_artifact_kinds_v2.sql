-- Artefact kinds for non-code handoffs between roles (docs/delegation.md).
-- Enum values must be committed before they can be used, so the schemas follow in the next migration.
alter type baton.artifact_kind add value if not exists 'db_schema';
alter type baton.artifact_kind add value if not exists 'config';
alter type baton.artifact_kind add value if not exists 'handoff';
