#!/usr/bin/env node
// Copies the Workflow operational screens from this staging package into a
// platform checkout (your own worktree on feat/clane-workflow-module):
//
//   node scripts/move.mjs <path to the platform checkout>
//
// It copies an allowlist, not the tree: the area itself, the promoted design-
// system components and the copy catalogue. The staging stubs (lib/api, lib/base,
// lib/auth, i18n/index, the ds barrel index.js and the verbatim ds copies) are never
// copied; the platform has the real ones. A target file that already exists
// with different content stops the whole move before anything is written,
// unless --update is given for a deliberate later round. It
// never runs git; review and commit by explicit path yourself. Edits to
// existing platform files are in PATCHES.md and are applied by hand.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const staging = resolve(here, '..');

/** Everything under these directories is the area's own. */
const TREES = ['clane-client/src/components/workflows/operations'];

/** The promoted components (Task 2), .jsx and .d.ts each. */
const PROMOTED = [
  'Drawer',
  'Timeline',
  'SortableTable',
  'FilterBar',
  'DataTable',
  'AuditLogRow',
  'ProgressBar',
  'Toast',
  'Banner',
  'Breadcrumbs',
  'Pagination',
  'BarChart',
  'ApprovalCard',
  'Loading',
  'AppHeader',
];

const FILES = [
  'clane-client/src/i18n/catalog.workflow.js',
  // Types for the shared barrel: new on the platform, see its header.
  'clane-client/src/ds/index.d.ts',
  ...PROMOTED.flatMap((n) => [`clane-client/src/ds/${n}.jsx`, `clane-client/src/ds/${n}.d.ts`]),
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** The copy plan: [{ rel, from, to }]. Throws if `target` is not a platform checkout. */
export function planMove(target) {
  const root = resolve(target);
  if (!existsSync(join(root, 'clane-client', 'src'))) {
    throw new Error(`${root} has no clane-client/src; pass the platform checkout's root`);
  }
  const rels = [
    ...TREES.flatMap((t) => walk(join(staging, t)).map((p) => relative(staging, p))),
    ...FILES,
  ];
  return rels.map((rel) => ({ rel, from: join(staging, rel), to: join(root, rel) }));
}

/**
 * Copies the plan. By default all-or-nothing on conflicts: a target that
 * exists with different content stops the move before anything is written.
 * `{ update: true }` is for a deliberate later round: it overwrites differing
 * files in the allowlist (never anything else) and reports them as `updated`.
 */
export function applyMove(target, { update = false } = {}) {
  const plan = planMove(target);
  const conflicts = [];
  const updated = [];
  let same = 0;
  const todo = [];
  for (const step of plan) {
    const body = readFileSync(step.from);
    if (existsSync(step.to)) {
      if (Buffer.compare(readFileSync(step.to), body) === 0) {
        same += 1;
        continue;
      }
      if (update) {
        updated.push(step.rel);
        todo.push({ ...step, body });
      } else {
        conflicts.push(step.rel);
      }
      continue;
    }
    todo.push({ ...step, body });
  }
  if (conflicts.length) {
    throw new Error(`target differs, nothing written:\n  ${conflicts.join('\n  ')}`);
  }
  for (const step of todo) {
    mkdirSync(dirname(step.to), { recursive: true });
    writeFileSync(step.to, step.body);
  }
  return { written: todo.length - updated.length, updated, same };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node scripts/move.mjs [--update] <path to the platform checkout>');
    process.exit(2);
  }
  try {
    const { written, updated, same } = applyMove(target, { update });
    console.log(`${written} files written, ${updated.length} updated, ${same} already identical.`);
    for (const rel of updated) console.log(`  updated ${rel}`);
    console.log('Next: apply the edits in PATCHES.md by hand, then stage and commit by explicit path.');
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
