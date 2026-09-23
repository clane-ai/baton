// Compile a Clane workflow manifest into a Baton task graph (docs/clane-integration.md, decision 2).
//
// role_ref inside a role node's config is Baton's own convention (NodeData has label, instructions, outcomes and a
// free-form config); a manifest authored in Clane's web editor must be checked for where it puts the role.
// Supported input: the Clane node-graph manifest (WorkflowManifest: name, version, inputs, outputs,
// definition.nodes[], definition.edges[]). Role nodes become tasks; trigger, output and note nodes
// are structural; code, action, control and approval nodes are reported and left to the orchestrator.
//
//   role node            -> task { role: config.role_ref, spec: prompt|instructions + workflow input,
//                                  produces: config.baton.produces ?? [config.output_key],
//                                  scope/budget from config.baton, workflow_run: the run key }
//   edge role -> role    -> depends_on + consumes pinned to the upstream task (its produced kinds)
//   baton.deadline_in_minutes -> a deadline relative to compile time (approval nodes: raises approval_overdue)
//   control node         -> an exclusive gateway: each outgoing edge names an outcome (sourceHandle); the
//                           tasks behind it get a condition on the deciding step's artefact (config.decision:
//                           {from, kind, field, values}; defaults: nearest upstream step, its first kind, "verdict",
//                           the outcome id). The branch not taken is cancelled when the decision lands.
//   priority             -> earlier steps first (topological order)
import { readFileSync } from 'node:fs';
import { Api, must } from './api.mjs';

export const KNOWN_KINDS = ['user_story', 'task_spec', 'design_spec', 'api_contract', 'service_contract', 'pr', 'build', 'test_report', 'review', 'migration', 'doc', 'other', 'db_schema', 'config', 'handoff', 'purchase_order', 'delivery_note', 'invoice', 'goods_receipt', 'invoice_match', 'payment'];

export function loadManifest(path) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (!m.definition?.nodes) throw new Error(`${path}: not a Clane node-graph manifest (no definition.nodes). The steps-based bundle format is not compiled yet.`);
  return m;
}

/** Topological order of node ids (Kahn). Cycles throw. */
function topo(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((i) => [i, 0]));
  const out = new Map(ids.map((i) => [i, []]));
  for (const e of edges) { if (!indeg.has(e.source) || !indeg.has(e.target)) continue; indeg.set(e.target, indeg.get(e.target) + 1); out.get(e.source).push(e.target); }
  const q = ids.filter((i) => indeg.get(i) === 0); const order = [];
  while (q.length) { const i = q.shift(); order.push(i); for (const t of out.get(i)) { indeg.set(t, indeg.get(t) - 1); if (indeg.get(t) === 0) q.push(t); } }
  if (order.length !== ids.length) throw new Error('workflow graph has a cycle');
  return order;
}

function taskOf(node) {
  const c = node.data?.config ?? {};
  return String(c.prompt ?? node.data?.instructions ?? node.data?.label ?? node.id).trim();
}

