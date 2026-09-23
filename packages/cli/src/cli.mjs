// Command surface (prd.md section 24).
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from './args.mjs';
import { loadConfig, saveConfig, agentTokenFor, anyAgentToken, CONFIG_PATH } from './config.mjs';
import { Api, must } from './api.mjs';
import { roleDefinition, listBundledRoles, systemPromptFor, runPromptFor, PROTOCOL } from './roles.mjs';
import { supervise, spawnAgent, installService } from './supervise.mjs';
import { sync } from './sync.mjs';
import { redeem, setupRepo, nextSteps } from './join.mjs';
import { loadManifest, compile } from './workflow.mjs';
import { VERSION, ASSETS } from './assets.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function cliVersion() {
  if (VERSION) return VERSION;
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
}

const HELP = `baton <command> [options]

  supervise --roles qa,frontend-dev [--interval 60] [--cwd .] [--once] [--install] [--model m] [--budget 2] [--max-turns 60] [--runtime claude|clane]
  work --role qa [--once] [--cwd .] [--runtime claude|clane]   run one agent session in the foreground
  status                                    agents, claims, lease countdowns, attention list
  tasks ls [--state s] [--role r] [--run k] | show <key> | create --title .. --spec .. --acceptance .. --role .. [--run k] [--affinity machine|agent] [--deadline iso]
        | prioritise <key> <n> | cancel <key> [--reason ..] | approve <key> | reject <key> --reason ..   (operator approval tasks)
  webhooks list | add --url .. [--events a,b*] | remove <id> | flush     event subscriptions for orchestrators
  workflow compile <workflow.json> --run <key> [--input ..] [--affinity m] [--dry-run] | status --run <key> | runs | list
  answer <message-id> "<text>"
  agents add --name qa-01 --role qa [--machine m] [--store] | list | revoke <name>
  invite --roles qa,frontend-dev --name-prefix pilot-1 [--machine m] [--ttl-hours 24] | invite list
  join <invite-code> [--machine m] [--cwd .] [--no-plugin]   one command for a new developer machine
  setup [--cwd .]                            install the plugin and settings into this product repo
  inbox [--follow] [--role r]               messages for this machine's agent (the monitor stream)
  logs [--agent a] [--task k] [--type t] [--follow]
  prompt --role qa [--system]               the run prompt (or the appended system prompt)
  doctor [--role qa] [--cwd .]              verify this machine's setup
  seed --demo                                demo roles and tasks
  env --role qa                              print export lines for BATON_URL and BATON_TOKEN
  headers [--role qa]                        print MCP headers JSON (for headersHelper)
  gate pretool | hook <event>                Claude Code command hooks (stdin JSON in, JSON out)
  sync [--dry-run] [--write-settings] [--cwd .]   reconcile this checkout's plugins with its project profile
  config set <key> <value> | show
  version

Environment: BATON_URL, BATON_OPERATOR_TOKEN, BATON_TOKEN, BATON_ROLE. Config file: ${CONFIG_PATH}`;

function opApi(cfg) {
  if (!cfg.operatorToken) throw new Error('no operator token: set BATON_OPERATOR_TOKEN or "baton config set operatorToken <token>"');
  return new Api(cfg.serverUrl, cfg.operatorToken);
}
function agentApi(cfg, role) {
  const token = role ? agentTokenFor(cfg, role) : anyAgentToken(cfg).token;
  if (!token) throw new Error(`no agent token${role ? ` for role ${role}` : ''}: set BATON_TOKEN or store one with "baton agents add --store"`);
  return new Api(cfg.serverUrl, token);
}
const fmtAgo = (ts) => ts ? `${Math.round((Date.now() - new Date(ts)) / 1000)}s ago` : 'never';
const fmtLeft = (ts) => ts ? `${Math.max(0, Math.round((new Date(ts) - Date.now()) / 60000))}m left` : '';
const table = (rows, cols) => {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join('  '));
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  '));
};
async function readStdin() {
  let s = ''; for await (const chunk of process.stdin) s += chunk; return s;
}

