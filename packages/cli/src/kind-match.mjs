// Matching a Clane node's declared output against the engine's artefact kinds.
//
// The honest starting point, measured on the real definitions rather than assumed: Clane's typing is
// much weaker than a schema. A node's `output_fields` is a list of `{name, description?}` — names and
// prose, no types, no required flag. A node's `output_schema`, where one exists at all, is an object
// of `field: "type - description"` prose rather than JSON Schema. Across twenty-eight nodes in five
// active definitions, four carried output_fields and one carried an output_schema, and none of them
// was a schema in any checkable sense.
//
// So this cannot infer a type. What it can do is compare DECLARED FIELD NAMES against the required
// fields of each engine kind and propose a kind only when the evidence is strong, because a wrong kind
// is worse than no kind: it turns the completion gate from "checks nothing" into "rejects everything".

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

/** { kind: { required:Set, properties:Set } } for every artefact kind the engine enforces. */
export function loadKinds(dir = SCHEMA_DIR) {
  const kinds = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    kinds[f.replace(/\.json$/, '')] = {
      required: new Set(s.required ?? []),
      properties: new Set(Object.keys(s.properties ?? {})),
    };
  }
  return kinds;
}

/** Field names a Clane node declares, from either of the two weak forms it uses. */
export function declaredFields(node) {
  const cfg = node?.data?.config ?? {};
  const out = new Set();
  for (const f of Array.isArray(cfg.output_fields) ? cfg.output_fields : []) {
    const name = typeof f === 'string' ? f : f?.name;
    if (name) out.add(String(name).trim());
  }
  const s = cfg.output_schema;
  if (s && typeof s === 'object' && s.properties && typeof s.properties === 'object') {
    for (const k of Object.keys(s.properties)) out.add(k); // a real JSON Schema, if one ever appears
  } else if (s && typeof s === 'object') {
    for (const k of Object.keys(s)) out.add(k); // the prose form: field -> "type - description"
  } else if (typeof s === 'string') {
    try { const parsed = JSON.parse(s); for (const k of Object.keys(parsed.properties ?? parsed)) out.add(k); } catch { /* prose, not JSON */ }
  }
  return [...out];
}

/**
 * Propose an engine kind for a node's declared fields.
 *
 * Deliberately conservative. A kind is proposed only when EVERY field that kind requires is declared,
 * because the completion gate validates against the whole schema: proposing a kind whose required
 * fields are missing would make every run of that step fail the gate, which is a worse outcome than
 * leaving it untyped. Ties break towards the kind with the fewest extra properties, i.e. the closest
 * fit rather than the most permissive.
 *
 * @returns { kind, confidence, reason, declared, candidates }  kind is null when nothing fits.
 */
export function proposeKind(node, kinds = loadKinds()) {
  const declared = declaredFields(node);
  if (!declared.length) {
    return { kind: null, confidence: 'none', reason: 'the node declares no output fields', declared, candidates: [] };
  }
  const have = new Set(declared.map((d) => d.toLowerCase()));
  const candidates = [];
  for (const [kind, spec] of Object.entries(kinds)) {
    if (!spec.required.size) continue; // a kind that requires nothing would match everything
    const missing = [...spec.required].filter((r) => !have.has(r.toLowerCase()));
    const overlap = [...spec.properties].filter((p) => have.has(p.toLowerCase())).length;
    if (!missing.length) candidates.push({ kind, overlap, extra: spec.properties.size - overlap });
  }
  if (!candidates.length) {
    return {
      kind: null,
      confidence: 'none',
      reason: `declared fields (${declared.join(', ')}) do not satisfy the required fields of any engine kind`,
      declared,
      candidates: [],
    };
  }
  candidates.sort((a, b) => b.overlap - a.overlap || a.extra - b.extra);
  const best = candidates[0];
  const ambiguous = candidates.length > 1 && candidates[1].overlap === best.overlap;
  return {
    kind: best.kind,
    confidence: ambiguous ? 'ambiguous' : 'firm',
    reason: ambiguous
      ? `satisfies ${candidates.map((c) => c.kind).join(' and ')}; took ${best.kind} as the closest fit`
      : `declares every field ${best.kind} requires`,
    declared,
    candidates: candidates.map((c) => c.kind),
  };
}
