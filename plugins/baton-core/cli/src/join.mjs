// baton join <invite-code>: everything a developer machine needs, in one command.
//   1. redeem the one-time invite -> agent tokens for the roles it names
//   2. write ~/.baton/config.json (merge: existing roles are kept unless the invite replaces them)
//   3. in a product repo: register the marketplace and install baton-core at project scope,
//      and write .claude/settings.json from the template if the repo has none
//   4. run doctor for the first role and print the next step
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Api } from './api.mjs';
import { saveConfig, CONFIG_PATH, DEFAULT_URL } from './config.mjs';
import { readAsset } from './roles.mjs';

const SETTINGS_TEMPLATE = 'templates/product-repo-settings.json';

function claude(args, cwd) {
  return execSync(`claude ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, env: { ...process.env, CLAUDECODE: undefined } });
}
function isGitRepo(cwd) {
  try { execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
}
function hasClaude() {
  try { execSync('claude --version', { stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
}

/** Redeem the code and store the tokens. Returns { machine, agents, project_key }. */
export async function redeem(cfg, code, { machine, serverUrl } = {}) {
  const url = (serverUrl ?? cfg.serverUrl ?? DEFAULT_URL).replace(/\/+$/, '');
  const api = new Api(url, null);
  const r = await api.post('/join', { code, machine: machine ?? cfg.machine });
  if (r.status !== 200 || r.body?.ok === false) {
    const e = r.body?.error ?? {};
    throw new Error(`join failed: ${e.code ?? r.status} ${e.message ?? ''}`.trim());
  }
  cfg.serverUrl = url;
  cfg.machine = r.body.machine ?? cfg.machine;
  for (const [role, a] of Object.entries(r.body.agents)) cfg.agents[role] = { name: a.name, token: a.token };
  saveConfig(cfg);
  return r.body;
}

/** Install the plugin at project scope and seed .claude/settings.json. Returns a list of what happened. */
export function setupRepo(cwd, { marketplace = 'clane-ai', repo = 'clane-ai/baton', plugins = ['baton-core'] } = {}) {
  const log = [];
  if (!isGitRepo(cwd)) { log.push(`skipped plugin install: ${cwd} is not a git repository (run "baton join" inside your product repo, or "baton setup" later)`); return log; }
  if (!hasClaude()) { log.push('skipped plugin install: "claude" is not on the PATH; install Claude Code, then run "baton setup"'); return log; }
  let listed = '';
  try { listed = claude('plugin marketplace list', cwd); } catch { listed = ''; }
  if (!listed.includes(marketplace)) {
    try { claude(`plugin marketplace add ${repo} --scope project`, cwd); log.push(`registered marketplace ${marketplace} (${repo}) at project scope`); }
    catch (e) { log.push(`could not add marketplace ${repo}: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`); return log; }
  } else log.push(`marketplace ${marketplace} already registered`);
  for (const p of plugins) {
    try { claude(`plugin install ${p}@${marketplace} --scope project`, cwd); log.push(`installed ${p}@${marketplace} at project scope`); }
    catch (e) { log.push(`could not install ${p}: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`); }
  }
  const settings = join(cwd, '.claude', 'settings.json');
  if (!existsSync(settings)) {
    mkdirSync(dirname(settings), { recursive: true });
    const tpl = JSON.parse(readAsset(SETTINGS_TEMPLATE));
    delete tpl.$comment;
    writeFileSync(settings, JSON.stringify(tpl, null, 2) + '\n');
    log.push(`wrote ${settings} (marketplace, plugin, MCP allow rule, deny rules); commit it`);
  } else {
    try {
      const s = JSON.parse(readFileSync(settings, 'utf8'));
      const allow = s.permissions?.allow ?? [];
      if (!allow.includes('mcp__plugin_baton-core_baton')) {
        s.permissions = { ...(s.permissions ?? {}), allow: [...allow, 'mcp__plugin_baton-core_baton'] };
        writeFileSync(settings, JSON.stringify(s, null, 2) + '\n');
        log.push(`added the Baton MCP allow rule to ${settings}`);
      } else log.push(`${settings} already allows the Baton MCP server`);
    } catch { log.push(`${settings} exists but could not be parsed; add "mcp__plugin_baton-core_baton" to permissions.allow yourself`); }
  }
  return log;
}

export function nextSteps(roles, cwd) {
  const first = roles[0];
  return [
    '',
    'Next:',
    `  interactive:  set BATON_ROLE=${first} and open "claude" in ${cwd}, then type /baton-core:work`,
    `  unattended:   baton supervise --roles ${roles.join(',')}     (add --install to run it as a service)`,
    `  check:        baton doctor --role ${first}`,
    `Tokens are stored in ${CONFIG_PATH}. Never commit that file.`,
  ].join('\n');
}
