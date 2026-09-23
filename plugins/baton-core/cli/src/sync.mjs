// baton sync (prd.md 25.4): reconcile this checkout's plugins with the server's project profile.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Api, must } from './api.mjs';

export function gitRemote(cwd) {
  try {
    const url = execSync('git config --get remote.origin.url', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : url;
  } catch { return null; }
}

function claude(args, cwd) {
  return execSync(`claude ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

function installedPlugins(cwd) {
  try {
    const out = claude('plugin list --json', cwd);
    const j = JSON.parse(out);
    const arr = Array.isArray(j) ? j : (j.plugins ?? []);
    return new Map(arr.map((p) => [String(p.name ?? p.id ?? '').split('@')[0], p]));
  } catch { return null; }
}

export async function sync(cfg, { cwd, dryRun = false, writeSettings = false, quiet = false }) {
  const api = new Api(cfg.serverUrl, cfg.operatorToken);
  const remote = gitRemote(cwd);
  const r = await api.get(`/admin/projects/profile?repo=${encodeURIComponent(remote ?? '')}`);
  if (r.status === 404 || !r.body?.project) return { project: null, actions: [], message: `no project profile for ${remote ?? 'this directory (no git remote)'}` };
  const profile = must(r, 'profile');
  const project = profile.project;
  const marketplace = profile.marketplace ?? 'clane-ai';
  const actions = [];

  const installed = installedPlugins(cwd);
  const wanted = (profile.plugins ?? []).filter((p) => p.enabled);
  for (const p of wanted) {
    const have = installed?.get(p.plugin);
    if (!have) actions.push({ kind: 'install', plugin: p.plugin, scope: p.scope, summary: `install ${p.plugin}@${marketplace} --scope ${p.scope}` });
    else if (p.version && have.version && !semverSatisfies(have.version, p.version)) actions.push({ kind: 'update', plugin: p.plugin, summary: `update ${p.plugin} (${have.version} -> ${p.version})` });
  }
  if (installed) {
    for (const [name] of installed) {
      if (name.startsWith('baton-') && !wanted.some((p) => p.plugin === name)) actions.push({ kind: 'disable', plugin: name, summary: `disable ${name} (not in profile)` });
    }
  }

  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) { try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { settings = {}; } }
  const desiredEnabled = Object.fromEntries(wanted.map((p) => [`${p.plugin}@${marketplace}`, true]));
  const desiredMcp = (profile.mcp ?? []).map((m) => m.server);
  const desiredMarket = { source: { source: 'github', repo: profile.marketplace_repo ?? 'clane-ai/baton', ref: project.marketplace_ref }, autoUpdate: true };
  const settingsDrift = JSON.stringify(settings.enabledPlugins ?? {}) !== JSON.stringify(desiredEnabled)
    || JSON.stringify(settings.enabledMcpjsonServers ?? []) !== JSON.stringify(desiredMcp)
    || JSON.stringify(settings.extraKnownMarketplaces?.[marketplace] ?? null) !== JSON.stringify(desiredMarket);
  if (settingsDrift) actions.push({ kind: 'settings', summary: `${writeSettings ? 'rewrite' : 'settings block differs in'} ${settingsPath}` });

  if (!dryRun) {
    for (const a of actions) {
      try {
        if (a.kind === 'install') claude(`plugin install ${a.plugin}@${marketplace} --scope ${a.scope}`, cwd);
        else if (a.kind === 'update') claude(`plugin update ${a.plugin}@${marketplace}`, cwd);
        else if (a.kind === 'disable') claude(`plugin disable ${a.plugin}@${marketplace} --scope project`, cwd);
        else if (a.kind === 'settings' && writeSettings) {
          mkdirSync(join(cwd, '.claude'), { recursive: true });
          settings.extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces ?? {}), [marketplace]: desiredMarket };
          settings.enabledPlugins = desiredEnabled;
          settings.enabledMcpjsonServers = desiredMcp;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        }
        a.done = true;
      } catch (e) { a.error = (e.stderr ?? e.message ?? String(e)).toString().trim().split('\n').pop(); }
    }
    try { await api.post('/admin/projects/drift', { project_id: project.id, machine: cfg.machine, actions: actions.map((a) => ({ kind: a.kind, plugin: a.plugin, done: !!a.done, error: a.error ?? null })) }); } catch { /* best effort */ }
  }
  if (!quiet && !actions.length) { /* caller prints */ }
  return { project, actions, dryRun, marketplace };
}

function semverSatisfies(version, range) {
  const v = version.replace(/^v/, '').split('.').map(Number);
  const m = range.match(/^([\^~]?)(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return version === range;
  const [, op, a, b, c] = m; const want = [Number(a), Number(b), Number(c)];
  if (op === '') return v.join('.') === want.join('.');
  if (v[0] !== want[0]) return false;
  if (op === '~' && v[1] !== want[1]) return false;
  return v[1] > want[1] || (v[1] === want[1] && v[2] >= want[2]);
}
