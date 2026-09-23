// Copies the zero-dependency CLI into plugins/baton-core/cli so the plugin's command hooks
// and monitor work on a machine that has Node but not the npm package (decision 12 fallback).
// Usage: node plugins/sync-cli-into-core.mjs
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'packages', 'cli');
const dst = join(here, 'baton-core', 'cli');
if (existsSync(dst)) rmSync(dst, { recursive: true });
mkdirSync(dst, { recursive: true });
for (const p of ['bin', 'src', 'roles', 'templates', 'protocol.md', 'package.json', 'README.md']) {
  cpSync(join(src, p), join(dst, p), { recursive: true });
}
console.log(`copied packages/cli into ${dst}`);
