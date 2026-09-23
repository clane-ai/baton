// Regenerates the artifact_schemas seed migration from the JSON files in this directory.
// Usage: node packages/schemas/gen-migration.mjs [output.sql]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kinds = ['user_story', 'task_spec', 'design_spec', 'api_contract', 'service_contract', 'build', 'test_report', 'review', 'migration', 'pr', 'db_schema', 'config', 'handoff', 'purchase_order', 'delivery_note', 'invoice', 'goods_receipt', 'invoice_match', 'payment'];
let sql = '-- Phase 5: artefact schemas (prd.md 10.3, decision 8). Source of truth: packages/schemas/*.json.\n';
sql += '-- Regenerate with: node packages/schemas/gen-migration.mjs\n';
for (const k of kinds) {
  const min = JSON.stringify(JSON.parse(readFileSync(join(here, `${k}.json`), 'utf8')));
  sql += `insert into baton.artifact_schemas (kind, version, schema) values ('${k}', 'v1', '${min.replace(/'/g, "''")}'::jsonb)\n  on conflict (kind, version) do update set schema = excluded.schema;\n`;
}
const out = process.argv[2] ?? join(here, '..', 'server', 'supabase', 'migrations', '20260923000800_baton_artifact_schemas_v1.sql');
writeFileSync(out, sql);
console.log(`wrote ${out} for ${kinds.length} schemas`);
