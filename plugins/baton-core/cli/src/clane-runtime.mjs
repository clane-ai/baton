// Clane CLI as a Baton worker runtime (docs/clane-integration.md, decision 1).
//
// One run = one `clane --output-format json` prompt in the product repo. The daemon supplies:
//   - the Baton MCP connector and the PreToolUse gate through <cwd>/.clane/settings.local.json; the token
//     is a {{BATON_TOKEN}} placeholder that Clane resolves from ~/.clane/.credentials.json at start, which
//     the daemon sets per run. Clane 0.1.25 parses headersHelper but never runs it, and the credentials
//     file is per machine, so Clane runs are serialised per machine (one worker at a time) until Clane
//     ships connectors.inject;
//   - session start context (task line, unread messages) fetched from the server and put in the prompt;
//   - the Stop gate, emulated from the daemon side until Clane has a run-end hook: after the run,
//     if the agent still holds a live lease, the run is continued with the block reason, at most 3 times;
//   - session end and usage posts, with cost from the gateway when the run reports it.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Api } from './api.mjs';
import { CONFIG_DIR } from './config.mjs';
import { roleDefinition, systemPromptFor, runPromptFor } from './roles.mjs';
import { selfCommand } from './supervise.mjs';

export const CLANE_GATED_TOOLS = 'file_write|file_edit|file_delete|notebook_edit|project_file_write|project_file_edit|org_file_write|bash_exec|python_exec|node_exec|js_exec';

export function claneBinary() { return process.env.BATON_CLANE_BIN ?? 'clane'; }

/** Make sure the checkout's local Clane settings carry the Baton connector and the gate. Idempotent. */
export function ensureClaneSettings(cwd, serverUrl) {
  const dir = join(cwd, '.clane');
  const file = join(dir, 'settings.local.json');
  let s = {};
  if (existsSync(file)) { try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { s = {}; } }
  const self = selfCommand();
  const wanted = {
    mcpServers: { ...(s.mcpServers ?? {}), baton: { type: 'http', url: `${serverUrl}/mcp`, headers: { Authorization: 'Bearer {{BATON_TOKEN}}' } } },
    hooks: { ...(s.hooks ?? {}), PreToolUse: [{ matcher: CLANE_GATED_TOOLS, hooks: [{ type: 'command', command: `${self} gate pretool` }] }] },
  };
  const next = { ...s, ...wanted };
  const text = JSON.stringify(next, null, 2) + '\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { mkdirSync(dir, { recursive: true }); writeFileSync(file, text); return true; }
  return false;
}

export function claneHome() { return process.env.CLANE_CONFIG_HOME ?? join(homedir(), '.clane'); }

