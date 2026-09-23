// Hook face and gates over HTTP, simulating Claude Code hook payloads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, task, sleep } from './helpers.mjs';

const URL_ = process.env.BATON_URL;
const OP = process.env.BATON_OPERATOR_TOKEN;
const AG = process.env.BATON_TEST_AGENT_TOKEN;
let agentId;
const SESSION = `hooktest-${Date.now()}`;

async function hook(event, payload) {
  const r = await fetch(`${URL_}/hooks/${event}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: SESSION, cwd: 'C:\\work\\repo', transcript_path: 'C:\\t.jsonl', hook_event_name: event, ...payload }),
  });
  return { status: r.status, body: await r.json() };
}
async function gate(payload) {
  const r = await fetch(`${URL_}/gate/pretool`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: SESSION, cwd: 'C:\\work\\repo', hook_event_name: 'PreToolUse', ...payload }),
  });
  return await r.json();
}
async function tool(name, args = {}) {
  const r = await fetch(`${URL_}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return (await r.json()).result.structuredContent;
}

before(async () => {
  await reset();
  await role('qa');
  const { rows } = await q(
    `insert into baton.agents (name, role, machine, token_hash) values ('hook-qa-1', 'qa', 'test', encode(sha256(convert_to($1, 'UTF8')), 'hex')) returning id`,
    [AG],
  );
  agentId = rows[0].id;
});
after(() => pool.end());

test('session-start creates a run, logs the event and injects the task line', async () => {
  const r = await hook('session-start', { source: 'startup' });
  assert.equal(r.status, 200);
  assert.equal(r.body.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(r.body.hookSpecificOutput.additionalContext, /hold no task/);
  const run = await q(`select id, task_id from baton.runs where session_id = $1`, [SESSION]);
  assert.equal(run.rows.length, 1);
  assert.equal(run.rows[0].task_id, null);
});

test('AT21: a Write with no lease is denied and a no_lease event records the path', async () => {
  const r = await gate({ tool_name: 'Write', tool_input: { file_path: 'C:\\work\\repo\\src\\a.ts', content: 'x' } });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /No active Baton lease/);
  const ev = await q(`select payload from baton.events where type = 'no_lease' and session_id = $1`, [SESSION]);
  assert.equal(ev.rows.length, 1);
  assert.equal(ev.rows[0].payload.path, 'C:\\work\\repo\\src\\a.ts');
  assert.equal(ev.rows[0].payload.tool, 'Write');
});

test('stop gate lets a session with no task stop', async () => {
  const r = await hook('turn-end', { stop_hook_active: false });
  assert.deepEqual(r.body, {});
});

test('AT11: after claiming, tool events correlate to the run and task, earlier events back-filled', async () => {
  const t = await task({ role: 'qa', scope: ['src/**', 'tests/**'] });
  const next = await tool('task_next');
  assert.equal(next.task.id, t.id);
  const r = await hook('tool', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, tool_response: 'ok' });
  assert.equal(r.body.task_id, t.id);
  const run = await q(`select task_id from baton.runs where session_id = $1`, [SESSION]);
  assert.equal(run.rows[0].task_id, t.id);
  const ev = await q(`select type, task_id from baton.events where session_id = $1 order by id`, [SESSION]);
  assert.ok(ev.rows.some((e) => e.type === 'session_start' && e.task_id === t.id), 'session_start back-filled');
  assert.ok(ev.rows.some((e) => e.type === 'tool' && e.task_id === t.id));
});

