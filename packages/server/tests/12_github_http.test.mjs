// GitHub face over HTTP with signed, simulated webhooks (acceptance 19 and 20).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { pool, q, reset, role, agent, task, claim, taskRow } from './helpers.mjs';

const URL_ = process.env.BATON_URL;
const OP = process.env.BATON_OPERATOR_TOKEN;
const SECRET = process.env.BATON_GH_WEBHOOK_SECRET;
const REPO = 'clane-ai/scratch';

async function webhook(event, payload, secret = SECRET) {
  const body = JSON.stringify(payload);
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const r = await fetch(`${URL_}/gh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sig, 'x-github-delivery': `t-${Date.now()}` }, body });
  return { status: r.status, body: await r.json() };
}
const j = async (sql, params) => (await q(sql, params)).rows[0].r;

before(async () => { await reset(); await role('frontend-dev'); });
after(() => pool.end());

test('a webhook with a bad signature is rejected and logged', async () => {
  const r = await webhook('ping', { zen: 'x', repository: { full_name: REPO } }, 'wrong');
  assert.equal(r.status, 401);
  const ev = await q(`select count(*)::int as n from baton.events where type = 'gh_webhook_rejected'`);
  assert.ok(ev.rows[0].n >= 1);
});

test('AT19: a task producing a pr only becomes done after the check reports success', async () => {
  const a = await agent('fe-1', 'frontend-dev');
  const t = await task({ role: 'frontend-dev', produces: [{ kind: 'pr' }] });
  await claim(a);
  const sub = await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'pr', uri: `https://github.com/${REPO}/pull/7`, meta: { repo: REPO, number: 7, head_sha: 'abc123', branch: 'baton/x' } },
  ])]);
  assert.deepEqual(sub, { ok: true, state: 'review', pending: 'ci' });
  assert.equal((await taskRow(t.id)).state, 'review');

  const pending = await webhook('check_suite', { action: 'requested', check_suite: { head_sha: 'abc123', conclusion: null }, repository: { full_name: REPO } });
  assert.equal(pending.status, 200);
  assert.equal((await taskRow(t.id)).state, 'review');

  const ok = await webhook('check_suite', { action: 'completed', check_suite: { head_sha: 'abc123', conclusion: 'success', name: 'ci' }, repository: { full_name: REPO } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.results[0].gate.state, 'done');
  assert.equal((await taskRow(t.id)).state, 'done');
  const art = await q(`select meta from baton.artifacts where task_id = $1 and kind = 'pr'`, [t.id]);
  assert.equal(art.rows[0].meta.ci_status, 'success');
  // A completion comment was queued for the PR (sent only when a GitHub token is in Vault).
  const ob = await q(`select kind, error from baton.gh_outbox where task_id = $1 order by id`, [t.id]);
  assert.ok(ob.rows.some((o) => o.kind === 'completion_comment'));
});

test('AT20: a failing check fails the task and creates a fix task consuming the test_report', async () => {
  const a = await agent('fe-2', 'frontend-dev');
  const t = await task({ role: 'frontend-dev', produces: [{ kind: 'pr' }], scope: ['app/**'] });
  await claim(a);
  await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'pr', uri: `https://github.com/${REPO}/pull/8`, meta: { repo: REPO, number: 8, head_sha: 'def456', branch: 'baton/y' } },
  ])]);
  const fail = await webhook('workflow_run', { action: 'completed', workflow_run: { head_sha: 'def456', conclusion: 'failure', name: 'test', html_url: 'https://github.com/x/actions/1' }, repository: { full_name: REPO } });
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  assert.equal(fail.body.results[0].state, 'failed');
  const fixKey = fail.body.results[0].fix_task;
  assert.match(fixKey, /^TSK-/);

  assert.equal((await taskRow(t.id)).state, 'failed');
  const rep = await q(`select content from baton.artifacts where task_id = $1 and kind = 'test_report'`, [t.id]);
  assert.equal(rep.rows[0].content.failed, 1);
  assert.equal(rep.rows[0].content.failures[0].name, 'test');

  const fix = (await q(`select * from baton.tasks where key = $1`, [fixKey])).rows[0];
  assert.equal(fix.role, 'frontend-dev');
  assert.equal(fix.parent_task, t.id);
  assert.deepEqual(fix.scope, ['app/**']);
  assert.deepEqual(fix.consumes, [{ kind: 'test_report', from_task: t.id }]);
  assert.deepEqual(fix.produces, [{ kind: 'pr' }]);
  assert.equal(fix.state, 'ready', 'the test_report exists, so the fix task is immediately claimable');
  const next = await j(`select baton.task_json(baton.claim_next($1, 600)) as r`, [a]);
  assert.equal(next.id, fix.id);
});

test('a merged pull_request queues closing the promoted issue', async () => {
  const a = await agent('fe-3', 'frontend-dev');
  const t = await task({ role: 'frontend-dev', produces: [{ kind: 'pr' }] });
  await q(`update baton.tasks set github_issue = 42 where id = $1`, [t.id]);
  await claim(a);
  await j(`select baton.task_submit($1, $2, $3) as r`, [a, t.id, JSON.stringify([
    { kind: 'pr', uri: `https://github.com/${REPO}/pull/9`, meta: { repo: REPO, number: 9, head_sha: 'aaa111' } },
  ])]);
  const r = await webhook('pull_request', { action: 'closed', pull_request: { number: 9, merged: true, html_url: `https://github.com/${REPO}/pull/9`, head: { sha: 'aaa111', ref: 'baton/z' } }, repository: { full_name: REPO } });
  assert.equal(r.status, 200);
  const ob = await q(`select kind, payload from baton.gh_outbox where task_id = $1 and kind = 'close_issue'`, [t.id]);
  assert.equal(ob.rows.length, 1);
  assert.equal(ob.rows[0].payload.issue, 42);
  const art = await q(`select meta from baton.artifacts where task_id = $1 and kind = 'pr'`, [t.id]);
  assert.equal(art.rows[0].meta.merged, true);
});

test('needs_human promotes to an issue only when a repo is known; the outbox records a missing token instead of failing', async () => {
  const a = await agent('fe-4', 'frontend-dev');
  const t = await task({ role: 'frontend-dev', produces: [{ kind: 'pr' }], max_attempts: 1 });
  await claim(a);
  await j(`select baton.artifact_put($1, $2, 'pr', $3, null, 'v1', $4, null) as r`, [a, t.id, `https://github.com/${REPO}/pull/10`, JSON.stringify({ repo: REPO, number: 10, head_sha: 'bbb222' })]);
  await j(`select baton.task_release($1, $2, 'giving up') as r`, [a, t.id]);
  assert.equal((await taskRow(t.id)).state, 'needs_human');
  const ob = await q(`select kind from baton.gh_outbox where task_id = $1 and kind = 'promote_issue'`, [t.id]);
  assert.equal(ob.rows.length, 1);
  const flush = await fetch(`${URL_}/admin/github/flush`, { method: 'POST', headers: { authorization: `Bearer ${OP}` } });
  const fb = await flush.json();
  assert.equal(fb.ok, true);
  const after_ = await q(`select error, sent_at from baton.gh_outbox where task_id = $1 and kind = 'promote_issue'`, [t.id]);
  assert.ok(after_.rows[0].sent_at !== null || /no GitHub token/.test(after_.rows[0].error ?? ''));
});