/** Set the credential Clane resolves for {{BATON_TOKEN}}. Merges into the flat secret store. */
export function setClaneCredential(token) {
  const file = join(claneHome(), '.credentials.json');
  let c = {};
  if (existsSync(file)) { try { c = JSON.parse(readFileSync(file, 'utf8')); } catch { c = {}; } }
  if (c.BATON_TOKEN === token) return;
  c.BATON_TOKEN = token;
  mkdirSync(claneHome(), { recursive: true });
  writeFileSync(file, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
}

/** One Clane worker at a time per machine: the credential store is per machine. Waits up to maxMs. */
export async function acquireClaneLock(maxMs = 45 * 60 * 1000) {
  const file = join(CONFIG_DIR, 'clane.lock');
  const start = Date.now();
  for (;;) {
    try { const fd = openSync(file, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return () => { try { unlinkSync(file); } catch { /* gone */ } }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const pid = Number(readFileSync(file, 'utf8').trim());
        const age = Date.now() - statSync(file).mtimeMs;
        try { process.kill(pid, 0); } catch { stale = true; }
        if (age > 60 * 60 * 1000) stale = true;
      } catch { stale = true; }
      if (stale) { try { unlinkSync(file); } catch { /* raced */ } continue; }
      if (Date.now() - start > maxMs) throw new Error('another Clane worker has held the machine lock for too long');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function claneToolsNote() {
  return 'Runtime notes: you are running inside the Clane CLI. The Baton tools are the MCP connector "baton": call them as mcp__baton__<tool> (mcp__baton__whoami, mcp__baton__task_next, ...). Files are addressed by paths relative to the workspace. Every file write and shell command is checked by the Baton gate: outside your task scope, or without a lease, it is denied.';
}

/**
 * Spawn one unattended Clane run for a role. Same result shape as spawnAgent:
 * { code, reason, sessionId, costUsd, credits, turns, resultSeen, log }.
 */
export async function spawnClaneAgent(opts) {
  const def = roleDefinition(opts.role, opts.cwd);
  const agentName = opts.agentName ?? opts.role;
  const api = new Api(opts.serverUrl, opts.token);
  const sessionId = `clane-${randomUUID()}`;
  const release = await acquireClaneLock();
  try {
  ensureClaneSettings(opts.cwd, opts.serverUrl);
  setClaneCredential(opts.token);

  mkdirSync(join(CONFIG_DIR, 'logs'), { recursive: true });
  const logPath = join(CONFIG_DIR, 'logs', `${opts.role}-clane-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const log = createWriteStream(logPath);
  const say = (l) => { if (!opts.quiet) opts.onLine?.(l); };

  // Session start: tell the server, get the context the plugin would have injected.
  let context = '';
  try {
    const r = await api.post('/hooks/session-start', { session_id: sessionId, hook_event_name: 'SessionStart', source: 'clane', cwd: opts.cwd });
    context = r.body?.hookSpecificOutput?.additionalContext ?? '';
  } catch (e) { log.write(`[session-start failed] ${e.message}\n`); }

  const env = { ...process.env, BATON_URL: opts.serverUrl, BATON_TOKEN: opts.token, BATON_ROLE: opts.role, BATON_SESSION: sessionId };
  const base = [systemPromptFor(def, agentName), '', claneToolsNote(), '', context ? `Context from Baton:\n${context}` : ''].join('\n');

  let totalCredits = 0, totalCostUsd = 0, tokensIn = 0, tokensOut = 0, turns = 0, modelSeen = opts.model ?? null, lastCode = 0, lastReason = 'completed', resultSeen = false;

  const runOnce = (prompt) => new Promise((resolve) => {
    const args = ['--output-format', 'json', '--permission-mode', opts.permissionMode ?? 'trusted'];
    if (opts.model) args.push('--model', opts.model);
    args.push('--', prompt);
    log.write(`[spawn] clane ${args.slice(0, -1).join(' ')} <prompt ${prompt.length} chars>\n`);
    const child = spawn(claneBinary(), args, { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { const s = d.toString(); err += s; log.write(`[stderr] ${s}`); });
    child.on('close', (code, signal) => {
      log.write(out + '\n');
      let m = null; try { m = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? ''); } catch { /* not json */ }
      resolve({ code, signal, m, err });
    });
    child.on('error', (e) => { log.write(`[spawn error] ${e.message}\n`); resolve({ code: -1, signal: null, m: null, err: e.message }); });
  });

  const absorb = (m) => {
    if (!m) return;
    resultSeen = true;
    turns += Number(m.iterations ?? 1);
    tokensIn += Number(m.usage?.input_tokens ?? 0) + Number(m.usage?.cache_read_input_tokens ?? 0) + Number(m.usage?.cache_creation_input_tokens ?? 0);
    tokensOut += Number(m.usage?.output_tokens ?? 0);
    const g = m.gateway_usage;
    if (g) { totalCredits += Number(g.credits ?? 0); totalCostUsd += Number(g.cost_usd ?? 0); modelSeen = g.model ?? modelSeen; }
    else modelSeen = m.model ?? modelSeen;
    for (const t of m.tool_uses ?? []) say(`[${opts.role}] -> ${t.name ?? t.tool ?? JSON.stringify(t).slice(0, 60)}`);
    if (m.message) say(`[${opts.role}] ${String(m.message).trim().split('\n')[0].slice(0, 200)}`);
  };

  // First run, then the daemon-side Stop gate: continue while the agent still holds a live lease.
  let prompt = `${base}\n\n${runPromptFor(def)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await runOnce(prompt);
    lastCode = r.code; lastReason = r.signal ? `signal_${r.signal}` : r.code === 0 ? 'completed' : r.code === 2 ? 'needs_input' : r.code === 3 ? 'policy_denied' : r.code === 4 ? 'model_error' : `exit_${r.code}`;
    absorb(r.m);
    if (r.code !== 0) break;
    let me = null;
    try { me = await api.tool('whoami'); } catch { me = null; }
    if (!me?.current_task) break;
    if (attempt === 3) { say(`[${opts.role}] stop gate: still holding ${me.current_task.key} after 3 continuations; leaving it to the reaper`); break; }
    say(`[${opts.role}] stop gate: still holding ${me.current_task.key}; continuing`);
    prompt = `${base}\n\nYou still hold task ${me.current_task.key} (${me.current_task.title}) and your previous turn ended without finishing it. Baton does not let a session end with an open task. Continue the work now: read your progress so far, then submit it with task_submit, ask with task_ask, delegate with task_delegate, or release it with task_release. Then stop.`;
  }

  const costUsd = totalCostUsd || 0;
  try {
    await api.post('/runs/usage', { session_id: sessionId, tokens_in: tokensIn, tokens_out: tokensOut, model: modelSeen ?? 'clane', cost_usd: costUsd, credits: totalCredits, exit_reason: `clane:${lastReason}` });
  } catch { /* accounting never blocks */ }
  try { await api.post('/hooks/session-end', { session_id: sessionId, hook_event_name: 'SessionEnd', reason: `daemon:${lastReason}`, credits: totalCredits }); } catch { /* ignore */ }
  say(`[${opts.role}] clane run ${lastReason}: credits=${totalCredits} cost=$${costUsd.toFixed(4)} turns=${turns}`);
  log.end();
  return { code: lastCode, reason: lastReason, sessionId, costUsd, credits: totalCredits, turns, resultSeen, log: logPath };
  } finally { release(); }
}
