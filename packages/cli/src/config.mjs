// Configuration: environment first, then ~/.baton/config.json.
//   BATON_URL              server base URL (…/functions/v1/baton)
//   BATON_OPERATOR_TOKEN   operator token (humans, dashboard, the daemon's control calls)
//   BATON_TOKEN            agent token for the current role (set per spawn by the daemon)
//   BATON_ROLE             role the BATON_TOKEN belongs to
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_URL = 'https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton';
export const CONFIG_DIR = process.env.BATON_HOME ?? join(homedir(), '.baton');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function loadConfig() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    try { file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { throw new Error(`cannot parse ${CONFIG_PATH}: ${e.message}`); }
  }
  return {
    serverUrl: (process.env.BATON_URL ?? file.serverUrl ?? DEFAULT_URL).replace(/\/+$/, ''),
    operatorToken: process.env.BATON_OPERATOR_TOKEN ?? file.operatorToken ?? null,
    agents: file.agents ?? {},            // { role: { name, token } }
    defaults: { model: 'sonnet', maxTurns: 60, budgetUsd: 2, permissionMode: 'dontAsk', interval: 60, ...(file.defaults ?? {}) },
    machine: file.machine ?? process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown',
    projects: file.projects ?? {},        // { "<git remote>": { key } }
  };
}

export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const { serverUrl, operatorToken, agents, defaults, machine, projects } = cfg;
  writeFileSync(CONFIG_PATH, JSON.stringify({ serverUrl, operatorToken, agents, defaults, machine, projects }, null, 2) + '\n', { mode: 0o600 });
}

/** The agent token for a role: BATON_TOKEN when it belongs to that role, else the stored one. */
export function agentTokenFor(cfg, role) {
  if (process.env.BATON_TOKEN && (!role || !process.env.BATON_ROLE || process.env.BATON_ROLE === role)) return process.env.BATON_TOKEN;
  return cfg.agents?.[role]?.token ?? null;
}

export function anyAgentToken(cfg) {
  if (process.env.BATON_TOKEN) return { role: process.env.BATON_ROLE ?? null, token: process.env.BATON_TOKEN };
  const first = Object.entries(cfg.agents ?? {})[0];
  return first ? { role: first[0], token: first[1].token } : { role: null, token: null };
}
