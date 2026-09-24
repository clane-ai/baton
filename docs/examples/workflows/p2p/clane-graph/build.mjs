// Procure-to-pay as a Clane studio graph.
//
// Our P2P workflow is a Baton manifest: steps with roles, artefact kinds, data dependencies and
// gateways. Clane's studio stores a workflow as nodes and edges walked by a single pointer. This
// builds the second from the first, faithfully rather than approximately, and prints what it could not
// carry across. The findings matter as much as the file: the places the two models disagree are where
// the convergence work actually is.
//
//   node docs/examples/workflows/p2p/clane-graph/build.mjs > definition.json
//
// Three rules taken from the brief and enforced here rather than trusted:
//   - no backward edges: every branch is a forward edge out of a decision, so the graph does not carry
//     the fault the editor used to manufacture;
//   - every node declares what it produces through the legacy output fields, since the typed contract
//     cannot be authored yet;
//   - the approval is a human node, because that is what the inbox bridge is being built against.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const p2p = join(here, '..');
const schemas = join(here, '..', '..', '..', '..', '..', 'packages', 'schemas');

const findings = [];
const note = (severity, at, message) => findings.push({ severity, at, message });

/** The body of a role file, without its frontmatter: the prompt the step actually runs on. */
function promptOf(role) {
  const raw = readFileSync(join(p2p, 'agents', `${role}.md`), 'utf8');
  const end = raw.indexOf('\n---', 3);
  return raw.slice(raw.indexOf('\n', end + 1) + 1).trim();
}

/** The fields an artefact kind requires, used as the node's declared outputs. */
function fieldsOf(kind) {
  const s = JSON.parse(readFileSync(join(schemas, `${kind}.json`), 'utf8'));
  return (s.required ?? Object.keys(s.properties ?? {})).map((name) => ({
    name,
    description: s.properties?.[name]?.description ?? '',
  }));
}

let y = 0;
const STEP = 140;
const nodes = [];
const edges = [];
const at = (col = 0) => ({ x: 120 + col * 320, y: (y += STEP) });

const node = (id, type, label, config, outcomes, col) => {
  nodes.push({ id, type, position: at(col), data: { label, instructions: '', outcomes, config } });
  return id;
};
const NEXT = [{ id: 'next', label: 'Next' }];
const edge = (source, target, sourceHandle) => {
  edges.push({ id: `e_${source}__${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}), kind: 'forward' });
};
const ends = (source, target, sourceHandle) => {
  edges.push({ id: `e_${source}__${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}), kind: 'terminate' });
};

// ---------------------------------------------------------------- the graph
node('trigger', 'trigger', 'Requisition in', {
  output_key: 'requisition',
  output_schema: JSON.stringify({ requisition: 'string - the requisition number, e.g. PR-2026-103' }, null, 2),
}, NEXT, 0);

node('po', 'role', 'Raise purchase order', {
  role_ref: 'buyer',
  prompt: promptOf('buyer'),
  output_key: 'purchase_order',
  output_fields: fieldsOf('purchase_order'),
  output_retries: 2,
  max_tool_rounds: 40,
}, NEXT, 0);

// The approval branches on its own decision: a human node maps a decision onto its outcomes, so no
// router is needed and, more importantly, no backward edge.
node('approve', 'human', 'Approve purchase order', {
  approver_role: 'purchasing manager',
  review_key: 'purchase_order',
  timeout_hours: 24,
}, [{ id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }], 0);

node('send_po', 'code', 'Supplier ERP: send, acknowledge, ship, invoice', {
  language: 'node',
  code: readFileSync(join(here, 'send_po.js'), 'utf8'),
  // Declared rather than ambient. The platform injects every channel anyway, so this changes nothing
  // there; it is what lets the step be handed to a worker, which receives only what is declared.
  inputs: [{ as: 'purchase_order', from: 'purchase_order' }],
  output_key: 'supplier',
  output_fields: [...fieldsOf('delivery_note'), ...fieldsOf('invoice')].filter(
    (f, i, a) => a.findIndex((x) => x.name === f.name) === i,
  ),
}, NEXT, 0);

node('receive', 'role', 'Book goods receipt', {
  role_ref: 'receiving',
  prompt: promptOf('receiving'),
  output_key: 'goods_receipt',
  output_fields: fieldsOf('goods_receipt'),
  output_retries: 2,
}, NEXT, 0);

node('match', 'role', 'Three-way match', {
  role_ref: 'ap-clerk',
  prompt: promptOf('ap-clerk'),
  output_key: 'invoice_match',
  output_fields: fieldsOf('invoice_match'),
  output_retries: 2,
}, NEXT, 0);

// Our gateway sits ON the step that decides; Clane's router is a node that reads the channel the step
// wrote. Same meaning, one more node.
node('match_gate', 'router', 'Matched?', {
  reads: ['invoice_match'],
  condition: 'invoice_match.status is "matched" — take ok. Anything else, including missing, take bad.',
}, [{ id: 'ok', label: 'Matched' }, { id: 'bad', label: 'Mismatched' }], 0);

