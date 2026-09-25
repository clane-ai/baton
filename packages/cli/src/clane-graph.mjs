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

import { proposeKind, loadKinds } from './kind-match.mjs';

const STRUCTURAL = new Set(['trigger', 'output', 'note']);
const DIRECT = { role: 'role', human: 'approval', router: 'control', validator: 'control' };
const NEEDS_A_WORKER = new Set(['code', 'action']);
/** The role that claims a node the engine cannot run itself: a worker inside Clane. */
export const CLANE_WORKER = 'clane-worker';
/** The three the platform compiles to and the worker can execute. Anything else is refused at
 *  conversion rather than discovered when a task is claimed. */
const LANGUAGES = new Set(['python', 'node', 'bash']);
/** A heuristic, and named as one. Version one supports code that returns a value: a worker has no
 *  workspace, so a node that writes a file fails in a way that looks like broken code.
 *
 *  This was recorded as provisional on the reasoning that a conversation per engine run would give a
 *  worker a workspace after all. That reasoning is now known to be wrong, and the refusal is closer to
 *  right than the suggestion to lift it was.
 *
 *  What the platform's sandbox actually is: a microVM per user, with a session per conversation inside
 *  it, and the workspace on tmpfs. It survives a pause and resume only while the snapshot survives;
 *  destroy the machine or purge the snapshot and the files are gone. Durable files go to blob storage
 *  through signed URLs minted per conversation.
 *
 *  So a per-run conversation buys a SCRATCH workspace, not a durable one. If this refusal ever lifts it
 *  lifts onto blob storage, which is a different design with a different contract, and not onto the
 *  workspace. The experiment worth running is still whether a later step sees an earlier step's file,
 *  but a yes would now mean the snapshot happened to survive rather than that the workspace is durable. */
