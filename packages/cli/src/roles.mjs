// Role definitions: a product repo's .claude/agents/<role>.md wins, else the copy shipped with the CLI.
// Shipped files come from disk in the source tree and from ./assets.mjs in the compiled executables.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROLES_DIR = join(HERE, '..', 'roles');

/** Read a file shipped with the CLI by its path relative to the package root. */
export function readAsset(rel) {
  if (ASSETS && ASSETS[rel] != null) return ASSETS[rel];
  return readFileSync(join(HERE, '..', rel), 'utf8');
}
export function hasAsset(rel) {
  if (ASSETS) return ASSETS[rel] != null;
  return existsSync(join(HERE, '..', rel));
}

export const PROTOCOL = readAsset('protocol.md');

export function parseAgentFile(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text.trim() };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { frontmatter: fm, body: m[2].trim() };
}

export function listBundledRoles() {
  if (ASSETS) return Object.keys(ASSETS).filter((k) => k.startsWith('roles/') && k.endsWith('.md')).map((k) => k.slice(6, -3)).sort();
  return readdirSync(ROLES_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
}

export function roleDefinition(role, cwd = process.cwd()) {
  const project = join(cwd, '.claude', 'agents', `${role}.md`);
  const bundledRel = `roles/${role}.md`;
  const bundled = join(ROLES_DIR, `${role}.md`);
  if (existsSync(project)) {
    const { frontmatter, body } = parseAgentFile(readFileSync(project, 'utf8'));
    return { role, path: project, source: 'project', frontmatter, body };
  }
  if (!hasAsset(bundledRel)) throw new Error(`no definition for role "${role}" (looked in ${project} and ${bundled})`);
  const { frontmatter, body } = parseAgentFile(readAsset(bundledRel));
  return { role, path: ASSETS ? `bundled:${bundledRel}` : bundled, source: 'bundled', frontmatter, body };
}

/** Tools the role may use without prompting, from its frontmatter. Always includes the Baton MCP server. */
export function allowedTools(def) {
  const listed = (def.frontmatter.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const set = new Set(listed.filter((t) => !t.startsWith('mcp__')));
  set.add('mcp__baton');
  set.add('mcp__plugin_baton-core_baton');
  return [...set];
}

/** The system prompt appended for an unattended run: role body plus the protocol (prd.md 13.2). */
export function systemPromptFor(def, agentName) {
  return [
    `You are the Baton agent "${agentName ?? def.role}" running the role "${def.role}".`,
    '',
    def.body,
    '',
    PROTOCOL,
    '',
    'Operational notes: you are unattended. Nobody will answer a chat question; use task_ask. When task_next returns none, or after task_submit, task_ask or task_release, end the session immediately.',
  ].join('\n');
}

/** The user prompt that starts the loop (what `baton prompt --role x` prints). */
export function runPromptFor(def) {
  return `Begin your Baton loop now as the ${def.role} agent. First: if your session context lists questions addressed to you or your role, answer each one with the answer tool (read the artefacts you need with artifact_get to answer well). Then call whoami, then task_next, and follow the coordination protocol to the end. If task_next returns none, end the session. Do not ask me anything; use task_ask if you are blocked.`;
}