node('pay', 'code', 'Bank: schedule payment', {
  language: 'node',
  code: readFileSync(join(here, 'pay.js'), 'utf8'),
  inputs: [
    { as: 'invoice_match', from: 'invoice_match' },
    { as: 'supplier', from: 'supplier' },
  ],
  output_key: 'payment',
  output_fields: fieldsOf('payment'),
}, NEXT, 0);

node('dispute', 'role', 'Dispute the invoice', {
  role_ref: 'ap-clerk',
  prompt: promptOf('ap-clerk'),
  output_key: 'dispute',
  output_fields: fieldsOf('handoff'),
}, NEXT, 1);

node('rework', 'role', 'Rework note to requester', {
  role_ref: 'buyer',
  prompt: promptOf('buyer'),
  output_key: 'rework',
  output_fields: fieldsOf('handoff'),
}, NEXT, 2);

node('deliver_payment', 'output', 'Payment scheduled', {
  deliver_as: 'message', from: ['payment.output'], format: 'markdown',
}, [], 0);
node('deliver_dispute', 'output', 'Dispute raised', {
  deliver_as: 'message', from: ['dispute.output'], format: 'markdown',
}, [], 1);
node('deliver_rework', 'output', 'Sent back for rework', {
  deliver_as: 'message', from: ['rework.output'], format: 'markdown',
}, [], 2);

edge('trigger', 'po');
edge('po', 'approve');
edge('approve', 'send_po', 'approved');
edge('approve', 'rework', 'rejected');
edge('send_po', 'receive');
edge('receive', 'match');
edge('match', 'match_gate');
edge('match_gate', 'pay', 'ok');
edge('match_gate', 'dispute', 'bad');
ends('pay', 'deliver_payment');
ends('dispute', 'deliver_dispute');
ends('rework', 'deliver_rework');

// ---------------------------------------------------------------- what did not carry
note('compromise', 'receive, match',
  'Our steps declare several predecessors each (the receipt needs the delivery note AND the order; the match needs three artefacts). Clane walks one pointer, so those became a single chain. The data is still there, because every earlier channel stays readable, but the graph no longer states that two of them are independent, and nothing can run them in parallel.');
note('compromise', 'send_po, pay',
  'Our two integrations are scripts that talk to the engine as agents. Clane runs code itself, so they became code nodes writing channels instead. That is more than our engine can do, not less, but the bodies here are faithful re-implementations rather than the same files: the originals claim a task and register artefacts, which has no meaning inside a walk.');
note('compromise', 'approve',
  'Our approval carries a deadline of minutes for the simulation; Clane measures an approval timeout in whole hours, so it is set to 24. Nothing else about the step changed.');
note('compromise', 'all role nodes',
  'Declared outputs are field NAMES from our artefact schemas, because the studio has no typed contract yet. The names are right and the types are lost, so nothing validates the shape: a role can return a purchase order with a string where a number belongs and the graph will accept it.');
note('blocked', 'match_gate, approve',
  'Our gateway sits on the step that decides and names the artefact field to read. Clane branches on a separate node evaluating a condition in prose. The meaning survives, the precision does not: "invoice_match.status is matched" is a sentence a model interprets rather than a field comparison the engine enforces.');
note('compromise', 'idempotency',
  'Our payment step is idempotent by invoice number. Run inside the platform, a code node has no equivalent and a resumed run re-executes the pending node at least once, so the risk is real there. Handed to a worker it is narrower than it first looks and narrower than this note used to claim: the task carries a key of run and node, which dedupes submission to the engine but not the call to the bank. Double execution is prevented by the lease while the lease holds, and the key is carried for the code to pass downstream, where it is honoured or it is not.');
note('not-expressible', 'budgets and attempts',
  'Every step of ours carries a budget and an attempt limit. Neither has a home in a node, so both are lost. The runtime has a global cap on node executions and nothing per step.');

const definition = { version: '1.0', nodes, edges };
const out = {
  slug: 'procure-to-pay',
  version: '1.0.0',
  manifest: {
    name: 'Procure to pay',
    description:
      'Requisition to payment: the buyer raises a purchase order, a person approves it, the supplier system ships and invoices, goods-in books the receipt, accounts payable performs the three-way match, and the bank schedules payment. A rejected order goes back for rework; a mismatched invoice becomes a dispute.',
    inputs: [{ name: 'requisition', kind: 'text', label: 'Requisition number (PR-2026-nnn)', required: true }],
    definition,
  },
};

if (process.argv.includes('--findings')) {
  for (const f of findings) console.error(`${f.severity.padEnd(16)} ${f.at.padEnd(22)} ${f.message}`);
  console.error(`\n${nodes.length} nodes, ${edges.length} edges, ${findings.length} findings`);
  const bad = edges.filter((e) => e.kind !== 'forward' && e.kind !== 'terminate');
  console.error(bad.length ? `REFUSED KINDS PRESENT: ${bad.length}` : 'every edge is forward or terminate');
  const up = edges.filter((e) => {
    const s = nodes.find((n) => n.id === e.source), t = nodes.find((n) => n.id === e.target);
    return s && t && t.position.y < s.position.y;
  });
  console.error(up.length ? `EDGES DRAWN UPWARDS (would infer backtrack): ${up.map((e) => e.id).join(', ')}` : 'no edge is drawn upwards');
} else {
  process.stdout.write(JSON.stringify(out, null, 2));
}