function writesFiles(language, code) {
  if (language === 'python') {
    return /\bopen\s*\([^)]*['"][wax]/.test(code) || /\b(pathlib|shutil)\b/.test(code);
  }
  if (language === 'node') {
    return /\b(writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\b/.test(code);
  }
  // Word boundaries matter: without them "tee" matches "committee" and "cp" matches "cpu",
  // so the heuristic would refuse code that does nothing of the kind.
  return /(^|\s)(>>?|\btee\b|\bcp\b|\bmv\b|\bmkdir\b)/m.test(code);
}

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
 * @param opts.lossy     convert anyway when something cannot be expressed; off by default, because a
 *                       lossy conversion plans successfully and is not the workflow that was drawn
 * @returns { manifest, findings } where findings lists every compromise and every refusal.
 */
export function fromClaneGraph(claneManifest, opts = {}) {
  const def = claneManifest?.definition ?? {};
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  const { roles = {}, workers = {}, kinds = {} } = opts;
  const findings = [];
  const schemas = opts.schemas ?? loadKinds();
  const note = (severity, nodeId, type, message, fix) => findings.push({ severity, node: nodeId, type, message, fix });

  const out = [];
  const dropped = new Set();
  // approval node id -> the gateway synthesised to carry its decision
  const gatewayFor = new Map();
  // channel name -> the artefact kind the node writing it produces, so a declared input can say which
  // artefact it wants rather than which node wrote it.
  const channelKinds = new Map();
  // channel name -> the node that writes it, so an input can name the PRODUCING STEP and not merely a
  // kind. The engine pins the producing task in `consumes`, and resolving by latest-of-kind instead
  // would silently pick the wrong artefact in any run that produces a kind twice.
  const channelNodes = new Map();
  for (const n of nodes) {
    const c = n.data?.config ?? {};
    const channel = String(c.output_key ?? n.id);
    channelNodes.set(channel, n.id);
    if (String(n.type) === 'human') { channelKinds.set(channel, 'review'); continue; }
    channelKinds.set(channel, first(kinds[n.id], c.baton?.produces?.[0]) ?? proposeKind(n, schemas).kind ?? 'other');
  }

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
      const worker = first(workers[n.id], workers[label]) ?? (type === 'code' ? CLANE_WORKER : null);
      if (!worker) {
        dropped.add(n.id);
        note('blocker', n.id, type,
          `${type} executes inline in the platform; Baton never executes anything itself, so this step has no one to do it.`,
          'engine');
        continue;
      }
      // The task must be self-contained. Whoever claims it is a machine holding an agent token and no
      // session, so it cannot go back and ask the platform what it is meant to run: the language, the
      // source and the resolved inputs travel with the task. Nothing in here is an identifier that
      // only means something inside the platform's database, because the first time a worker has to
      // resolve one of those, the property that makes this work is gone.
      if (type === 'code' && !LANGUAGES.has(String(cfg.language ?? 'python'))) {
        dropped.add(n.id);
        note('blocker', n.id, type,
          `language "${cfg.language}" is not one a worker can execute; only ${[...LANGUAGES].join(', ')} are. Refused here rather than discovered when the task is claimed.`,
          'converter');
        continue;
      }
      if (type === 'code' && !opts.allowFileWrites && writesFiles(String(cfg.language ?? 'python'), String(cfg.code ?? ''))) {
        dropped.add(n.id);
        note('blocker', n.id, type,
          `this code looks like it writes files. A Clane code node gets a workspace tied to its run; a worker claiming an engine task has no run and no workspace, so it would fail in a way that looks like broken code. Version one supports code that returns a value.`,
          'engine');
        continue;
      }
      if (type === 'code') {
        const known = [...channelKinds.keys()].filter((c) => c !== (cfg.output_key ?? n.id));
        const { reads, usesChannelsObject } = channelReads(String(cfg.code ?? ''), known);
        if (usesChannelsObject) {
          dropped.add(n.id);
          note('blocker', n.id, type,
            `this code reads a "channels" object, which exists in neither executor: the platform injects each channel as a variable named after it, and a worker receives the same names. Rewrite the reads as bare names.`,
            'converter');
          continue;
        }
        const declared = new Set(declaredInputs(n, channelKinds, channelNodes).map((i) => i.channel));
        const undeclared = reads.filter((r) => !declared.has(r));
        if (undeclared.length && !opts.allowUndeclaredInputs) {
          dropped.add(n.id);
          note('blocker', n.id, type,
            `reads the channel(s) ${undeclared.join(', ')} without declaring them as inputs. A worker receives only what the node declares, so this would run against nothing and produce a plausible result from empty values — a payment of zero rather than a failure. Declare the bindings, or the step cannot be handed to a worker.`,
            'converter');
          continue;
        }
      }
      const payload = type === 'code'
        ? {
            kind: 'clane_code',
            language: String(cfg.language ?? 'python'),
            source: String(cfg.code ?? ''),
            inputs: declaredInputs(n, channelKinds, channelNodes),
            node: n.id,
            // Stable across a retry of the same step in the same run, and deliberately NOT including
            // the attempt: a key that changes per retry makes a receiving system see a second distinct
            // request, which is the harm this exists to prevent. The cost is that a node deliberately
            // running twice in one run cannot be told apart from a retry.
            //
            // Be precise about what this buys, because the stronger claim is easy to make and false.
            // Passed to the ENGINE it dedupes bookkeeping, so a submission cannot be applied twice. It
            // does NOTHING about the node's own side effects: a worker that calls a bank and dies
            // before submitting loses its lease, and the next worker calls the bank again. Double
            // EXECUTION is prevented by the lease, and only while the lease holds. The key is carried
            // here so the node's code can pass it to whatever it calls — a bank's idempotency header, a
            // mail provider's message id — which is the only way the guarantee becomes real, and is
            // honestly absent for anything that does not honour one.
            idempotency_key: `${opts.run ?? 'run'}:${n.id}`,
          }
        : undefined;
      out.push({ id: n.id, type: 'role', data: { label, config: { role_ref: worker, prompt: cfg.prompt ?? cfg.code ?? label, baton: { produces: [kindFor(n, kinds, note, schemas)], ...(payload ? { payload, idempotent_by: payload.idempotency_key } : {}) } }, outcomes: n.data?.outcomes ?? [] } });
      note(payload ? 'converted' : 'compromise', n.id, type,
        payload
          ? `becomes a task for the "${worker}" role carrying its language, source and resolved inputs, with an idempotency key of run and node for the engine and for whatever the code calls.`
          : `mapped to the Baton role "${worker}", which must be served by a worker that actually runs it.`,
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

    if (mapped === 'approval') {
      out.push({ id: n.id, type: 'approval', data: { label, config: {} } });
      // A human node decides, and its outcomes are how the graph branches on that decision. The engine
      // expresses a branch as a gateway reading a field of an artefact, so an approval with more than
      // one outcome needs one synthesised, reading the verdict of the review the approval produces.
      // Without it both branches become plain dependants and BOTH become ready: a rejected purchase
      // order would still be sent to the supplier. Found by round-tripping a real workflow, not by
      // reading.
      const outcomes = Array.isArray(n.data?.outcomes) ? n.data.outcomes : [];
      const branchEdges = edges.filter((e) => e.source === n.id && e.sourceHandle);
      if (outcomes.length >= 2 && branchEdges.length >= 2) {
        gatewayFor.set(n.id, `${n.id}__decision`);
        out.push({
          id: `${n.id}__decision`,
          type: 'control',
          data: {
            label: `${label}: decision`,
            outcomes,
            config: {
              decision: {
                from: n.id,
                kind: 'review',
                field: 'verdict',
                // The engine records an approval as a review whose verdict is approve or
                // request_changes; the studio names the same two outcomes differently.
                values: Object.fromEntries(
                  outcomes.map((o) => [
                    String(o.id),
                    /reject|deny|no|fail/i.test(String(o.id)) ? 'request_changes' : 'approve',
                  ]),
                ),
              },
            },
          },
        });
      }
      continue;
    }

    // role
    const role = first(cfg.role_ref, cfg.role, roles[n.id], roles[label]);
    if (!role) {
      dropped.add(n.id);
      note('blocker', n.id, type,
        `a Clane role node names a prompt, not a Baton role; without one nobody can claim the task.`,
        'converter');
      continue;
    }
    out.push({ id: n.id, type: 'role', data: { label, config: { role_ref: role, prompt: cfg.prompt ?? label, baton: { produces: [kindFor(n, kinds, note, schemas)] } }, outcomes: n.data?.outcomes ?? [] } });
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
    if (gatewayFor.has(e.source) && e.sourceHandle) {
      keptEdges.push({ ...e, source: gatewayFor.get(e.source) });
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

  // Refusing by default is the point of this converter. A lossy conversion plans successfully and is
  // not the workflow that was drawn, which is the worst outcome available; the caller must ask for it.
  const blockers = findings.filter((f) => f.severity === 'blocker');
  if (blockers.length && !opts.lossy) {
    const lines = blockers.map((b) => `  ${b.node} (${b.type}): ${b.message}`).join('\n');
    const err = new Error(`this graph cannot be expressed as Baton tasks:\n${lines}`);
    err.findings = findings;
    throw err;
  }

  for (const [approval, gateway] of gatewayFor) {
    keptEdges.push({ id: `e_${approval}__${gateway}`, source: approval, target: gateway, kind: 'forward' });
  }

  const name = opts.name ?? claneManifest?.slug ?? claneManifest?.name ?? 'clane-workflow';
  return {
    manifest: { name, key: slug(name), version: String(claneManifest?.version ?? '0.0.0'), definition: { nodes: out, edges: keptEdges } },
    findings,
  };
}

// Baton artefact kinds are a closed set; a Clane output_key is a free string naming a channel.
// Before falling back to the untyped kind, use the weaker typing Clane already carries: a node's
// declared output fields. A kind is taken only when the node declares every field that kind requires,
// because a wrong kind makes the completion gate reject every run of the step, which is worse than no
// kind at all. An untyped output stays legal by design; it simply cannot feed a typed input.
function kindFor(n, kinds, note, schemas) {
  const explicit = first(kinds[n.id], n.data?.config?.baton?.produces?.[0]);
  if (explicit) return String(explicit);

  const m = proposeKind(n, schemas);
  if (m.kind && m.confidence === 'firm') {
    note('typed', n.id, n.type, `declared fields match the "${m.kind}" kind (${m.reason}), so the completion gate can validate it.`, 'converter');
    return m.kind;
  }
  if (m.kind && m.confidence === 'ambiguous') {
    note('compromise', n.id, n.type, `${m.reason}; a person should confirm the kind rather than accept the guess.`, 'converter');
    return m.kind;
  }
  const key = n.data?.config?.output_key;
  note('untyped', n.id, n.type,
    m.declared.length
      ? `${m.reason}; recorded as "other", so the gate can only check that something was submitted.`
      : key ? `output channel "${key}" is untyped and declares no fields; recorded as "other".`
            : `no output declared; recorded as "other", so the completion gate cannot check anything.`,
    'engine');
  return 'other';
}

/** What a code node's locals are, and where each one comes from.
 *
 *  This cannot be values. A compiler creates the tasks before the run produces anything, so there is
 *  nothing to inline: the purchase order does not exist when the payment task is created. What CAN
 *  travel is the mapping — this local name is that artefact kind — and the worker resolves it through
 *  the engine when it claims the task, which it can do because it holds an agent token and the task
 *  already consumes those artefacts. "Self-contained" means it need not ask the PLATFORM what to run;
 *  asking the engine for its own inputs is what every agent does.
 *
 *  Only declared bindings are carried. An undeclared read is refused rather than guessed at, because
 *  the alternative is a worker running code against nothing and producing a plausible, empty result.
 */
export function declaredInputs(n, channelKinds, channelNodes = new Map()) {
  const cfg = n?.data?.config ?? {};
  const out = [];
  for (const b of Array.isArray(cfg.inputs) ? cfg.inputs : []) {
    const as = String(b?.as ?? '').trim();
    const from = String(b?.from ?? '').trim();
    if (!as || !from) continue;
    const channel = from.split('.')[0];
    out.push({ as, channel, kind: channelKinds.get(channel) ?? null, path: from, from_node: channelNodes.get(channel) ?? null });
  }
  return out;
}

/** Channel names a source reads, by the two ways a node can read one.
 *
 *  A heuristic, like the file-write check, and labelled as one. The platform injects every channel as
 *  a NATIVE VARIABLE named after the channel, so a read is a bare identifier; an explicit binding
 *  injects under its alias. Code referring to a `channels` object is reading something that does not
 *  exist in either executor, so that is reported separately rather than counted as a channel read. */
export function channelReads(code, known) {
  const reads = new Set();
  for (const name of known) {
    if (new RegExp(`(^|[^\\w.])${name}\\b`).test(code)) reads.add(name);
  }
  return { reads: [...reads], usesChannelsObject: /\bchannels\s*[.[]/.test(code) };
}
