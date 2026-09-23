// The supervisor daemon (prd.md 12.2, 24) and the single-run spawner it shares with `baton work`.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream, existsSync, readFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './assets.mjs';
import { Api } from './api.mjs';
import { CONFIG_DIR, agentTokenFor } from './config.mjs';
import { roleDefinition, allowedTools, systemPromptFor, runPromptFor } from './roles.mjs';

// Interim cost estimate per million tokens (input, output). Cache reads cost a tenth, cache
// writes a quarter more. The final figure comes from the result message and replaces this.
const PRICE = [
  [/haiku/i, [1, 5]], [/opus/i, [15, 75]], [/sonnet/i, [3, 15]],
];
function estimateCost(model, u) {
  const [, [pi, po]] = PRICE.find(([re]) => re.test(model ?? '')) ?? [null, [3, 15]];
  return (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * 0.1 + u.output * po) / 1e6;
}

const EXIT_REASON = { 0: 'completed', 1: 'error', 2: 'budget_or_auth', 130: 'interrupted', 143: 'terminated' };

export function claudeBinary() {
  return process.env.BATON_CLAUDE_BIN ?? 'claude';
}

/**
 * Spawn one unattended agent session for a role. Resolves with { code, reason, sessionId, costUsd, turns, log }.
 * opts: { role, cwd, token, serverUrl, model, maxTurns, budgetUsd, permissionMode, mcpConfig (bool), agentName, onLine, quiet }
 */
