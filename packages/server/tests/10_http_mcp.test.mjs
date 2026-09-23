// HTTP tests against the deployed edge function. Needs BATON_URL, BATON_OPERATOR_TOKEN,
// BATON_TEST_AGENT_TOKEN in .env. The test agent "http-qa-1" (role qa) must exist with that token's hash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q, reset, role, task, sleep } from './helpers.mjs';

const URL_ = process.env.BATON_URL;
const OP = process.env.BATON_OPERATOR_TOKEN;
const AG = process.env.BATON_TEST_AGENT_TOKEN;
const AGENT_NAME = 'http-qa-1';
let agentId;

async function rpc(token, method, params = {}, id = 1) {
  const r = await fetch(`${URL_}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
}
async function tool(name, args = {}) {
  const { status, body } = await rpc(AG, 'tools/call', { name, arguments: args });
  assert.equal(status, 200, JSON.stringify(body));
  return body.result.structuredContent;
}
async function admin(method, path, body) {
  const r = await fetch(`${URL_}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${OP}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  await reset();
  await role('qa'); await role('ui-designer');
  // Test agent with the known token hash; the operator row is created once outside the tests.
  const { rows } = await q(
    `insert into baton.agents (name, role, machine, token_hash) values ($1, 'qa', 'test', encode(sha256(convert_to($2, 'UTF8')), 'hex')) returning id`,
    [AGENT_NAME, AG],
  );
  agentId = rows[0].id;
});
after(() => pool.end());