test('gate allows writes inside scope and denies outside with a scope_violation event', async () => {
  const ok = await gate({ tool_name: 'Write', tool_input: { file_path: 'C:\\work\\repo\\src\\deep\\b.ts' } });
  assert.deepEqual(ok, {});
  const bad = await gate({ tool_name: 'Edit', tool_input: { file_path: 'C:\\work\\repo\\service\\main.py' } });
  assert.equal(bad.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(bad.hookSpecificOutput.permissionDecisionReason, /outside the scope/);
  const ev = await q(`select payload from baton.events where type = 'scope_violation' and session_id = $1`, [SESSION]);
  assert.equal(ev.rows[0].payload.path, 'service/main.py');
  const bash = await gate({ tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(bash, {}, 'Bash with a lease passes the lease gate (scope not path-checkable)');
});

test('AT22: stop gate blocks while the task is open, and is capped after three blocks', async () => {
  for (let i = 1; i <= 3; i++) {
    const r = await hook('turn-end', { stop_hook_active: false });
    assert.equal(r.body.decision, 'block', `block ${i}`);
    assert.match(r.body.reason, /open task TSK-/);
  }
  const fourth = await hook('turn-end', { stop_hook_active: false });
  assert.deepEqual(fourth.body, {});
  const ex = await q(`select count(*)::int as n from baton.events where type = 'stop_gate_exhausted' and session_id = $1`, [SESSION]);
  assert.equal(ex.rows[0].n, 1);
});

test('AT12: an API key shaped string in a tool payload is stored as [redacted]', async () => {
  await hook('tool', { tool_name: 'Bash', tool_input: { command: 'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 && curl -H "Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" x' },
    tool_response: 'DATABASE_URL=postgres://user:pass@host:5432/db and token btn_0123456789abcdef0123456789abcdef01234567' });
  const ev = await q(`select payload from baton.events where type = 'tool' and session_id = $1 order by id desc limit 1`, [SESSION]);
  const s = JSON.stringify(ev.rows[0].payload);
  assert.ok(!s.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), 'openai key leaked');
  assert.ok(!s.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), 'github token leaked');
  assert.ok(!s.includes('postgres://user:pass'), 'connection string leaked');
  assert.ok(!s.includes('btn_0123456789abcdef0123456789abcdef01234567'), 'baton token leaked');
  assert.ok(s.includes('[redacted]'));
});

test('prompt hook injects new messages as context', async () => {
  const me = await q(`select id from baton.agents where id = $1`, [agentId]);
  await q(`insert into baton.messages (to_agent, kind, body) values ($1, 'notice', 'Priority changed, check the board')`, [me.rows[0].id]);
  const r = await hook('prompt', { prompt: 'continue' });
  assert.equal(r.body.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(r.body.hookSpecificOutput.additionalContext, /Priority changed/);
  const again = await hook('prompt', { prompt: 'continue' });
  assert.deepEqual(again.body, {});
});

test('AT13: task_ask leaves the task blocked; an operator answer readies it and the next session sees the answer', async () => {
  const next = await tool('whoami');
  const taskId = next.current_task.id;
  const asked = await tool('task_ask', { task_id: taskId, question: 'Which node version?' });
  assert.equal(asked.state, 'blocked');
  await hook('session-end', { reason: 'other' });
  assert.equal((await q(`select state from baton.tasks where id = $1`, [taskId])).rows[0].state, 'blocked');

  const ans = await fetch(`${URL_}/admin/answer`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${OP}` },
    body: JSON.stringify({ message_id: asked.message_id, body: 'Node 22' }) });
  assert.equal((await ans.json()).task_state, 'ready');

  const r = await fetch(`${URL_}/hooks/session-start`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: `${SESSION}-2`, hook_event_name: 'SessionStart', source: 'startup' }) });
  const ctx = (await r.json()).hookSpecificOutput.additionalContext;
  assert.match(ctx, /answer from operator .*Node 22/);
});

test('AT14: usage posted from turn ends accumulates onto the task; over budget moves it to needs_human', async () => {
  const t = await task({ role: 'qa', budget_usd: 0.5, priority: 1000 });
  const next = await tool('task_next');
  assert.equal(next.task.id, t.id);
  const sess = `${SESSION}-3`;
  const post = (cost) => fetch(`${URL_}/runs/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: sess, task_id: t.id, tokens_in: 100, tokens_out: 50, cost_usd: cost, model: 'haiku' }) });
  await post(0.2);
  let row = (await q(`select cost_usd, state from baton.tasks where id = $1`, [t.id])).rows[0];
  assert.equal(Number(row.cost_usd), 0.2);
  assert.equal(row.state, 'in_progress');
  await post(0.6);
  row = (await q(`select cost_usd, state from baton.tasks where id = $1`, [t.id])).rows[0];
  assert.equal(Number(row.cost_usd), 0.6);
  assert.equal(row.state, 'needs_human');
  const hb = await tool('task_heartbeat', { task_id: t.id });
  assert.equal(hb.error.code, 'LEASE_LOST');
});

test('AT24: a file edited by a session with no claim appears in the conformance report', async () => {
  const sess = `${SESSION}-shadow`;
  // No task held (previous tests released everything); an Edit reported by PostToolUse is shadow work.
  const r = await fetch(`${URL_}/hooks/tool`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: sess, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\work\\repo\\src\\rogue.ts', old_string: 'a', new_string: 'b' }, cwd: 'C:\\work\\repo' }) });
  assert.equal((await r.json()).task_id, null);
  const rep = await fetch(`${URL_}/admin/conformance?days=1`, { headers: { authorization: `Bearer ${OP}` } }).then((x) => x.json());
  const hit = rep.live.shadow_edits.find((e) => e.session_id === sess);
  assert.ok(hit, JSON.stringify(rep.live.shadow_edits).slice(0, 300));
  assert.equal(hit.path, 'C:\\work\\repo\\src\\rogue.ts');
  assert.equal(hit.tool, 'Edit');
  assert.ok(rep.live.no_lease_denials.length >= 1, 'the earlier denied Write is in the report too');
  assert.ok(rep.live.scope_violations.length >= 1);
  // The daily job stores yesterday's report; run it and check a row exists and an event was written.
  const run = await fetch(`${URL_}/admin/conformance/run`, { method: 'POST', headers: { authorization: `Bearer ${OP}` } }).then((x) => x.json());
  assert.equal(run.ok, true);
  const stored = await q(`select count(*)::int as n from baton.conformance_reports`);
  assert.ok(stored.rows[0].n >= 1);
});

test('session-end releases a held lease (exit gate)', async () => {
  const t = await task({ role: 'qa', priority: 1000 });
  const next = await tool('task_next');
  assert.equal(next.task.id, t.id);
  const r = await hook('session-end', { reason: 'exit' });
  assert.equal(r.body.released_task, t.id);
  const row = (await q(`select state, assignee from baton.tasks where id = $1`, [t.id])).rows[0];
  assert.equal(row.state, 'ready');
  assert.equal(row.assignee, null);
  await sleep(100);
});