export function spawnAgent(opts) {
  const runtime = opts.runtime ?? process.env.BATON_RUNTIME ?? 'claude';
  if (runtime === 'clane') return import('./clane-runtime.mjs').then((m) => m.spawnClaneAgent(opts));
  const def = roleDefinition(opts.role, opts.cwd);
  const agentName = opts.agentName ?? opts.role;
  const model = opts.model ?? def.frontmatter.model ?? 'sonnet';
  const maxTurns = Number(opts.maxTurns ?? def.frontmatter.maxTurns ?? 60);
  const budget = Number(opts.budgetUsd ?? 2);
  const mode = opts.permissionMode ?? 'dontAsk';

  const args = [
    '-p', runPromptFor(def),
    '--permission-mode', mode,
    '--max-turns', String(maxTurns),
    '--max-budget-usd', String(budget),
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--append-system-prompt', systemPromptFor(def, agentName),
    '--allowedTools', allowedTools(def).join(','),
  ];
  if (opts.useAgentFlag) args.push('--agent', opts.role);

  // The claim made in this session is tagged with this id (X-Baton-Session), so a sibling session ending
  // cannot release it (session_end is scoped to the claim's session).
  const batonSession = randomUUID();
  let mcpPath = null;
  if (opts.mcpConfig !== false) {
    mkdirSync(join(CONFIG_DIR, 'tmp'), { recursive: true });
    mcpPath = join(CONFIG_DIR, 'tmp', `mcp-${opts.role}-${process.pid}-${Date.now()}.json`);
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { baton: { type: 'http', url: `${opts.serverUrl}/mcp`, headers: { Authorization: `Bearer ${opts.token}`, 'X-Baton-Session': batonSession } } } }), { mode: 0o600 });
    args.push('--mcp-config', mcpPath, '--strict-mcp-config');
  }

  const env = { ...process.env, BATON_URL: opts.serverUrl, BATON_TOKEN: opts.token, BATON_ROLE: opts.role };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;

  mkdirSync(join(CONFIG_DIR, 'logs'), { recursive: true });
  const logPath = join(CONFIG_DIR, 'logs', `${opts.role}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const log = createWriteStream(logPath);
  const api = new Api(opts.serverUrl, opts.token);

  return new Promise((resolve) => {
    const child = spawn(claudeBinary(), args, { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let sessionId = null, modelSeen = model, costUsd = 0, turns = 0, resultSeen = false, buf = '';
    const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let lastPost = Date.now();

    const post = async (final) => {
      if (!sessionId) return;
      try {
        await api.post('/runs/usage', { session_id: sessionId, tokens_in: u.input + u.cacheRead + u.cacheWrite, tokens_out: u.output, model: modelSeen,
          cost_usd: final?.cost ?? estimateCost(modelSeen, u), exit_reason: final?.reason });
      } catch { /* the hooks report too; never block the agent on accounting */ }
    };

    const handle = (line) => {
      log.write(line + '\n');
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'system' && m.subtype === 'init') { sessionId = m.session_id; modelSeen = m.model ?? model; }
      if (m.type === 'assistant') {
        turns++;
        const mu = m.message?.usage; if (mu) { u.input += mu.input_tokens ?? 0; u.cacheWrite += mu.cache_creation_input_tokens ?? 0; u.cacheRead += mu.cache_read_input_tokens ?? 0; u.output += mu.output_tokens ?? 0; }
        for (const c of m.message?.content ?? []) {
          if (c.type === 'text' && c.text && !opts.quiet) opts.onLine?.(`[${opts.role}] ${c.text.trim().split('\n')[0].slice(0, 200)}`);
          if (c.type === 'tool_use' && !opts.quiet) opts.onLine?.(`[${opts.role}] -> ${c.name}${c.input?.task_id ? ' ' + String(c.input.task_id).slice(0, 8) : ''}`);
        }
        if (Date.now() - lastPost > 30000) { lastPost = Date.now(); void post(); }
      }
      if (m.type === 'result') {
        resultSeen = true;
        sessionId = m.session_id ?? sessionId;
        costUsd = Number(m.total_cost_usd ?? estimateCost(modelSeen, u));
        turns = m.num_turns ?? turns;
        if (!opts.quiet) opts.onLine?.(`[${opts.role}] result: ${m.subtype} cost=$${costUsd.toFixed(4)} turns=${turns}${m.is_error ? ' (error)' : ''}`);
      }
    };
    child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) handle(l); } });
    child.stderr.on('data', (d) => { const s = d.toString(); log.write(`[stderr] ${s}`); if (!opts.quiet && /error|Error/.test(s)) opts.onLine?.(`[${opts.role}] stderr: ${s.trim().slice(0, 300)}`); });

    child.on('close', async (code, signal) => {
      if (buf.trim()) handle(buf.trim());
      const reason = signal ? `signal_${signal}` : (EXIT_REASON[code] ?? `exit_${code}`);
      await post({ cost: costUsd, reason });
      // Exit gate from the daemon side: whatever happened, close the run and release a held lease.
      if (sessionId) { try { await api.post('/hooks/session-end', { session_id: sessionId, hook_event_name: 'SessionEnd', reason: `daemon:${reason}`, baton_session: batonSession }); } catch { /* ignore */ } }
      if (mcpPath) { try { unlinkSync(mcpPath); } catch { /* already gone */ } }
      log.end();
      resolve({ code, signal, reason, sessionId, costUsd, turns, resultSeen, log: logPath });
    });
    child.on('error', (e) => { log.write(`[spawn error] ${e.message}\n`); log.end(); resolve({ code: -1, reason: `spawn_error: ${e.message}`, sessionId, costUsd, turns, log: logPath }); });
  });
}

/** Poll loop. opts: { roles: string[], interval (s), once, cwd, ... spawn opts, log(line) } */
/** One daemon per checkout per machine. Returns a release function, or throws naming the live pid. */
export function acquireDaemonLock(cwd) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const file = join(CONFIG_DIR, `supervise-${createHash('sha1').update(String(cwd).toLowerCase()).digest('hex').slice(0, 12)}.lock`);
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8').trim());
    let alive = false;
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
    if (alive) throw new Error(`another baton supervise (pid ${pid}) is already running for ${cwd}; stop it first or use a different --cwd`);
    try { unlinkSync(file); } catch { /* stale */ }
  }
  const fd = openSync(file, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd);
  const release = () => { try { if (readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file); } catch { /* gone */ } };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { release(); process.exit(130); });
  process.once('exit', release);
  return release;
}

export async function supervise(cfg, opts) {
  const releaseLock = opts.once ? null : acquireDaemonLock(opts.cwd);
  const running = new Map();     // role -> count
  const log = opts.log ?? ((l) => console.log(`${new Date().toISOString()} ${l}`));
  let spawned = 0;
  const tick = async () => {
    for (const role of opts.roles) {
      const token = agentTokenFor(cfg, role);
      if (!token) { log(`no token for role ${role}; run "baton agents add --role ${role}" and store it`); continue; }
      const api = new Api(cfg.serverUrl, token);
      let wa;
      try { wa = await api.get(`/work-available?role=${encodeURIComponent(role)}`); } catch (e) { log(`work-available ${role}: ${e.message}`); continue; }
      if (wa.status !== 200) { log(`work-available ${role}: HTTP ${wa.status} ${JSON.stringify(wa.body).slice(0, 200)}`); continue; }
      // The role's max_concurrent is a fleet-wide cap. This daemon holds one token per role, and one agent
      // identity cannot run two sessions at once (whoami and current_task are per agent), so at most one here.
      const max = Math.min(1, Number(wa.body.max_concurrent ?? 1));
      const cur = running.get(role) ?? 0;
      if (opts.verbose) log(`${role}: ready=${wa.body.ready} questions=${wa.body.questions ?? 0} running=${cur}/${max}`);
      if (!wa.body.available || cur >= max) continue;
      running.set(role, cur + 1); spawned++;
      log(`${role}: work available (${wa.body.ready} ready, ${wa.body.questions ?? 0} questions), spawning agent`);
      const p = spawnAgent({ role, cwd: opts.cwd, token, serverUrl: cfg.serverUrl, model: opts.model, maxTurns: opts.maxTurns,
        budgetUsd: opts.budgetUsd, permissionMode: opts.permissionMode, mcpConfig: opts.mcpConfig, useAgentFlag: opts.useAgentFlag,
        agentName: cfg.agents?.[role]?.name, onLine: log, quiet: opts.quiet, runtime: opts.runtime })
        .then((r) => { running.set(role, (running.get(role) ?? 1) - 1); log(`${role}: agent exited ${r.reason} (session ${r.sessionId ?? '?'}, $${(r.costUsd ?? 0).toFixed(4)}, log ${r.log})`); return r; });
      if (opts.once) return p;
    }
  };
  if (opts.once) {
    const r = await tick();
    if (!r) log('no work available for ' + opts.roles.join(', '));
    return { spawned, result: r ?? null };
  }
  log(`supervising roles ${opts.roles.join(', ')} every ${opts.interval}s (cwd ${opts.cwd})`);
  const maxTicks = opts.maxTicks ?? Infinity;
  try {
    for (let i = 0; i < maxTicks; i++) {
      await tick();
      await new Promise((r) => setTimeout(r, opts.interval * 1000));
    }
  } finally { releaseLock?.(); }
  return { spawned };
}

/** Register the daemon with the OS scheduler. Returns the file or command used. */
/** How to invoke this CLI from a scheduler: the compiled executable itself, or node with the checkout's bin. */
export function selfCommand() {
  if (ASSETS) return `"${process.execPath}"`;
  return `node "${join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'baton.mjs')}"`;
}

export function installService({ roles, cwd, interval }) {
  const roleArg = roles.join(',');
  const self = selfCommand();
  if (process.platform === 'win32') {
    const cmd = `cmd /c "cd /d ${cwd} && ${self} supervise --roles ${roleArg} --interval ${interval} >> ${join(CONFIG_DIR, 'supervise.log')} 2>&1"`;
    const args = ['/Create', '/F', '/SC', 'ONLOGON', '/TN', 'BatonSupervise', '/TR', cmd];
    return { kind: 'schtasks', command: `schtasks ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`, run: () => spawn('schtasks', args, { stdio: 'inherit', shell: false }) };
  }
  if (process.platform === 'darwin') {
    const plist = join(process.env.HOME, 'Library', 'LaunchAgents', 'ai.clane.baton.supervise.plist');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>Label</key><string>ai.clane.baton.supervise</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd ${cwd} && ${self} supervise --roles ${roleArg} --interval ${interval}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${join(CONFIG_DIR, 'supervise.log')}</string><key>StandardErrorPath</key><string>${join(CONFIG_DIR, 'supervise.log')}</string>\n</dict></plist>\n`;
    return { kind: 'launchd', file: plist, body, command: `launchctl load -w ${plist}`, run: () => { writeFileSync(plist, body); return spawn('launchctl', ['load', '-w', plist], { stdio: 'inherit' }); } };
  }
  const dir = join(process.env.HOME, '.config', 'systemd', 'user');
  const unit = join(dir, 'baton-supervise.service');
  const body = `[Unit]\nDescription=Baton supervisor daemon\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${cwd}\nExecStart=/usr/bin/env ${self} supervise --roles ${roleArg} --interval ${interval}\nRestart=always\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n`;
  return { kind: 'systemd', file: unit, body, command: `systemctl --user enable --now baton-supervise`, run: () => { mkdirSync(dir, { recursive: true }); writeFileSync(unit, body); return spawn('systemctl', ['--user', 'enable', '--now', 'baton-supervise'], { stdio: 'inherit' }); } };
}

export function scratchMcpConfigPath() { return join(tmpdir(), 'baton-mcp.json'); }
export { existsSync };
