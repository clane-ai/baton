// The YAML front door for workflows (docs/workflow-yaml.md).
//
// People and agents write the YAML; the designer draws the same document; both become the Clane node-graph
// manifest that workflow.mjs compiles into tasks. The YAML carries only semantics (who, what, after, when,
// limits); layout belongs to the designer. Every key here maps to something the engine enforces today, and
// the validator refuses anything else, so what you can write is what will run.
//
//   steps.<id>.role: <role>      a task for that role (LLM agents claim it)
//   steps.<id>.human: <label>    an approval task (role operator; parks in needs_human until approve/reject)
//   steps.<id>.script: <role>    a task for a role served by a script worker, not a model
//   after / reads / produces     depends_on, pinned consumes, produces
//   decide + when                an exclusive gateway on the deciding step's artefact field
//   deadline / budget_usd / max_attempts / scope / affinity / acceptance   task limits
import YAML from 'yaml';
import { KNOWN_KINDS } from './workflow.mjs';

const TOP_KEYS = new Set(['workflow', 'version', 'description', 'inputs', 'steps', 'outputs', 'key']);
const STEP_KEYS = new Set(['role', 'human', 'script', 'title', 'do', 'after', 'reads', 'produces', 'when', 'decide', 'deadline', 'budget_usd', 'max_attempts', 'scope', 'affinity', 'acceptance', 'idempotent_by']);
const NOT_YET = { on_overdue: 'escalation on overdue approvals (today an approval_overdue event is raised; act on it with a webhook)', repeat: 'loops', join: 'fan-out joins', retry_backoff: 'retry backoff', timeout: 'wall-clock timeouts on running steps' };
const INPUT_KEYS = new Set(['type', 'kind', 'label', 'required', 'description']);

export class WorkflowYamlError extends Error {}
const fail = (msg) => { throw new WorkflowYamlError(msg); };

/** "3h", "45m", "2d" or a number of minutes -> minutes. */
export function parseDuration(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|d)?$/i);
  if (!m) fail(`deadline "${v}" is not a duration (use 30m, 3h, 2d, or minutes)`);
  const n = Number(m[1]); const u = (m[2] ?? 'm').toLowerCase();
  return u === 'd' ? n * 1440 : u === 'h' ? n * 60 : n;
}

