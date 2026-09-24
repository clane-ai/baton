#!/usr/bin/env node
// Proves the Workflow screens work inside the real platform client without
// writing to it: copies <platform>/clane-client/src into a temporary folder,
// moves the area in (scripts/move.mjs), applies the PATCHES.md edits that code
// depends on (ds barrel exports, catalogue merge, api.blob), then runs the
// platform's own `tsc --noEmit` and Jest against it with the platform's
// installed packages. The type-check is compared with an untouched copy, so
// only errors this work adds count.
//
//   node scripts/platform-check.mjs [path to the platform checkout] [work dir]
//
// Read-only on the platform checkout. Exit 0 when the area adds no type
// errors and every spec passes with no React warnings.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { applyMove } from './move.mjs';

const platform = resolve(process.argv[2] ?? 'C:/git/clane.ai');
const work = resolve(process.argv[3] ?? join(tmpdir(), 'workflow-platform-check'));
const client = join(platform, 'clane-client');
const nm = (p) => join(platform, 'node_modules', p).replace(/\\/g, '/');
const bin = (name) => join(platform, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

function copyClient(dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, 'clane-client'), { recursive: true });
  cpSync(join(client, 'src'), join(dest, 'clane-client', 'src'), { recursive: true });
  for (const f of ['tsconfig.json', 'jest.setup.js', 'babel.config.cjs']) {
    cpSync(join(client, f), join(dest, 'clane-client', f));
  }
  const up = (p) => p.replace(/\\/g, '/');
  writeFileSync(
    join(dest, 'clane-client', 'tsconfig.check.json'),
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          noEmit: true,
          baseUrl: './src',
          paths: {
            '~/*': ['*'],
            '*': [
              up(join(client, 'node_modules/@types/*')),
              nm('@types/*'),
              up(join(client, 'node_modules/*')),
              nm('*'),
            ],
          },
          typeRoots: [nm('@types'), up(join(client, 'node_modules/@types'))],
        },
      },
      null,
      2,
    ),
  );
}

function patch(dest) {
  const src = join(dest, 'clane-client', 'src');
  const edit = (rel, fn) => {
    const p = join(src, rel);
    const before = readFileSync(p, 'utf8');
    const after = fn(before);
    if (after === before) throw new Error(`patch did not apply to ${rel}; PATCHES.md is out of date`);
    writeFileSync(p, after);
  };
  const promoted = readFileSync(resolve(import.meta.dirname, '..', 'PATCHES.md'), 'utf8').match(
    /```js\r?\n(\/\/ Promoted from src\/hr\/ds[\s\S]*?)```/,
  );
  if (!promoted) throw new Error('PATCHES.md has no ds barrel block');
  edit('ds/index.js', (s) => `${s}\n${promoted[1]}`);
  edit('i18n/catalog.js', (s) =>
    s
      .replace("import { EXTRACTED } from './catalog.extracted.js';", "import { EXTRACTED } from './catalog.extracted.js';\nimport { WORKFLOW } from './catalog.workflow.js';")
      .replace('...EXTRACTED.en }', '...EXTRACTED.en, ...WORKFLOW.en }'),
  );
  edit('lib/api.ts', (s) => {
    const fn = [
      'async function blob(path: string, retryOn401 = true): Promise<Blob> {',
      '  const base = getApiBase();',
      '  const url = base ? `${base}${path}` : path;',
      "  const res = await fetch(url, { headers: buildHeaders({}), credentials: 'include' });",
      '  if (res.status === 401 && retryOn401) {',
      '    const fresh = await refreshToken();',
      '    if (fresh) return blob(path, false);',
      '    forceLogoutAndRedirect();',
      "    throw new ApiError(401, 'Unauthorized', null);",
      '  }',
      '  if (!res.ok) {',
      '    const body = await parseBody(res);',
      '    throw new ApiError(res.status, `HTTP ${res.status}`, body);',
      '  }',
      '  return res.blob();',
      '}',
      '',
    ].join('\n');
    return s
      .replace('export const api = {', `${fn}\nexport const api = {`)
      .replace("  get: <T>(path: string) => request<T>(path, { method: 'GET' }),", "  get: <T>(path: string) => request<T>(path, { method: 'GET' }),\n  blob,");
  });
}

function tscErrors(dir) {
  const r = spawnSync(bin('tsc'), ['-p', 'tsconfig.check.json'], { cwd: join(dir, 'clane-client'), encoding: 'utf8', shell: true });
  return (r.stdout + r.stderr).split('\n').filter((l) => l.includes('error TS')).sort();
}

const base = `${work}-base`;
const moved = `${work}-moved`;
console.log(`platform: ${platform}`);
copyClient(base);
copyClient(moved);
const { written } = applyMove(moved);
patch(moved);
console.log(`moved ${written} files and applied the code patches in ${moved}`);

const before = tscErrors(base);
const after = tscErrors(moved);
const added = after.filter((l) => !before.includes(l));
console.log(`tsc: ${before.length} errors before, ${after.length} after, ${added.length} added`);
for (const l of added) console.log(`  ${l}`);

writeFileSync(
  join(moved, 'clane-client', 'jest.check.cjs'),
  `const P = ${JSON.stringify(platform.replace(/\\/g, '/'))};
module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/src/components/workflows/operations', '<rootDir>/src/ds'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'http://localhost:3091' },
  moduleNameMapper: {
    '\\\\.(css|less|scss|sass)$': P + '/node_modules/identity-obj-proxy',
    '\\\\.(svg|png|jpg|jpeg|gif|webp|avif|woff2?)$': '<rootDir>/src/test/fileStub.js',
    '^react$': P + '/node_modules/react',
    '^react-dom$': P + '/node_modules/react-dom',
    '^react-dom/server$': P + '/node_modules/react-dom/server.node',
  },
  moduleDirectories: ['node_modules', P + '/clane-client/node_modules', P + '/node_modules'],
  restoreMocks: true,
  testTimeout: 15000,
  transform: { '^.+\\\\.(ts|tsx|js|jsx)$': [P + '/node_modules/babel-jest', { configFile: __dirname + '/babel.config.cjs' }] },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
`,
);
const jest = spawnSync(bin('jest'), ['-c', 'jest.check.cjs'], {
  cwd: join(moved, 'clane-client'),
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, NODE_PATH: nm('') },
});
const out = jest.stdout + jest.stderr;
writeFileSync(join(moved, 'jest.out'), out);
const summary = out.split('\n').filter((l) => /^(Tests|Test Suites):/.test(l));
const warnings = out.split('\n').filter((l) => /Warning:|Future Flag/.test(l)).length;
console.log(`jest: ${summary.join(' | ')} | warnings ${warnings} (full output ${join(moved, 'jest.out')})`);

const ok = added.length === 0 && jest.status === 0 && warnings === 0;
console.log(ok ? 'PLATFORM CHECK PASSED' : 'PLATFORM CHECK FAILED');
process.exit(ok ? 0 : 1);
