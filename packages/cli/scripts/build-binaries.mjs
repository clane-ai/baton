// Build single-file executables of the CLI with bun.
//   node scripts/build-binaries.mjs [--out dist] [--targets bun-windows-x64,bun-linux-x64,...] [--version 0.2.0]
// Embeds roles/*.md, protocol.md and templates/*.json into src/assets.mjs for the build, then restores it.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const out = join(ROOT, flag('out', 'dist'));
const targets = flag('targets', 'bun-windows-x64,bun-darwin-arm64,bun-darwin-x64,bun-linux-x64,bun-linux-arm64').split(',');
const version = flag('version', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);

const assets = {};
for (const f of readdirSync(join(ROOT, 'roles'))) if (f.endsWith('.md')) assets[`roles/${f}`] = readFileSync(join(ROOT, 'roles', f), 'utf8');
assets['protocol.md'] = readFileSync(join(ROOT, 'protocol.md'), 'utf8');
for (const f of readdirSync(join(ROOT, 'templates'))) assets[`templates/${f}`] = readFileSync(join(ROOT, 'templates', f), 'utf8');

const assetsFile = join(ROOT, 'src', 'assets.mjs');
const original = readFileSync(assetsFile, 'utf8');
writeFileSync(assetsFile, `// GENERATED for the compiled build; do not commit.\nexport const ASSETS = ${JSON.stringify(assets)};\nexport const VERSION = ${JSON.stringify(version)};\n`);
mkdirSync(out, { recursive: true });
const built = [];
try {
  for (const t of targets) {
    const plat = t.replace(/^bun-/, '');
    const name = `baton-${plat}${plat.startsWith('windows') ? '.exe' : ''}`;
    const file = join(out, name);
    execSync(`bun build --compile --minify --target=${t} ${join(ROOT, 'bin', 'baton.mjs')} --outfile ${file}`, { stdio: 'inherit', cwd: ROOT });
    built.push(name);
  }
} finally {
  writeFileSync(assetsFile, original);
}
console.log(`built ${built.length} executable(s) in ${out}:\n  ${built.join('\n  ')}`);
if (!existsSync(join(out, built[0]))) process.exit(1);