test('health responds', async () => {
  const r = await fetch(`${URL_}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('MCP initialize, tools/list and ping work with an agent token', async () => {
  const init = await rpc(AG, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'baton');
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  const note = await rpc(AG, 'notifications/initialized');
  assert.equal(note.status, 202);
  const list = await rpc(AG, 'tools/list');
  const names = list.body.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['answer', 'artifact_get', 'artifact_put', 'board', 'broadcast', 'decision_log', 'inbox', 'task_ask',
    'task_create', 'task_heartbeat', 'task_next', 'task_progress', 'task_release', 'task_split', 'task_submit', 'whoami'].sort());
  assert.deepEqual((await rpc(AG, 'ping')).body.result, {});
});

test('AT7: a bad token is rejected and the rejection is logged as an event', async () => {
  const before = (await q(`select count(*)::int as n from baton.events where type = 'auth_rejected'`)).rows[0].n;
  const r = await rpc('btn_not_a_real_token', 'tools/list');
  assert.equal(r.status, 401);
  await sleep(300);
  const after = (await q(`select count(*)::int as n from baton.events where type = 'auth_rejected'`)).rows[0].n;
  assert.equal(after, before + 1);
});

test('AT7b: a revoked agent token is rejected with the agent recorded on the event', async () => {
  await q(`update baton.agents set revoked_at = now() where id = $1`, [agentId]);
  try {
    const r = await rpc(AG, 'tools/list');
    assert.equal(r.status, 401);
    await sleep(300);
    const ev = await q(`select agent_id, payload from baton.events where type = 'auth_rejected' order by id desc limit 1`);
    assert.equal(ev.rows[0].agent_id, agentId);
    assert.equal(ev.rows[0].payload.reason, 'revoked agent token');
  } finally {
    await q(`update baton.agents set revoked_at = null where id = $1`, [agentId]);
  }
});

test('whoami then task_next claims a task; whoami then shows it', async () => {
  const me = await tool('whoami');
  assert.equal(me.agent.name, AGENT_NAME);
  assert.equal(me.current_task, null);
  await task({ role: 'ui-designer' });
  const t = await task({ role: 'qa', consumes: [{ kind: 'design_spec', from_task: null }] });
  assert.equal((await tool('task_next')).none, true, 'unsatisfied consumes must not be claimable');
  const t2 = await task({ role: 'qa', title: 'plain', produces: [{ kind: 'test_report' }] });
  const next = await tool('task_next', { lease_seconds: 600 });
  assert.equal(next.task.id, t2.id);
  assert.deepEqual(next.outputs, ['test_report']);
  const me2 = await tool('whoami');
  assert.equal(me2.current_task.id, t2.id);
  assert.equal((await tool('task_heartbeat', { task_id: t2.id })).ok, true);
  assert.equal((await tool('task_progress', { task_id: t2.id, note: 'started', pct: 10 })).ok, true);
  void t;
});

test('AT8 over HTTP: heartbeat after the reaper returns LEASE_LOST', async () => {
  const me = await tool('whoami');
  const id = me.current_task.id;
  await q(`update baton.tasks set lease_until = now() - interval '1 second' where id = $1`, [id]);
  await q(`select baton.reap_leases()`);
  const r = await tool('task_heartbeat', { task_id: id });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'LEASE_LOST');
});

test('artifact_put uploads content to storage and artifact_get returns it with a signed URL', async () => {
  const next = await tool('task_next');
  assert.ok(next.task, JSON.stringify(next));
  const put = await tool('artifact_put', { task_id: next.task.id, kind: 'test_report', content: { passed: 2, failed: 0, summary: 'two passed' } });
  assert.equal(put.ok, true, JSON.stringify(put));
  assert.match(put.uri, /^storage:\/\/artifacts\/TSK-\d+\/test_report-\d+\.json$/);
  // make qa entitled to read test_report by creating a task that consumes it
  await task({ role: 'qa', state: 'draft', consumes: [{ kind: 'test_report', from_task: null }] });
  const got = await tool('artifact_get', { kind: 'test_report' });
  assert.equal(got.artifacts.length, 1);
  assert.deepEqual(got.artifacts[0].content, { passed: 2, failed: 0, summary: 'two passed' });
  assert.match(got.artifacts[0].signed_url, /^https:\/\/.+\/storage\/v1\/object\/sign\/artifacts\//);
  const blob = await fetch(got.artifacts[0].signed_url);
  assert.equal(blob.status, 200);
  assert.deepEqual(await blob.json(), { passed: 2, failed: 0, summary: 'two passed' });
  const sub = await tool('task_submit', { task_id: next.task.id });
  assert.equal(sub.state, 'done');
});

test('idempotency key replays the first result', async () => {
  const t = await task({ role: 'qa', priority: 1000 });
  const a = await tool('task_next', { idempotency_key: 'k1' });
  const b = await tool('task_next', { idempotency_key: 'k1' });
  assert.equal(a.task.id, t.id);
  assert.equal(b.task.id, t.id);
  assert.equal(b.idempotent_replay, true);
  assert.equal((await tool('task_release', { task_id: t.id, reason: 'test' })).ok, true);
  await q(`update baton.tasks set state = 'cancelled' where id = $1`, [t.id]);
});

test('an agent token cannot use admin routes; an operator token can', async () => {
  const r = await fetch(`${URL_}/admin/status`, { headers: { authorization: `Bearer ${AG}` } });
  assert.equal(r.status, 403);
  const s = await admin('GET', '/admin/status');
  assert.equal(s.status, 200);
  assert.ok(Array.isArray(s.body.agents));
});

test('operator lifecycle: create agent, work-available, force-release, cancel, prioritise, revoke', async () => {
  const created = await admin('POST', '/admin/agents', { name: 'http-qa-2', role: 'qa', machine: 'test' });
  assert.equal(created.body.ok, true, JSON.stringify(created.body));
  assert.match(created.body.token, /^btn_[0-9a-f]{40}$/);
  const w = await fetch(`${URL_}/work-available?role=qa`, { headers: { authorization: `Bearer ${created.body.token}` } });
  const wa = await w.json();
  assert.equal(typeof wa.available, 'boolean');

  const t = await task({ role: 'qa', priority: 1000 });
  const next = await tool('task_next');
  assert.equal(next.task.id, t.id);
  const fr = await admin('POST', `/admin/tasks/${t.key}/force-release`);
  assert.equal(fr.body.state, 'ready');
  const pr = await admin('POST', `/admin/tasks/${t.id}/prioritise`, { priority: 999 });
  assert.equal(pr.body.priority, 999);
  const detail = await admin('GET', `/admin/tasks/${t.key}`);
  assert.equal(detail.body.task.priority, 999);
  assert.ok(detail.body.events.some((e) => e.type === 'task_force_released'));
  const c = await admin('POST', `/admin/tasks/${t.id}/cancel`, { reason: 'test over' });
  assert.equal(c.body.state, 'cancelled');
  const rv = await admin('DELETE', `/admin/agents/http-qa-2`);
  assert.equal(rv.body.ok, true);
  const again = await fetch(`${URL_}/work-available?role=qa`, { headers: { authorization: `Bearer ${created.body.token}` } });
  assert.equal(again.status, 401);
});

test('operator can answer a question asked over MCP', async () => {
  const t = await task({ role: 'qa', priority: 1000 });
  await tool('task_next');
  const asked = await tool('task_ask', { task_id: t.id, question: 'Which env?' });
  const list = await admin('GET', '/admin/messages?unanswered=1');
  assert.ok(list.body.messages.some((m) => m.id === asked.message_id));
  const ans = await admin('POST', '/admin/answer', { message_id: asked.message_id, body: 'staging' });
  assert.equal(ans.body.task_state, 'ready');
  const inbox = await tool('inbox');
  assert.ok(inbox.messages.some((m) => m.kind === 'answer' && m.body === 'staging' && m.in_reply_to === asked.message_id),
    JSON.stringify(inbox.messages));
  const usage = await fetch(`${URL_}/runs/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AG}` },
    body: JSON.stringify({ session_id: 'http-sess-1', task_id: t.id, tokens_in: 10, tokens_out: 5, cost_usd: 0.01 }) });
  assert.equal((await usage.json()).ok, true);
  const spend = await admin('GET', '/admin/spend');
  assert.ok(Number(spend.body.total_usd) >= 0.01);
});