const list = (v) => v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)];
const humanize = (id) => id.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Validate the YAML document and return the normalised steps. Throws WorkflowYamlError with every problem. */
export function validate(doc) {
  const problems = [];
  const p = (m) => problems.push(m);
  if (!doc || typeof doc !== 'object') fail('the workflow file is empty or not a mapping');
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k)) p(NOT_YET[k] ? `top-level "${k}": ${NOT_YET[k]} is not supported by the engine yet` : `unknown top-level key "${k}"`);
  if (!doc.workflow) p('"workflow" (the name) is required');
  const steps = doc.steps;
  if (!steps || typeof steps !== 'object' || Array.isArray(steps)) p('"steps" must be a mapping of step id to step');
  const ids = steps && typeof steps === 'object' ? Object.keys(steps) : [];
  const out = new Map();
  for (const id of ids) {
    const s = steps[id] ?? {};
    if (!/^[a-z][a-z0-9_-]*$/i.test(id)) p(`step "${id}": ids are letters, digits, _ and -`);
    if (typeof s !== 'object' || Array.isArray(s)) { p(`step "${id}" must be a mapping`); continue; }
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) p(NOT_YET[k] ? `step "${id}": "${k}" (${NOT_YET[k]}) is not supported by the engine yet; remove it or wait for the release that adds it` : `step "${id}": unknown key "${k}"`);
    const kinds = ['role', 'human', 'script'].filter((k) => s[k] != null);
    if (kinds.length !== 1) p(`step "${id}": exactly one of role, human or script is required`);
    const produces = list(s.produces);
    if (s.human != null && produces.length && !(produces.length === 1 && produces[0] === 'review')) p(`step "${id}": a human step produces a review; do not list produces`);
    if (s.human == null && !produces.length) p(`step "${id}": produces is required (which artefact kinds the step must register)`);
    for (const k of produces) if (!KNOWN_KINDS.includes(k)) p(`step "${id}": "${k}" is not a Baton artefact kind (${KNOWN_KINDS.join(', ')})`);
    for (const k of list(s.reads)) if (!KNOWN_KINDS.includes(k)) p(`step "${id}": reads "${k}" is not a Baton artefact kind`);
    for (const a of list(s.after)) if (!ids.includes(a)) p(`step "${id}": after "${a}" is not a step`);
    if (s.when != null) {
      const m = String(s.when).match(/^\s*([a-z][a-z0-9_-]*)\s*(?:=|is)\s*([a-z0-9_-]+)\s*$/i);
      if (!m) p(`step "${id}": when must read "<step> = <outcome>", got "${s.when}"`);
      else {
        const [, from, outcome] = m; const d = steps[from]?.decide;
        if (!ids.includes(from)) p(`step "${id}": when refers to "${from}", not a step`);
        else if (!d) p(`step "${id}": when refers to "${from}", which has no decide block`);
        else if (!(outcome in (d.outcomes ?? {}))) p(`step "${id}": "${from}" has no outcome "${outcome}" (${Object.keys(d.outcomes ?? {}).join(', ')})`);
        if (!list(s.after).includes(from)) p(`step "${id}": when refers to "${from}", so after must include "${from}"`);
      }
    }
    if (s.decide != null) {
      const d = s.decide;
      if (typeof d !== 'object' || !d.field || !d.outcomes || typeof d.outcomes !== 'object') p(`step "${id}": decide needs field ("<kind>.<field>") and outcomes ({ id: value })`);
      else {
        const [kind, ...rest] = String(d.field).split('.');
        const producedHere = s.human != null ? ['review'] : produces;
        if (!rest.length) p(`step "${id}": decide.field must be "<kind>.<field>"`);
        else if (!producedHere.includes(kind)) p(`step "${id}": decide.field kind "${kind}" is not produced by this step (${producedHere.join(', ')})`);
        const used = ids.filter((o) => String(steps[o]?.when ?? '').match(/^\s*([a-z][a-z0-9_-]*)/i)?.[1] === id);
        if (!used.length) p(`step "${id}": decide has no branches (no step has when: ${id} = ...)`);
      }
    }
    if (s.deadline != null) { try { parseDuration(s.deadline); } catch (e) { p(`step "${id}": ${e.message}`); } }
    if (s.budget_usd != null && !(Number(s.budget_usd) > 0)) p(`step "${id}": budget_usd must be a positive number`);
    if (s.max_attempts != null && !(Number.isInteger(s.max_attempts) && s.max_attempts > 0)) p(`step "${id}": max_attempts must be a positive integer`);
    out.set(id, s);
  }
  // reads must be produced somewhere upstream (transitively through after)
  const upstreamOf = (id, seen = new Set()) => { for (const a of list(steps[id]?.after)) if (!seen.has(a)) { seen.add(a); upstreamOf(a, seen); } return seen; };
  for (const id of ids) {
    const up = upstreamOf(id);
    for (const k of list(steps[id]?.reads)) {
      const producers = [...up].filter((u) => (steps[u]?.human != null ? ['review'] : list(steps[u]?.produces)).includes(k));
      if (!producers.length) p(`step "${id}": reads "${k}" but no step before it (through after) produces it`);
    }
  }
  for (const k of list(doc.outputs)) if (!ids.some((id) => (steps[id]?.human != null ? ['review'] : list(steps[id]?.produces)).includes(k))) p(`outputs: no step produces "${k}"`);
  if (problems.length) fail(problems.map((x) => `- ${x}`).join('\n'));
  return out;
}

