// Regenerates the P2P artefact schema migration from the JSON files in this directory.
// Usage: node packages/schemas/gen-p2p-migration.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const kinds = ['purchase_order', 'delivery_note', 'invoice', 'goods_receipt', 'invoice_match', 'payment'];
const Q = String.fromCharCode(39);
let sql = '-- Schemas for the procure-to-pay artefact kinds (docs/examples/workflows/p2p). Source of truth: packages/schemas/*.json.\n-- Regenerate with: node packages/schemas/gen-p2p-migration.mjs\n';
for (const k of kinds) {
  const min = JSON.stringify(JSON.parse(readFileSync(join(here, `${k}.json`), 'utf8'))).split(Q).join(Q + Q);
  sql += `insert into baton.artifact_schemas (kind, version, schema) values (${Q}${k}${Q}, ${Q}v1${Q}, ${Q}${min}${Q}::jsonb)\n  on conflict (kind, version) do update set schema = excluded.schema;\n`;
}
const out = join(here, '..', 'server', 'supabase', 'migrations', '20260923003000_baton_p2p_schemas.sql');
writeFileSync(out, sql);
console.log(`wrote ${out} for ${kinds.length} schemas`);
