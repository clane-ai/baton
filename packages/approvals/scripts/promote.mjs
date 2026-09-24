#!/usr/bin/env node
// Copies the twelve design-system components (fifteen files) the Approvals
// area needs from the platform's src/hr/ds/components into this package's
// clane-client/src/ds, rewriting the one sibling import that changes shape
// ('../feedback/StatusDot.jsx' or './StatusDot.jsx' → './StatusDot.jsx', the
// shared copy). Reads the platform checkout read-only.
//
//   node scripts/promote.mjs [path-to-clane.ai]   (default C:\git\clane.ai)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const platform = resolve(process.argv[2] ?? 'C:/git/clane.ai');
const from = resolve(platform, 'clane-client/src/hr/ds/components');
const to = resolve(here, '../clane-client/src/ds');

export const PROMOTED = [
  'overlay/Drawer',
  'data/Timeline',
  'data/SortableTable',
  'forms/FilterBar',
  'data/DataTable',
  'data/AuditLogRow',
  'feedback/ProgressBar',
  'feedback/Toast',
  'feedback/Banner',
  'navigation/Breadcrumbs',
  'navigation/Pagination',
  'charts/BarChart',
  'chat/ApprovalCard',
  'feedback/Loading',
  'navigation/AppHeader',
];

const rewrite = (src) =>
  src.replace(/from '(?:\.\.\/feedback|\.)\/StatusDot\.jsx'/g, "from './StatusDot.jsx'");

mkdirSync(to, { recursive: true });
for (const entry of PROMOTED) {
  const name = entry.split('/').pop();
  for (const ext of ['.jsx', '.d.ts']) {
    const src = readFileSync(resolve(from, entry + ext), 'utf8');
    writeFileSync(resolve(to, name + ext), rewrite(src));
    console.log(`${entry}${ext} -> src/ds/${name}${ext}`);
  }
}