export async function run(argv) {
  const { flags, positional } = parseArgs(argv);
  const [cmd, ...rest] = positional;
  const cfg = loadConfig();
  const cwd = flags.cwd ? String(flags.cwd) : process.cwd();

  switch (cmd) {
    case undefined: case 'help': case '--help': console.log(HELP); return 0;
    case 'version': case '--version': case '-v': console.log(`baton ${cliVersion()}${ASSETS ? ' (standalone)' : ''}`); return 0;

    case 'config': {
      if (rest[0] === 'show') { console.log(JSON.stringify({ ...cfg, operatorToken: cfg.operatorToken ? '(set)' : null, agents: Object.fromEntries(Object.entries(cfg.agents).map(([r, a]) => [r, { name: a.name, token: '(set)' }])) }, null, 2)); return 0; }
      if (rest[0] === 'set' && rest[1]) { cfg[rest[1]] = rest[2]; saveConfig(cfg); console.log(`saved ${rest[1]} to ${CONFIG_PATH}`); return 0; }
      throw new Error('usage: baton config show | set <key> <value>');
    }

    case 'status': {
      const s = must(await opApi(cfg).get('/admin/status'), 'status');
      console.log(`Tasks: ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'}`);
      console.log('\nAgents');
      table(s.agents.map((a) => ({ name: a.name, role: a.role, machine: a.machine, status: a.status, seen: fmtAgo(a.last_seen),
        task: a.current_task ? `${a.current_task.key} ${fmtLeft(a.current_task.lease_until)}` : '' })), ['name', 'role', 'machine', 'status', 'seen', 'task']);
      if (s.attention.length) {
        console.log('\nAttention');
        table(s.attention.map((t) => ({ key: t.key, state: t.state, role: t.role, title: t.title.slice(0, 50),
          question: t.question ? `${t.question.id.slice(0, 8)}… ${t.question.body.slice(0, 60)}` : (t.last_event?.type ?? '') })), ['key', 'state', 'role', 'title', 'question']);
      }
      return 0;
    }

    case 'tasks': {
      const api = opApi(cfg);
      const sub = rest[0] ?? 'ls';
      if (sub === 'ls') {
        const q = new URLSearchParams(); if (flags.state) q.set('state', String(flags.state)); if (flags.role) q.set('role', String(flags.role)); if (flags.run) q.set('workflow_run', String(flags.run));
        const r = must(await api.get(`/admin/tasks?${q}`), 'tasks');
        table(r.tasks.map((t) => ({ key: t.key, state: t.state, role: t.role, pri: t.priority, att: `${t.attempts}/${t.max_attempts}`, cost: Number(t.cost_usd).toFixed(2), assignee: t.assignee_name ?? '', title: t.title.slice(0, 60) })),
          ['key', 'state', 'role', 'pri', 'att', 'cost', 'assignee', 'title']);
        return 0;
      }
      if (sub === 'show') { console.log(JSON.stringify(must(await api.get(`/admin/tasks/${rest[1]}`), 'task'), null, 2)); return 0; }
      if (sub === 'create') {
        const body = { title: flags.title, spec: flags.spec, acceptance: flags.acceptance, role: flags.role, priority: flags.priority ? Number(flags.priority) : undefined,
          produces: flags.produces ? String(flags.produces).split(',').map((k) => ({ kind: k.trim() })) : [],
          consumes: flags.consumes ? String(flags.consumes).split(',').map((k) => ({ kind: k.trim(), from_task: null })) : [],
          scope: flags.scope ? String(flags.scope).split(',') : [], budget_usd: flags.budget ? Number(flags.budget) : undefined, workflow_run: flags.run ? String(flags.run) : undefined,
          affinity: flags.affinity ? String(flags.affinity) : undefined, deadline: flags.deadline ? new Date(String(flags.deadline)).toISOString() : undefined };
        const r = must(await api.post('/admin/tasks', body), 'create');
        console.log(`${r.task.key} ${r.task.state} ${r.task.title}`); return 0;
      }
      if (sub === 'prioritise' || sub === 'prioritize') { console.log(JSON.stringify(must(await api.post(`/admin/tasks/${rest[1]}/prioritise`, { priority: Number(rest[2]) }), 'prioritise'))); return 0; }
      if (sub === 'approve' || sub === 'reject') { console.log(JSON.stringify(must(await api.post(`/admin/tasks/${rest[1]}/approve`, { verdict: sub === 'approve' ? 'approve' : 'reject', reason: flags.reason }), sub))); return 0; }
      if (sub === 'retry') {
        if (!rest[1]) throw new Error('usage: baton tasks retry <key> [--budget n] [--keep-attempts] [--reason ...]');
        const r = must(await api.post(`/admin/tasks/${rest[1]}/retry`, { reset_attempts: !flags['keep-attempts'], budget_usd: flags.budget ? Number(flags.budget) : undefined, reason: flags.reason }), 'retry');
        console.log(`${rest[1]} is back in the queue (${r.state})`); return 0;
      }
      if (sub === 'cancel') { console.log(JSON.stringify(must(await api.post(`/admin/tasks/${rest[1]}/cancel`, { reason: flags.reason }), 'cancel'))); return 0; }
      if (sub === 'force-release') { console.log(JSON.stringify(must(await api.post(`/admin/tasks/${rest[1]}/force-release`), 'force-release'))); return 0; }
      throw new Error('usage: baton tasks ls|show|create|prioritise|cancel|force-release|approve|reject|retry');
    }

    case 'workflow': {
      const sub = rest[0] ?? 'compile';
      if (sub === 'compile') {
        const path = rest[1]; if (!path) throw new Error('usage: baton workflow compile <workflow.json> --run <key> [--input "text"] [--dry-run]');
        const manifest = loadManifest(path);
        const run = flags.run ? String(flags.run) : `${String(manifest.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
        const r = await compile(cfg, manifest, { input: flags.input ? String(flags.input) : '', run, dryRun: !!flags['dry-run'], affinity: flags.affinity ? String(flags.affinity) : undefined });
        console.log(`workflow "${manifest.name}" ${manifest.version ?? ''} -> run ${run}${flags['dry-run'] ? ' (dry run)' : ''}`);
        table(r.tasks.map((t) => ({ node: t.node, role: t.role, task: t.key ?? '-', state: t.state ?? '-', produces: t.produces.join(','), after: t.depends_on.join(','), when: t.when ?? '' })), ['node', 'role', 'task', 'state', 'produces', 'after', 'when']);
        for (const g of r.gateways ?? []) console.log(`gateway ${g.id} ("${g.label}") decides on ${g.from}: ${g.outcomes.join(' | ')}`);
        for (const k of r.skipped) console.log(`skipped ${k.id} (${k.type}): ${k.reason}`);
        if (!flags['dry-run']) console.log(`watch: baton workflow status --run ${run}`);
        return 0;
      }
      if (sub === 'status') {
        const run = String(flags.run ?? rest[1] ?? ''); if (!run) throw new Error('usage: baton workflow status --run <key>');
        const r = must(await opApi(cfg).get(`/admin/workflow-runs/${encodeURIComponent(run)}`), 'run');
        const ts = r.run.steps;
        table(ts.map((t) => ({ key: t.key, state: t.state, role: t.role, att: t.attempts, usd: Number(t.cost_usd).toFixed(2), credits: Number(t.cost_credits).toFixed(0), assignee: t.assignee ?? '', title: t.title.slice(0, 60) })), ['key', 'state', 'role', 'att', 'usd', 'credits', 'assignee', 'title']);
        console.log(`run ${r.run.key} (${r.run.workflow_name ?? '-'}): ${r.run.status}, ${r.run.counts.done ?? 0}/${ts.length} done, ${Number(r.run.cost_usd).toFixed(2)}, ${Number(r.run.cost_credits).toFixed(0)} credits${r.run.finished_at ? ', finished ' + r.run.finished_at : ''}`);
        return 0;
      }
      if (sub === 'runs') {
        const r = must(await opApi(cfg).get('/admin/workflow-runs'), 'runs');
        table(r.runs.map((x) => ({ run: x.key, workflow: x.workflow_name ?? '', status: x.status, done: `${x.counts.done ?? 0}/${Object.values(x.counts).reduce((a, b) => a + Number(b), 0)}`, usd: Number(x.cost_usd).toFixed(2), credits: Number(x.cost_credits).toFixed(0), started: String(x.created_at).slice(0, 16), finished: x.finished_at ? String(x.finished_at).slice(0, 16) : '' })), ['run', 'workflow', 'status', 'done', 'usd', 'credits', 'started', 'finished']);
        return 0;
      }
      if (sub === 'list') {
        const r = must(await opApi(cfg).get('/admin/workflows'), 'workflows');
        table(r.workflows.map((w) => ({ key: w.key, name: w.name, version: w.version, runs: w.runs, updated: String(w.updated_at).slice(0, 16) })), ['key', 'name', 'version', 'runs', 'updated']);
        return 0;
      }
      throw new Error('usage: baton workflow compile|status|runs|list');
    }

    case 'webhooks': {
      const api = opApi(cfg);
      const sub = rest[0] ?? 'list';
      if (sub === 'list') {
        const r = must(await api.get('/admin/webhooks'), 'webhooks');
        table(r.webhooks.map((w) => ({ id: w.id, url: w.url, events: (w.events ?? ['*']).join(','), active: w.active, pending: w.pending, last_sent: w.last_sent ?? '' })), ['id', 'url', 'events', 'active', 'pending', 'last_sent']);
        return 0;
      }
      if (sub === 'add') {
        if (!flags.url) throw new Error('usage: baton webhooks add --url https://host/path [--events task_state_changed,gate_*] [--secret s]');
        const r = must(await api.post('/admin/webhooks', { url: flags.url, events: flags.events, secret: flags.secret }), 'webhooks add');
        console.log(`webhook ${r.webhook.id} -> ${r.webhook.url}\nsecret (shown once; X-Baton-Signature is sha256=HMAC-SHA256(body, secret)):\n\n  ${r.secret}\n`);
        return 0;
      }
      if (sub === 'remove') { must(await api.del(`/admin/webhooks/${rest[1]}`), 'remove'); console.log('removed'); return 0; }
      if (sub === 'flush') { console.log(JSON.stringify(must(await api.post('/admin/webhooks/flush'), 'flush'))); return 0; }
      throw new Error('usage: baton webhooks list|add|remove|flush');
    }

    case 'answer': {
      const r = must(await opApi(cfg).post('/admin/answer', { message_id: rest[0], body: rest.slice(1).join(' ') }), 'answer');
      console.log(`answered; task is now ${r.task_state ?? 'unchanged'}`); return 0;
    }

    case 'agents': {
      const api = opApi(cfg);
      const sub = rest[0] ?? 'list';
      if (sub === 'list') { const r = must(await api.get('/admin/agents'), 'agents'); table(r.agents.map((a) => ({ name: a.name, role: a.role, machine: a.machine, status: a.revoked_at ? 'revoked' : a.status, seen: fmtAgo(a.last_seen), task: a.current_task_key ?? '' })), ['name', 'role', 'machine', 'status', 'seen', 'task']); return 0; }
      if (sub === 'add') {
        const r = must(await api.post('/admin/agents', { name: flags.name, role: flags.role, machine: flags.machine ?? cfg.machine, owner_email: flags.email }), 'agents add');
        console.log(`agent ${r.agent.name} (${r.agent.role}) created. Token, shown once:\n\n  ${r.token}\n`);
        if (flags.store) { cfg.agents[r.agent.role] = { name: r.agent.name, token: r.token }; saveConfig(cfg); console.log(`stored for role ${r.agent.role} in ${CONFIG_PATH}`); }
        return 0;
      }
      if (sub === 'revoke') { console.log(JSON.stringify(must(await api.del(`/admin/agents/${rest[1]}`), 'revoke'))); return 0; }
      throw new Error('usage: baton agents add|list|revoke');
    }

    case 'inbox': {
      const api = agentApi(cfg, flags.role ? String(flags.role) : undefined);
      let since = new Date(Date.now() - 60000).toISOString();
      const seen = new Set();
      const once = async () => {
        const r = await api.get(`/agent/inbox?since=${encodeURIComponent(since)}`);
        if (r.status !== 200) { if (!flags.follow) throw new Error(`inbox: HTTP ${r.status}`); return; }
        for (const m of r.body.messages) {
          if (seen.has(m.id)) continue; seen.add(m.id);
          console.log(`[baton ${m.kind}] from ${m.from_name}${m.task_key ? ` on ${m.task_key}` : ''} (${m.id}): ${m.body}`);
        }
        since = r.body.now ?? since;
      };
      await once();
      if (!flags.follow) return 0;
      const interval = Number(flags.interval ?? 10) * 1000;
      for (;;) { await new Promise((r) => setTimeout(r, interval)); await once(); }
    }

    case 'logs': {
      const api = opApi(cfg);
      let since = flags.since ? String(flags.since) : null;
      const print = (e) => console.log(`${e.ts}  ${(e.agent ?? '-').padEnd(12)} ${(e.task_key ?? '-').padEnd(9)} ${e.type.padEnd(20)} ${JSON.stringify(e.payload).slice(0, 120)}`);
      const fetchOnce = async () => {
        const q = new URLSearchParams(); if (flags.agent) q.set('agent', String(flags.agent)); if (flags.task) q.set('task', String(flags.task)); if (flags.type) q.set('type', String(flags.type)); if (since) q.set('since', since); q.set('limit', String(flags.limit ?? 100));
        const r = must(await api.get(`/admin/events?${q}`), 'events');
        const evs = [...r.events].reverse();
        for (const e of evs) print(e);
        if (evs.length) since = evs[evs.length - 1].ts;
        else if (!since) since = new Date().toISOString();
      };
      await fetchOnce();
      if (!flags.follow) return 0;
      for (;;) { await new Promise((r) => setTimeout(r, 5000)); await fetchOnce(); }
    }

    case 'prompt': {
      const def = roleDefinition(String(flags.role ?? rest[0] ?? ''), cwd);
      console.log(flags.system ? systemPromptFor(def, cfg.agents?.[def.role]?.name) : runPromptFor(def));
      return 0;
    }

    case 'protocol': console.log(PROTOCOL); return 0;

    case 'env': {
      const role = String(flags.role ?? rest[0] ?? anyAgentToken(cfg).role ?? '');
      const token = agentTokenFor(cfg, role);
      if (!token) throw new Error(`no token stored for role ${role || '(none)'}`);
      const ps = process.platform === 'win32' && flags.powershell;
      console.log(ps ? `$env:BATON_URL="${cfg.serverUrl}"\n$env:BATON_TOKEN="${token}"\n$env:BATON_ROLE="${role}"` : `export BATON_URL=${cfg.serverUrl}\nexport BATON_TOKEN=${token}\nexport BATON_ROLE=${role}`);
      return 0;
    }

    case 'headers': {
      // headersHelper for the plugin's MCP server. Claude Code runs it with BATON_ROLE in the
      // environment but strips BATON_TOKEN (it drops secret-looking variables) and does not
      // expand ${VAR} in this field, so the token is looked up by role in ~/.baton/config.json.
      const role = flags.role ? String(flags.role) : (process.env.BATON_ROLE || undefined);
      const passed = typeof flags.token === 'string' && flags.token.startsWith('btn_') ? flags.token : null;
      const token = passed ?? (role ? agentTokenFor(cfg, role) : anyAgentToken(cfg).token);
      // Diagnostics for operators: touch ~/.baton/debug-headers to log how the helper is invoked.
      try {
        const { appendFileSync, existsSync: ex } = await import('node:fs');
        const { join: jn } = await import('node:path');
        const { CONFIG_DIR: dir } = await import('./config.mjs');
        if (ex(jn(dir, 'debug-headers'))) appendFileSync(jn(dir, 'headers-debug.log'), `${new Date().toISOString()} cwd=${process.cwd()} envToken=${!!process.env.BATON_TOKEN} role=${process.env.BATON_ROLE ?? ''} passed=${!!passed} source=${passed ? 'arg' : process.env.BATON_TOKEN ? 'env' : 'config'}\n`);
      } catch { /* diagnostics only */ }
      if (!token) throw new Error('no agent token available');
      console.log(JSON.stringify({ Authorization: `Bearer ${token}` }));
      return 0;
    }

    case 'gate': {
      // PreToolUse command hook. Fails closed: any failure to reach the server is a deny (prd.md 21.2, decision 10).
      const input = JSON.parse((await readStdin()) || '{}');
      if (!input.session_id && process.env.BATON_SESSION) input.session_id = process.env.BATON_SESSION;
      if (!input.cwd) input.cwd = process.cwd();
      if (input.tool_input && typeof input.tool_input === 'object' && !input.tool_input.file_path) {
        const p = input.tool_input.path ?? input.tool_input.filePath ?? input.tool_input.target ?? null;
        if (typeof p === 'string') input.tool_input.file_path = p.match(/^([a-zA-Z]:)?[\/]/) ? p : join(input.cwd, p);
      }
      const token = process.env.BATON_TOKEN ?? anyAgentToken(cfg).token;
      const deny = (reason) => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })); return 0; };
      if (!token) return deny('No Baton token on this machine. The lease gate cannot verify a lease, so the write is denied.');
      try {
        const r = await new Api(cfg.serverUrl, token).post(`/gate/${rest[0] ?? 'pretool'}`, input, { timeoutMs: 10000 });
        if (r.status !== 200) return deny(`Baton gate unavailable (HTTP ${r.status}). Writes are denied until the server is reachable.`);
        console.log(JSON.stringify(r.body)); return 0;
      } catch (e) { return deny(`Baton gate unreachable (${e.message}). Writes are denied until the server is reachable.`); }
    }

    case 'hook': {
      // Any other hook event, forwarded. Never blocks the agent on failure, except Stop which honours the server's block.
      const input = JSON.parse((await readStdin()) || '{}');
      const token = process.env.BATON_TOKEN ?? anyAgentToken(cfg).token;
      if (!token) { console.log('{}'); return 0; }
      try {
        const r = await new Api(cfg.serverUrl, token).post(`/hooks/${rest[0]}`, input, { timeoutMs: 10000 });
        console.log(JSON.stringify(r.status === 200 ? r.body : {})); return 0;
      } catch { console.log('{}'); return 0; }
    }

    case 'work': {
      const role = String(flags.role ?? rest[0] ?? '');
      if (!role) throw new Error('usage: baton work --role <role> [--once]');
      const token = agentTokenFor(cfg, role);
      if (!token) throw new Error(`no token for role ${role}`);
      const r = await spawnAgent({ role, cwd, token, serverUrl: cfg.serverUrl, model: flags.model, maxTurns: flags['max-turns'], budgetUsd: flags.budget,
        permissionMode: flags['permission-mode'], mcpConfig: flags['mcp-config'] !== false, useAgentFlag: !!flags.agent, agentName: cfg.agents?.[role]?.name, onLine: (l) => console.log(l),
        runtime: flags.runtime ? String(flags.runtime) : cfg.defaults.runtime });
      console.log(`exit ${r.code} (${r.reason}) session=${r.sessionId ?? '?'} cost=$${(r.costUsd ?? 0).toFixed(4)} log=${r.log}`);
      return r.code === 0 ? 0 : 1;
    }

    case 'supervise': {
      const roles = String(flags.roles ?? flags.role ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!roles.length) throw new Error('usage: baton supervise --roles qa,frontend-dev');
      const interval = Number(flags.interval ?? cfg.defaults.interval ?? 60);
      if (flags.install) {
        const svc = installService({ roles, cwd, interval });
        if (flags['dry-run']) { console.log(svc.command); if (svc.body) console.log(svc.body); return 0; }
        console.log(`installing ${svc.kind}: ${svc.command}`);
        await new Promise((res) => svc.run().on('close', res));
        return 0;
      }
      if (flags.sync !== false && cfg.operatorToken) { try { await sync(cfg, { cwd, quiet: true }); } catch (e) { console.log(`sync skipped: ${e.message}`); } }
      const r = await supervise(cfg, { roles, interval, cwd, once: !!flags.once, model: flags.model, maxTurns: flags['max-turns'], budgetUsd: flags.budget,
        permissionMode: flags['permission-mode'], mcpConfig: flags['mcp-config'] !== false, useAgentFlag: !!flags.agent, verbose: !!flags.verbose,
        quiet: !!flags.quiet, maxTicks: flags['max-ticks'] ? Number(flags['max-ticks']) : undefined, runtime: flags.runtime ? String(flags.runtime) : cfg.defaults.runtime });
      if (flags.once) return r.result ? (r.result.code === 0 ? 0 : 1) : 0;
      return 0;
    }

    case 'doctor': return runDoctor(cfg, { role: flags.role ? String(flags.role) : undefined, cwd });

    case 'invite': {
      const api = opApi(cfg);
      if (rest[0] === 'list') {
        const r = must(await api.get('/admin/invites'), 'invites');
        table(r.invites.map((i) => ({ id: i.id.slice(0, 8), roles: i.roles.join(','), prefix: i.name_prefix, machine: i.machine ?? '', expires: i.expires_at.slice(0, 16), redeemed: i.redeemed_at ? `${i.redeemed_at.slice(0, 16)} from ${i.redeemed_from ?? '?'}` : '' })), ['id', 'roles', 'prefix', 'machine', 'expires', 'redeemed']);
        return 0;
      }
      if (!flags.roles || !flags['name-prefix']) throw new Error('usage: baton invite --roles qa,frontend-dev --name-prefix pilot-1 [--machine m] [--ttl-hours 24]');
      const r = must(await api.post('/admin/invites', { roles: String(flags.roles), name_prefix: String(flags['name-prefix']), machine: flags.machine, ttl_hours: flags['ttl-hours'], project_key: flags.project }), 'invite');
      console.log(`invite for ${r.invite.roles.join(', ')} as ${r.invite.name_prefix}-<role>, expires ${r.invite.expires_at}. Code, shown once:

  ${r.code}

On the developer machine, inside the product repo:
  baton join ${r.code}`);
      return 0;
    }

    case 'join': {
      const code = rest[0];
      if (!code) throw new Error('usage: baton join <invite-code> [--machine name] [--cwd .] [--no-plugin]');
      const r = await redeem(cfg, code, { machine: flags.machine ? String(flags.machine) : undefined, serverUrl: flags.server ? String(flags.server) : undefined });
      const roles = Object.keys(r.agents);
      console.log(`joined as ${roles.map((x) => `${r.agents[x].name} (${x})`).join(', ')} on machine ${r.machine}; tokens saved to ${CONFIG_PATH}`);
      if (flags.plugin !== false) for (const line of setupRepo(cwd)) console.log(line);
      const code2 = await runDoctor(loadConfig(), { role: roles[0], cwd });
      console.log(nextSteps(roles, cwd));
      return code2;
    }

    case 'setup': {
      for (const line of setupRepo(cwd)) console.log(line);
      return 0;
    }


    case 'seed': {
      const api = opApi(cfg);
      const roles = [
        ['analyst', 'Turns a user story into a task_spec.', 'sonnet'], ['ui-designer', 'Turns a task_spec into a design_spec.', 'sonnet'],
        ['frontend-dev', 'Builds UI from a design_spec and api_contract into a PR and build.', 'sonnet'], ['backend-dev', 'Builds APIs and migrations from a task_spec.', 'sonnet'],
        ['ai-dev', 'Builds AI services against an api_contract.', 'sonnet'], ['qa', 'Runs the test suite against a build and produces a test_report.', 'sonnet'], ['reviewer', 'Reviews a PR and produces a review.', 'sonnet'],
      ];
      for (const [name, description, model] of roles) must(await api.post('/admin/roles', { name, description, default_model: model, definition_path: `.claude/agents/${name}.md` }), `role ${name}`);
      if (flags.demo) {
        const t1 = must(await api.post('/admin/tasks', { title: 'Write the task spec for the login page', role: 'analyst', priority: 200, produces: [{ kind: 'task_spec' }],
          spec: 'Read the user story for the login page and write a complete task_spec covering fields, validation, error states and the API the page needs.',
          acceptance: 'Given the user story, when the analyst finishes, then a task_spec artefact exists that lists every field, validation rule and API call.' }), 'task 1');
        must(await api.post('/admin/tasks', { title: 'Build the login page', role: 'frontend-dev', priority: 150, depends_on: [t1.task.id], consumes: [{ kind: 'task_spec', from_task: t1.task.id }], produces: [{ kind: 'pr' }, { kind: 'build' }],
          spec: 'Implement the login page in the Next.js app according to the task_spec.', acceptance: 'Given the task_spec, when the page is built, then a PR exists and the build artefact is registered.', scope: ['app/**', 'components/**'] }), 'task 2');
        must(await api.post('/admin/tasks', { title: 'Smoke test the login build', role: 'qa', priority: 100, consumes: [{ kind: 'build', from_task: null }], produces: [{ kind: 'test_report' }],
          spec: 'Run the smoke suite against the latest build artefact and report.', acceptance: 'Given a build, when the suite runs, then a test_report artefact records pass and fail counts.' }), 'task 3');
        console.log('seeded 7 roles and 3 demo tasks');
      } else console.log('seeded 7 roles');
      return 0;
    }

    case 'roles': { console.log(listBundledRoles().join('\n')); return 0; }

    case 'sync': {
      const r = await sync(cfg, { cwd, dryRun: !!flags['dry-run'], writeSettings: !!flags['write-settings'] });
      if (!r.project) { console.log(r.message); return 0; }
      console.log(`project ${r.project.key} (${r.project.repo}) ref ${r.project.marketplace_ref}`);
      if (!r.actions.length) console.log('no drift');
      for (const a of r.actions) console.log(`${r.dryRun ? 'would ' : ''}${a.summary}${a.error ? ` -> ${a.error}` : ''}`);
      return 0;
    }

    default:
      throw new Error(`unknown command "${cmd}". Run "baton help".`);
  }
}

/** The checks behind `baton doctor`; also run at the end of `baton join`. Returns the exit code. */
async function runDoctor(cfg, { role: roleArg, cwd }) {
  const checks = [];
  const ok = (name, detail) => checks.push({ name, ok: true, detail });
  const bad = (name, detail) => checks.push({ name, ok: false, detail });
  try { const v = execSync('claude --version', { encoding: 'utf8' }).trim(); ok('claude on PATH', v); } catch { bad('claude on PATH', 'not found'); }
  ok('node', process.version);
  const health = await new Api(cfg.serverUrl, null).get('/health').catch((e) => ({ status: 0, body: { error: { message: e.message } } }));
  health.status === 200 ? ok('server reachable', cfg.serverUrl) : bad('server reachable', `${cfg.serverUrl}: ${health.body?.error?.message ?? health.status}`);
  const role = roleArg ?? anyAgentToken(cfg).role;
  const token = role ? agentTokenFor(cfg, role) : anyAgentToken(cfg).token;
  if (token) {
    const me = await new Api(cfg.serverUrl, token).tool('whoami');
    if (me.ok) { ok('agent token valid', `${me.agent.name} (${me.agent.role})`); if (role && me.agent.role !== role) bad('role matches token', `token is for ${me.agent.role}, expected ${role}`); else ok('role matches token', me.agent.role); }
    else bad('agent token valid', me.error?.message ?? 'rejected');
    const list = await new Api(cfg.serverUrl, token).request('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const n = list.body?.result?.tools?.length ?? 0; n >= 16 ? ok('MCP tools resolve', `${n} tools`) : bad('MCP tools resolve', `${n} tools`);
  } else bad('agent token', `none for ${role ?? 'any role'} (BATON_TOKEN or ${CONFIG_PATH})`);
  if (cfg.operatorToken) { const s = await opApi(cfg).get('/admin/status'); s.status === 200 ? ok('operator token valid', 'admin API reachable') : bad('operator token valid', `HTTP ${s.status}`); }
  else checks.push({ name: 'operator token', ok: true, detail: 'not set (optional on agent machines)' });
  if (role) { try { const d = roleDefinition(role, cwd); ok('role definition', `${d.source}: ${d.path}`); } catch (e) { bad('role definition', e.message); } }
  const settings = join(cwd, '.claude', 'settings.json');
  let gates = 'none';
  if (existsSync(settings)) { try { const s = JSON.parse(readFileSync(settings, 'utf8')); const h = s.hooks ?? {}; gates = ['PreToolUse', 'Stop', 'SessionEnd', 'SessionStart'].filter((k) => h[k]).join(',') || 'none'; } catch { gates = 'unparseable settings.json'; } }
  const pluginGates = existsSync(join(cwd, '.claude', 'settings.json')) && /baton-core/.test(readFileSync(settings, 'utf8'));
  (gates !== 'none' || pluginGates) ? ok('gates registered', pluginGates ? 'via baton-core plugin' : gates) : bad('gates registered', `no hooks in ${settings}`);
  if (cfg.operatorToken) { try { const drift = await sync(cfg, { cwd, dryRun: true, quiet: true }); drift.actions.length ? bad('project profile in sync', `${drift.actions.length} change(s): ${drift.actions.map((a) => a.summary).join('; ')}`) : ok('project profile in sync', drift.project ? drift.project.key : 'no profile for this checkout'); } catch (e) { checks.push({ name: 'project profile', ok: true, detail: `skipped: ${e.message}` }); } }
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(26)} ${c.detail ?? ''}`);
  return checks.every((c) => c.ok) ? 0 : 1;
}
