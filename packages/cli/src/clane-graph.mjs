// Clane studio graph -> Baton manifest.
//
// Clane's studio stores a workflow as `manifest.definition = { nodes, edges }`, walked in-process by
// the platform. Baton's compiler already consumes a node graph of its own, so the question is not
// whether a graph can run on the engine but whether CLANE's graph can be expressed in what the
// compiler accepts. This converter answers that for a real definition, and — the point of it —
// records everything it cannot express rather than quietly dropping it.
//
// The honest summary of the mapping:
//   trigger, output, note  -> carried through; structural in both
//   role                   -> role, but needs a Baton role name and an artefact kind, neither of
//                             which a Clane role node carries
//   human                  -> approval (an operator task that waits in needs_human)
//   router, validator      -> control (a Baton gateway on the nearest upstream step)
//   code, action           -> NOTHING. Baton never executes anything itself; these need a role served
//                             by a worker that does. Convertible only by naming that worker.
//   loop, foreach          -> NOTHING, and not a naming problem: Baton's task graph is acyclic and has
//                             no fan-out-and-join. This is the wall.
// Edge kinds: `terminate` the compiler already ignores; `backtrack` and `escalate` have no meaning in
// an acyclic task graph and are dropped here, loudly.

const STRUCTURAL = new Set(['trigger', 'output', 'note']);
const DIRECT = { role: 'role', human: 'approval', router: 'control', validator: 'control' };
const NEEDS_A_WORKER = new Set(['code', 'action']);
const NO_EQUIVALENT = new Set(['loop', 'foreach', 'subworkflow']);

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// A studio node often carries an empty string where a value would go, and '' is not nullish, so a
// ?? chain would accept it and produce a role nobody can claim. Treat blank as absent.
const first = (...vals) => { for (const v of vals) { const t = typeof v === 'string' ? v.trim() : v; if (t !== undefined && t !== null && t !== '') return t; } return null; };

/**
 * Convert one Clane studio manifest into a Baton manifest.
 *
 * @param claneManifest the platform's `manifest` column: { name?, version?, definition: {nodes, edges} }
 * @param opts.roles     map of node id or label -> Baton role name, for role nodes that name none
 * @param opts.workers   map of node id -> Baton role name for a code/action node, when a worker exists
 * @param opts.kinds     map of node id -> Baton artefact kind, when the node's output_key is not one
 * @param opts.name      workflow name; defaults to the platform slug
 * @returns { manifest, findings } where findings lists every compromise and every refusal.
 */
export function fromClaneGraph(claneManifest, opts = {}) {
  const def = claneManifest?.definition ?? {};
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  const { roles = {}, workers = {}, kinds = {} } = opts;
  const findings = [];
  const note = (severity, nodeId, type, message, fix) => findings.push({ severity, node: nodeId, type, message, fix });

  const out = [];
  const dropped = new Set();

  for (const n of nodes) {
    const type = String(n.type ?? '');
    const cfg = n.data?.config ?? {};
    const label = n.data?.label ?? n.id;

    if (STRUCTURAL.has(type)) { out.push({ ...n, type }); continue; }

    if (NO_EQUIVALENT.has(type)) {
      dropped.add(n.id);
      note('blocker', n.id, type,
        `${type} has no equivalent: Baton's task graph is acyclic with no fan-out-and-join, so repetition cannot be expressed as tasks.`,
        'engine');
      continue;
    }

    if (NEEDS_A_WORKER.has(type)) {
      const worker = first(workers[n.id], workers[label]);
      if (!worker) {
        dropped.add(n.id);
        note('blocker', n.id, type,
          `${type} executes inline in the platform; Baton never executes anything itself, so this step has no one to do it.`,
          'engine');
        continue;
      }
      out.push({ id: n.id, type: 'role', data: { label, config: { role_ref: worker, prompt: cfg.prompt ?? cfg.code ?? label, baton: { produces: [kindFor(n, kinds, note)] } }, outcomes: n.data?.outcomes ?? [] } });
      note('compromise', n.id, type,
        `mapped to the Baton role "${worker}", which must be served by a worker that actually runs it.`,
        'converter');
      continue;
    }

    const mapped = DIRECT[type];
    if (!mapped) {
      dropped.add(n.id);
      note('blocker', n.id, type, `unknown node type; not carried across.`, 'converter');
      continue;
    }

    if (mapped === 'control') {
      const outcomes = n.data?.outcomes ?? [];
      if (outcomes.length < 2) {
        note('compromise', n.id, type,
          `a gateway with ${outcomes.length} outcome(s); Baton branches on at least two.`, 'converter');
      }
      out.push({ id: n.id, type: 'control', data: { label, outcomes, config: { decision: cfg.decision ?? {} } } });
      if (!cfg.decision) {
        note('compromise', n.id, type,
          `no decision recorded on the node, so the engine infers the deciding step and reads "verdict" on its artefact.`,
          'converter');
      }
      continue;
    }

    if (mapped === 'approval') { out.push({ id: n.id, type: 'approval', data: { label, config: {} } }); continue; }

    // role
    const role = first(cfg.role_ref, cfg.role, roles[n.id], roles[label]);
    if (!role) {
      dropped.add(n.id);
      note('blocker', n.id, type,
        `a Clane role node names a prompt, not a Baton role; without one nobody can claim the task.`,
        'converter');
      continue;
    }
    out.push({ id: n.id, type: 'role', data: { label, config: { role_ref: role, prompt: cfg.prompt ?? label, baton: { produces: [kindFor(n, kinds, note)] } }, outcomes: n.data?.outcomes ?? [] } });
  }

  // Edges: keep forward ones between surviving nodes; drop control-flow kinds the engine cannot honour.
  const keptEdges = [];
  for (const e of edges) {
    const kind = String(e.kind ?? 'forward');
    if (kind === 'backtrack' || kind === 'escalate') {
      note('blocker', e.source, `edge:${kind}`,
        `a ${kind} edge to ${e.target} sends the run backwards; Baton's task graph is acyclic and has no such edge.`,
        'engine');
      continue;
    }
    if (dropped.has(e.source) || dropped.has(e.target)) {
      note('consequence', e.source, 'edge',
        `edge to ${e.target} dropped because one end could not be converted, so the path through it is broken.`,
        'converter');
      continue;
    }
    keptEdges.push(e);
  }

  const name = opts.name ?? claneManifest?.slug ?? claneManifest?.name ?? 'clane-workflow';
  return {
    manifest: { name, key: slug(name), version: String(claneManifest?.version ?? '0.0.0'), definition: { nodes: out, edges: keptEdges } },
    findings,
  };
}

// Baton artefact kinds are a closed set; a Clane output_key is a free string naming a channel.
function kindFor(n, kinds, note) {
  const explicit = first(kinds[n.id], n.data?.config?.baton?.produces?.[0]);
  if (explicit) return String(explicit);
  const key = n.data?.config?.output_key;
  note('compromise', n.id, n.type,
    key ? `output channel "${key}" is not a Baton artefact kind; recorded as "other", so no schema validates it.`
        : `no output declared; recorded as "other", so the completion gate cannot check anything.`,
    'engine');
  return 'other';
}