/** Plan without touching the server: [{node, role, produces, spec, acceptance, upstream: [nodeId], scope, budget}] plus skipped nodes. */
export function plan(manifest, { input = '', run }) {
  const nodes = manifest.definition.nodes;
  // A terminate edge ends the run on that outcome; it is control flow, never a data dependency.
  const edges = (manifest.definition.edges ?? []).filter((e) => e.kind !== 'terminate');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = topo(nodes, edges);
  const steps = []; const skipped = []; const gateways = [];
  const typeOf = (n) => n?.type ?? n?.node_type ?? '';
  const isStep = (n) => typeOf(n) === 'role' || typeOf(n) === 'approval';
  const producesOf = (n) => { const c = n.data?.config ?? {}; return typeOf(n) === 'approval' ? ['review'] : (c.baton?.produces ?? (c.output_key ? [c.output_key] : [])).map(String); };
  // The step a control node decides on: its nearest upstream step.
  const decidingStep = (controlId) => { for (const e of edges) if (e.target === controlId) { const src = byId.get(e.source); if (isStep(src)) return src.id; if (src) { const d = decidingStep(src.id); if (d) return d; } } return null; };
  for (const id of order) {
    const n = byId.get(id);
    const type = typeOf(n);
    if (type === 'trigger' || type === 'output' || type === 'note') continue;
    if (type === 'control') {
      const from = n.data?.config?.decision?.from ?? decidingStep(id);
      if (!from) throw new Error(`control node ${id} has no upstream step to decide on`);
      gateways.push({ id, label: n.data?.label ?? id, from, outcomes: (n.data?.outcomes ?? []).map((o) => o.id) });
      continue;
    }
    if (type !== 'role' && type !== 'approval') { skipped.push({ id, type, reason: `${type} nodes stay in the orchestrator` }); continue; }
    const c = n.data?.config ?? {};
    // An approval node is a task for the operator role: it waits in needs_human until baton tasks approve|reject.
    const role = type === 'approval' ? 'operator' : (c.role_ref ?? c.role);
    if (!role) throw new Error(`role node ${id} has no config.role_ref`);
    const produces = type === 'approval' ? ['review'] : (c.baton?.produces ?? (c.output_key ? [c.output_key] : [])).map(String);
    const unknown = produces.filter((k) => !KNOWN_KINDS.includes(k));
    if (unknown.length) throw new Error(`node ${id}: output kind(s) ${unknown.join(', ')} are not Baton artefact kinds (${KNOWN_KINDS.join(', ')})`);
    // Upstream steps, transitively through structural nodes. Passing through a control node records
    // the outcome this branch answers to, which becomes the task's condition.
    const upstream = new Set(); let condition = null;
    const walk = (target) => {
      for (const e of edges) if (e.target === target) {
        const src = byId.get(e.source); if (!src) continue;
        if (isStep(src)) { upstream.add(e.source); continue; }
        if (typeOf(src) === 'control') {
          const cfg = src.data?.config?.decision ?? {};
          const from = cfg.from ?? decidingStep(src.id);
          const outcome = e.sourceHandle ?? (src.data?.outcomes?.[0]?.id ?? 'yes');
          const fromNode = byId.get(from);
          if (condition && condition.gateway !== src.id) throw new Error(`node ${id} is reached through two gateways (${condition.gateway} and ${src.id}); a step can carry one condition. Split it, or route one gateway through a step first.`);
          condition = { fromStep: from, kind: cfg.kind ?? producesOf(fromNode)[0] ?? 'review', field: cfg.field ?? 'verdict', equals: String(cfg.values?.[outcome] ?? outcome), outcome, gateway: src.id };
          if (from) upstream.add(from);
          continue;
        }
        walk(e.source);
      }
    };
    walk(id);
    // A step fed by two outcomes of one gateway can never become ready (its not-taken side is cancelled and
    // the cascade takes the join with it). Say so at compile time instead of letting the run hang.
    const seenOutcomes = new Map();
    const outcomesFeeding = (stepId, acc) => { const st = steps.find((x) => x.id === stepId); if (!st) return acc; if (st.condition) acc.push(st.condition); for (const u of st.upstream) outcomesFeeding(u, acc); return acc; };
    const feeding = [...upstream].flatMap((u) => outcomesFeeding(u, [])).concat(condition ? [condition] : []);
    for (const f of feeding) { const prev = seenOutcomes.get(f.gateway); if (prev && prev !== f.outcome) throw new Error(`node ${id} joins outcomes "${prev}" and "${f.outcome}" of gateway ${f.gateway}; Baton gateways are exclusive and cannot rejoin. Give each branch its own copy of this step.`); seenOutcomes.set(f.gateway, f.outcome); }
    const label = n.data?.label ?? id;
    const spec = [`# Task`, taskOf(n), '', `# Workflow input`, input || '(none)', '',
      `# Workflow`, `${manifest.name} ${manifest.version ?? ''} run ${run}, step "${label}" (${id}). Register exactly these artefact kinds: ${produces.join(', ') || 'none'}.`].join('\n');
    const acceptance = c.baton?.acceptance ?? `Given the inputs of step ${id}, when the ${role} finishes, then ${produces.length ? `a valid ${produces.join(' and ')} artefact exists` : 'the step is submitted'} and it satisfies: ${label}.`;
    steps.push({ id, label, role, produces, spec, acceptance, upstream: [...upstream], scope: (c.baton?.scope ?? []).map(String), budget: c.baton?.budget_usd, maxAttempts: c.baton?.max_attempts,
      affinity: c.baton?.affinity, deadline: c.baton?.deadline ?? (c.baton?.deadline_in_minutes ? new Date(Date.now() + Number(c.baton.deadline_in_minutes) * 60000).toISOString() : undefined), condition });
  }
  return { steps, skipped, gateways };
}

/** Create the tasks on the server in order. Returns { run, tasks: [{node, key, id}], skipped }. */
export async function compile(cfg, manifest, { input, run, dryRun = false, affinity, publish = true }) {
  const { steps, skipped, gateways } = plan(manifest, { input, run });
  const api = new Api(cfg.serverUrl, cfg.operatorToken);
  const wfKey = String(manifest.key ?? manifest.name ?? 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!dryRun) {
    if (publish) must(await api.post('/admin/workflows', { key: wfKey, name: manifest.name, version: manifest.version, manifest }), 'publish workflow');
    must(await api.post('/admin/workflow-runs', { key: run, workflow_key: publish ? wfKey : undefined, workflow_name: manifest.name, input }), 'create run');
  }
  const created = new Map(); // node id -> { id, key, produces }
  const out = [];
  for (const [i, s] of steps.entries()) {
    const deps = s.upstream.map((u) => created.get(u)).filter(Boolean);
    const body = {
      title: `${manifest.name}: ${s.label}`, spec: s.spec, acceptance: s.acceptance, role: s.role,
      priority: 300 - i, produces: s.produces.map((kind) => ({ kind })),
      consumes: deps.flatMap((d) => d.produces.map((kind) => ({ kind, from_task: d.id }))),
      depends_on: deps.map((d) => d.id), scope: s.scope, budget_usd: s.budget, max_attempts: s.maxAttempts, workflow_run: run,
      affinity: s.affinity ?? affinity, deadline: s.deadline,
      condition: s.condition && created.get(s.condition.fromStep) ? { task: created.get(s.condition.fromStep).id, kind: s.condition.kind, field: s.condition.field, equals: s.condition.equals, outcome: s.condition.outcome, gateway: s.condition.gateway } : undefined,
    };
    if (dryRun) { out.push({ node: s.id, role: s.role, produces: s.produces, depends_on: s.upstream, scope: s.scope, when: s.condition ? `${s.condition.gateway}=${s.condition.outcome}` : '' }); created.set(s.id, { id: `<${s.id}>`, key: `<${s.id}>`, produces: s.produces }); continue; }
    const r = must(await api.post('/admin/tasks', body), `task for node ${s.id}`);
    created.set(s.id, { id: r.task.id, key: r.task.key, produces: s.produces });
    out.push({ node: s.id, role: s.role, key: r.task.key, id: r.task.id, state: r.task.state, produces: s.produces, depends_on: s.upstream, when: s.condition ? `${s.condition.gateway}=${s.condition.outcome}` : '' });
  }
  return { run, tasks: out, skipped, gateways };
}
