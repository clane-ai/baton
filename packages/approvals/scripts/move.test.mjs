// node --test scripts/move.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { planMove, applyMove } from './move.mjs';

const target = () => {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-move-'));
  mkdirSync(join(dir, 'clane-client', 'src'), { recursive: true });
  return dir;
};

test('copies the area, the promoted components and the copy catalogue, never a stub', () => {
  const plan = planMove(target());
  const paths = plan.map((p) => p.rel.split(sep).join('/'));
  assert.ok(paths.includes('clane-client/src/components/workflows/operations/Section.tsx'));
  assert.ok(paths.includes('clane-client/src/components/workflows/operations/data/api.ts'));
  assert.ok(paths.includes('clane-client/src/ds/Timeline.jsx'));
  assert.ok(paths.includes('clane-client/src/ds/Timeline.d.ts'));
  assert.ok(paths.includes('clane-client/src/i18n/catalog.workflow.js'));
  assert.ok(paths.includes('clane-client/src/ds/index.d.ts'));
  for (const stub of [
    'clane-client/src/lib/api.ts',
    'clane-client/src/lib/base.ts',
    'clane-client/src/lib/auth.tsx',
    'clane-client/src/i18n/index.tsx',
    'clane-client/src/ds/index.js',
    'clane-client/src/ds/Button.jsx',
    'clane-client/src/ds/StatusDot.jsx',
  ]) {
    assert.ok(!paths.includes(stub), `${stub} must not be copied`);
  }
});

test('writes new files and leaves identical ones alone', () => {
  const dir = target();
  const first = applyMove(dir);
  assert.ok(first.written > 0);
  assert.ok(existsSync(join(dir, 'clane-client/src/components/workflows/operations/Section.tsx')));
  const again = applyMove(dir);
  assert.equal(again.written, 0);
  assert.equal(again.same, first.written);
});

test('refuses to overwrite a file that differs, and writes nothing', () => {
  const dir = target();
  const f = join(dir, 'clane-client/src/i18n/catalog.workflow.js');
  mkdirSync(join(dir, 'clane-client/src/i18n'), { recursive: true });
  writeFileSync(f, 'someone else wrote this');
  assert.throws(() => applyMove(dir), /differs/);
  assert.equal(readFileSync(f, 'utf8'), 'someone else wrote this');
  assert.ok(!existsSync(join(dir, 'clane-client/src/components/workflows/operations/Section.tsx')));
});

test('refuses a target that is not a clane checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-move-bad-'));
  assert.throws(() => planMove(dir), /clane-client\/src/);
});
