// baton sync (prd.md 25.4): reconcile this checkout's plugins with the server's project profile.
//
//   1. read the profile for the project this directory belongs to (keyed by git remote)
//   2. register the marketplace at project scope if it is missing, and pin its ref
//   3. install anything enabled but not installed, at project scope
//   4. reinstall anything whose installed version differs from the catalogue at the pinned ref
//   5. disable anything installed from the marketplace that is no longer in the profile
//   6. optionally rewrite the project's .claude/settings.json block
//   7. report drift to the server as an event
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Api, must } from './api.mjs';

export function gitRemote(cwd) {
  try {
    const url = execSync('git config --get remote.origin.url', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : url;
  } catch { return null; }
}

function claude(args, cwd) {
  return execSync(`claude ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, env: { ...process.env, CLAUDECODE: undefined } });
}
function claudeJson(args, cwd) {
  try { return JSON.parse(claude(args, cwd)); } catch { return null; }
}
const samePath = (a, b) => a && b && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const baseVersion = (v) => String(v ?? '').replace(/^v/, '').split('-')[0];

/** Installed plugins for this project (project scope) plus user scope, keyed by plugin name. */
function installedPlugins(cwd, marketplace) {
  const list = claudeJson('plugin list --json', cwd);
  if (!list) return null;
  const arr = Array.isArray(list) ? list : (list.plugins ?? []);
  const map = new Map();
  for (const p of arr) {
    const [name, mk] = String(p.id ?? p.name ?? '').split('@');
    if (mk !== marketplace) continue;
    if (p.scope === 'project' && !samePath(p.projectPath, cwd)) continue;
    map.set(name, p);
  }
  return map;
}

function marketplaceInfo(cwd, name) {
  const list = claudeJson('plugin marketplace list --json', cwd) ?? [];
  return (Array.isArray(list) ? list : []).find((m) => m.name === name) ?? null;
}

/** Version of a plugin in the marketplace catalogue as checked out (after pinning). */
function catalogueVersion(mkInfo, plugin) {
  try {
    const mk = JSON.parse(readFileSync(join(mkInfo.installLocation, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const entry = (mk.plugins ?? []).find((p) => p.name === plugin);
    const root = mk.metadata?.pluginRoot ?? '';
    const src = entry?.source ?? `./${root}${plugin}`;
    const manifest = join(mkInfo.installLocation, typeof src === 'string' ? src : `${root}${plugin}`, '.claude-plugin', 'plugin.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
  } catch { return null; }
}

/** Point the marketplace clone at the project's pinned ref so installs read that catalogue. */
function pinMarketplace(mkInfo, ref, cwd) {
  const loc = mkInfo.installLocation;
  try { claude(`plugin marketplace update ${mkInfo.name}`, cwd); } catch { /* offline: use what is there */ }
  if (!ref || ref === 'main') return;
  execSync(`git -C "${loc}" fetch -q --tags origin`, { stdio: 'ignore' });
  execSync(`git -C "${loc}" checkout -q ${ref}`, { stdio: 'ignore' });
}

export async function sync(cfg, { cwd, dryRun = false, writeSettings = false, quiet = false }) {
  const api = new Api(cfg.serverUrl, cfg.operatorToken);
  const remote = gitRemote(cwd);
  const r = await api.get(`/admin/projects/profile?repo=${encodeURIComponent(remote ?? '')}`);
  if (r.status === 404 || !r.body?.project) return { project: null, actions: [], message: `no project profile for ${remote ?? 'this directory (no git remote)'}` };
  const profile = must(r, 'profile');
  const project = profile.project;
  const marketplace = profile.marketplace ?? 'clane-ai';
  const mkRepo = profile.marketplace_repo ?? 'clane-ai/baton';
  const ref = project.marketplace_ref ?? 'main';
  const actions = [];
  const wanted = (profile.plugins ?? []).filter((p) => p.enabled);

  // 2. marketplace
  let mkInfo = marketplaceInfo(cwd, marketplace);
  if (!mkInfo) {
    actions.push({ kind: 'marketplace', summary: `register marketplace ${marketplace} (${mkRepo}) at project scope` });
    if (!dryRun) { claude(`plugin marketplace add ${mkRepo} --scope project`, cwd); mkInfo = marketplaceInfo(cwd, marketplace); }
  }
  if (mkInfo && !dryRun) pinMarketplace(mkInfo, ref, cwd);

  // 3 + 4. installs and version drift
  const installed = installedPlugins(cwd, marketplace);
  for (const p of wanted) {
    const have = installed?.get(p.plugin);
    const catalogue = mkInfo ? catalogueVersion(mkInfo, p.plugin) : null;
    const target = p.version && !/[\^~]/.test(p.version) ? p.version : catalogue;
    if (!have) {
      actions.push({ kind: 'install', plugin: p.plugin, scope: p.scope, summary: `install ${p.plugin}@${marketplace} --scope ${p.scope}${target ? ` (${target})` : ''}` });
    } else if (target && baseVersion(have.version) !== baseVersion(target)) {
      actions.push({ kind: 'reinstall', plugin: p.plugin, scope: p.scope, summary: `reinstall ${p.plugin}@${marketplace} (${have.version} -> ${target} at ref ${ref})` });
    }
  }
  // 5. removals
  if (installed) {
    for (const [name] of installed) {
      if (name.startsWith('baton-') && !wanted.some((p) => p.plugin === name)) {
        actions.push({ kind: 'disable', plugin: name, summary: `disable ${name} (not in profile)` });
      }
    }
  }

  // 6. settings block
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) { try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { settings = {}; } }
  const desiredEnabled = Object.fromEntries(wanted.map((p) => [`${p.plugin}@${marketplace}`, true]));
  const desiredMcp = (profile.mcp ?? []).map((m) => m.server);
  const desiredMarket = { source: { source: 'github', repo: mkRepo, ref }, autoUpdate: true };
  const settingsDrift = JSON.stringify(settings.enabledPlugins ?? {}) !== JSON.stringify(desiredEnabled)
    || JSON.stringify(settings.enabledMcpjsonServers ?? []) !== JSON.stringify(desiredMcp)
    || JSON.stringify(settings.extraKnownMarketplaces?.[marketplace] ?? null) !== JSON.stringify(desiredMarket);
  if (settingsDrift && writeSettings) actions.push({ kind: 'settings', summary: `rewrite plugin block in ${settingsPath}` });

  if (!dryRun) {
    for (const a of actions) {
      try {
        if (a.kind === 'install') claude(`plugin install ${a.plugin}@${marketplace} --scope ${a.scope}`, cwd);
        else if (a.kind === 'reinstall') { try { claude(`plugin uninstall ${a.plugin}@${marketplace} --scope ${a.scope}`, cwd); } catch { /* may already be gone */ } claude(`plugin install ${a.plugin}@${marketplace} --scope ${a.scope}`, cwd); }
        else if (a.kind === 'disable') claude(`plugin disable ${a.plugin}@${marketplace} --scope project`, cwd);
        else if (a.kind === 'settings') {
          mkdirSync(join(cwd, '.claude'), { recursive: true });
          settings.extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces ?? {}), [marketplace]: desiredMarket };
          settings.enabledPlugins = desiredEnabled;
          settings.enabledMcpjsonServers = desiredMcp;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        }
        a.done = a.kind !== 'marketplace' || true;
      } catch (e) { a.error = (e.stderr ?? e.message ?? String(e)).toString().trim().split('\n').pop(); }
    }
    // Project-scope installs write enabledPlugins themselves; keep the ref pinned in settings regardless.
    if (!writeSettings && existsSync(settingsPath) && ref !== 'main') {
      try {
        const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
        if (s.extraKnownMarketplaces?.[marketplace] && s.extraKnownMarketplaces[marketplace].source?.ref !== ref) {
          s.extraKnownMarketplaces[marketplace].source.ref = ref;
          writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
        }
      } catch { /* leave settings alone */ }
    }
    try { await api.post('/admin/projects/drift', { project_id: project.id, machine: cfg.machine, actions: actions.map((a) => ({ kind: a.kind, plugin: a.plugin ?? null, done: !!a.done, error: a.error ?? null })) }); } catch { /* best effort */ }
  }
  void quiet;
  return { project, actions, dryRun, marketplace, ref, installed: installed ? [...installed.entries()].map(([n, p]) => ({ name: n, version: p.version })) : null };
}