/** YAML text -> Clane node-graph manifest (what workflow.mjs compiles). */
export function fromYaml(text, { source = 'workflow.yaml' } = {}) {
  let doc;
  try { doc = YAML.parse(text); } catch (e) { fail(`${source}: ${e.message}`); }
  const steps = validate(doc);
  const nodes = [], edges = [];
  let e = 0; const edge = (source, target, sourceHandle) => edges.push({ id: `e${++e}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  nodes.push({ id: 'start', type: 'trigger', data: { label: 'Start', config: {} } });
  const producers = (kind) => [...steps.entries()].filter(([, s]) => (s.human != null ? ['review'] : list(s.produces)).includes(kind)).map(([id]) => id);
  const gatewayOf = new Map(); // step id -> control node id
  for (const [id, s] of steps) if (s.decide) gatewayOf.set(id, `${id}.decide`);

  for (const [id, s] of steps) {
    const label = s.title ?? humanize(id);
    const baton = {};
    if (s.human == null) baton.produces = list(s.produces);
    if (s.budget_usd != null) baton.budget_usd = Number(s.budget_usd);
    if (s.max_attempts != null) baton.max_attempts = Number(s.max_attempts);
    if (s.scope != null) baton.scope = list(s.scope);
    if (s.affinity != null) baton.affinity = String(s.affinity);
    if (s.deadline != null) baton.deadline_in_minutes = parseDuration(s.deadline);
    if (s.acceptance != null) baton.acceptance = String(s.acceptance);
    if (s.idempotent_by != null) baton.idempotent_by = String(s.idempotent_by);
    const instructions = [s.do ? String(s.do).trim() : label, s.idempotent_by ? `Idempotency: one execution per ${s.idempotent_by}; a repeat must produce the same result.` : ''].filter(Boolean).join('\n');
    if (s.human != null) {
      nodes.push({ id, type: 'approval', data: { label, instructions, config: { human: String(s.human), baton } } });
    } else {
      const config = { role_ref: String(s.role ?? s.script), output_key: baton.produces[0], baton, ...(s.script != null ? { execution: 'script' } : {}) };
      nodes.push({ id, type: 'role', data: { label, instructions, config } });
    }
    if (s.decide) {
      const [kind, ...rest] = String(s.decide.field).split('.');
      nodes.push({ id: gatewayOf.get(id), type: 'control', data: { label: s.decide.label ?? `${label}?`,
        outcomes: Object.keys(s.decide.outcomes).map((o) => ({ id: o, label: String(s.decide.outcomes[o]) })),
        config: { decision: { from: id, kind, field: rest.join('.'), values: Object.fromEntries(Object.entries(s.decide.outcomes).map(([k, v]) => [k, String(v)])) } } } });
      edge(id, gatewayOf.get(id));
    }
  }
  for (const [id, s] of steps) {
    const after = list(s.after);
    const when = s.when ? String(s.when).match(/^\s*([a-z][a-z0-9_-]*)\s*(?:=|is)\s*([a-z0-9_-]+)\s*$/i) : null;
    if (!after.length) edge('start', id);
    for (const a of after) {
      if (when && when[1] === a) edge(gatewayOf.get(a), id, when[2]);
      else edge(a, id);
    }
    // reads: make sure the producing step is a direct predecessor so its artefact is pinned in consumes
    for (const k of list(s.reads)) {
      const ups = new Set(); const walk = (x) => { for (const a of list(steps.get(x)?.after)) if (!ups.has(a)) { ups.add(a); walk(a); } }; walk(id);
      const prod = producers(k).filter((x) => ups.has(x)).pop();
      if (prod && !after.includes(prod)) edge(prod, id);
    }
  }
  const outputs = list(doc.outputs);
  if (outputs.length) {
    nodes.push({ id: 'end', type: 'output', data: { label: 'End', config: {} } });
    for (const k of outputs) for (const pr of producers(k)) if (!edges.some((x) => x.source === pr && x.target === 'end')) edge(pr, 'end');
  }
  const inputs = Object.entries(doc.inputs ?? {}).map(([name, v]) => {
    const spec = typeof v === 'string' ? { type: v } : (v ?? {});
    for (const k of Object.keys(spec)) if (!INPUT_KEYS.has(k)) fail(`inputs.${name}: unknown key "${k}"`);
    return { name, kind: String(spec.type ?? spec.kind ?? 'text'), label: String(spec.label ?? spec.description ?? humanize(name)), required: spec.required !== false };
  });
  return {
    $comment: `Compiled from ${source}; edit the YAML, not this file.`,
    key: doc.key, name: String(doc.workflow), version: doc.version != null ? String(doc.version) : undefined, description: doc.description,
    inputs, outputs: outputs.map((name) => ({ name, description: `Produced by ${producers(name).join(', ')}` })),
    definition: { nodes, edges }, source: { format: 'baton-yaml', file: source },
  };
}

/** Clane node-graph manifest -> YAML text (for the existing JSON examples and for the designer's export). */
export function toYaml(m) {
  const nodes = m.definition?.nodes ?? [], edges = m.definition?.edges ?? [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const typeOf = (n) => n.type ?? n.node_type;
  const steps = {};
  const controlOf = Object.fromEntries(nodes.filter((n) => typeOf(n) === 'control').map((c) => { const src = edges.find((x) => x.target === c.id)?.source; return [c.id, src]; }));
  const declared = { workflow: m.name, version: m.version, description: m.description };
  if (m.inputs?.length) declared.inputs = Object.fromEntries(m.inputs.map((i) => [i.name, { type: i.kind ?? 'text', label: i.label, required: i.required !== false }]));
  for (const n of nodes) {
    const t = typeOf(n); if (t !== 'role' && t !== 'approval') continue;
    const c = n.data?.config ?? {}; const b = c.baton ?? {};
    const s = {};
    if (t === 'approval') s.human = c.human ?? 'operator'; else if (c.execution === 'script') s.script = c.role_ref; else s.role = c.role_ref;
    if (n.data?.label) s.title = n.data.label;
    if (n.data?.instructions) s.do = n.data.instructions;
    const after = [], whens = [];
    for (const x of edges.filter((x) => x.target === n.id)) {
      const src = byId[x.source]; if (!src) continue;
      const st = typeOf(src);
      if (st === 'role' || st === 'approval') after.push(x.source);
      else if (st === 'control') { const from = controlOf[x.source]; if (from) { after.push(from); whens.push(`${from} = ${x.sourceHandle ?? src.data?.outcomes?.[0]?.id ?? 'yes'}`); } }
    }
    if (after.length) s.after = after.length === 1 ? after[0] : [...new Set(after)];
    if (whens.length) s.when = whens[0];
    if (t !== 'approval') { const pr = b.produces ?? (c.output_key ? [c.output_key] : []); s.produces = pr; }
    const ctl = nodes.find((x) => typeOf(x) === 'control' && controlOf[x.id] === n.id);
    if (ctl) { const d = ctl.data?.config?.decision ?? {}; const kind = d.kind ?? (t === 'approval' ? 'review' : (b.produces ?? [c.output_key])[0]); s.decide = { field: `${kind}.${d.field ?? 'verdict'}`, outcomes: Object.fromEntries((ctl.data?.outcomes ?? []).map((o) => [o.id, d.values?.[o.id] ?? o.id])) }; }
    if (b.deadline_in_minutes != null) s.deadline = b.deadline_in_minutes % 1440 === 0 ? `${b.deadline_in_minutes / 1440}d` : b.deadline_in_minutes % 60 === 0 ? `${b.deadline_in_minutes / 60}h` : `${b.deadline_in_minutes}m`;
    if (b.budget_usd != null) s.budget_usd = b.budget_usd;
    if (b.max_attempts != null) s.max_attempts = b.max_attempts;
    if (b.scope?.length) s.scope = b.scope;
    if (b.affinity) s.affinity = b.affinity;
    if (b.acceptance) s.acceptance = b.acceptance;
    if (b.idempotent_by) s.idempotent_by = b.idempotent_by;
    steps[n.id] = s;
  }
  declared.steps = steps;
  if (m.outputs?.length) declared.outputs = m.outputs.map((o) => o.name);
  return YAML.stringify(declared, { lineWidth: 100 });
}
