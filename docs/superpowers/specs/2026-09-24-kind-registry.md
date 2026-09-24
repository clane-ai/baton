# A kind registry against Clane's data model

**Follows** `2026-09-24-artefacts-in-the-graph.md`, change three: kinds belong to the organisation,
defined once, versioned and referenced by name, rather than an inline schema redefined per workflow.
This is the design against the real tables in `C:\git\clane.ai`, not a wish.

## What the mapping work found first, because it changes the premise

Clane's existing typing is weaker than the specification assumed, measured across the five active
definitions and their twenty-eight nodes:

- `output_fields` is a list of `{name, description?}`. Names and prose. **No types, no required flag.**
  Four nodes carry it.
- `output_schema` appears once, on a trigger node, and is **not JSON Schema**: it is an object mapping a
  field to a prose string such as `"file - the purchase order"`.

So there is no body of inline schemas to migrate. That is good news for the registry, because it means
the registry is not a consolidation exercise with existing content to reconcile; it is a new capability
with one weak precedent to absorb. It is bad news for anyone expecting conversion to inherit typing:
the matcher now in `packages/cli/src/kind-match.mjs` proposes a kind only when a node declares every
field that kind requires, and on the real definitions it proposes nothing, because those nodes declare
operational counters rather than business documents.

## The tables, following the precedent that already exists

Clane already versions org-owned content twice, for skills and for workflows, with the same shape:
a current row carrying `source`, `ownerId`, `slug`, `version`, `manifest` and `sha256`, plus an
append-only `*Version` table keyed by `(parentId, version)`. The comment on `Skill` explains the
reasoning: republish updates the current row in place and appends history, so the row id stays stable
and foreign keys from installs and toggles never strand (`03-agents.prisma:786-1010`).

A kind registry should be the third instance of that pattern rather than a new one.

**`ArtefactKind`** → `artefact_kinds`
- `id`, `source` (`platform` | `org`), `ownerId` (null for platform, the tenant for org)
- `slug` — `invoice`, `purchase_order`, or an organisation's own `zeus_order_form`
- `version` — semver of the current schema
- `schema` — the JSON Schema itself
- `sha256`, `status` (`active` | `deprecated`), `createdAt`, `updatedAt`
- `@@unique([source, ownerId, slug])`, `@@index([source, ownerId, slug, status])`

**`ArtefactKindVersion`** → `artefact_kind_versions`
- `id`, `kindId`, `version`, `schema`, `sha256`, `publishedAt`, `publishedById`
- `@@unique([kindId, version])`

No install or toggle table. A kind is not something an organisation opts into per user; it is the
vocabulary of the tenant. Platform kinds are visible to everyone, an org kind shadows a platform one of
the same slug, which is the precedence those other two tables already use.

## How a workflow references a version, and what happens when a kind changes

**A node declares a kind and a range**, not a schema: `produces: { kind: "invoice", accepts: "^1" }`.

**Publishing resolves the range and locks it.** `WorkflowVersion` (`03-agents.prisma:1282-1299`) already
stores the manifest of a published version. The resolved kind versions go in that manifest, so a
published workflow carries a lock rather than a reference. A draft resolves against the live registry;
a published version never does.

That single decision answers the hard question. **A running workflow is unaffected when a kind
changes**, because it is executing a published version whose kinds are pinned. There is no migration of
in-flight runs, no partially-typed run, and no ambiguity about which schema a half-finished run was
validated against. Adopting a new kind version is an act of republishing, which is already a thing the
product does and already records who did it.

The change rules follow from that:

- **Additive change** — a new optional property, a widened enum. New minor. Nothing in flight notices.
  Republishing adopts it.
- **Breaking change** — a new required field, a narrowed type, a removed property. New major. A workflow
  pinned to the old major keeps working indefinitely; republishing surfaces the incompatibility at
  design time, which is where you want it.
- **Never mutate a published version.** The version table is append-only. Editing a schema in place
  would retroactively invalidate artefacts that were valid when they were produced, which destroys the
  audit trail's meaning.
- **Deprecation is a flag, not a deletion.** The editor warns, existing runs continue, and the slug stays
  resolvable forever because old artefacts reference it.

## Making our nineteen and Clane's inline ones one set

**Seed the nineteen as platform kinds.** The schema files in `packages/schemas` become
`source: 'platform'`, `ownerId: null`, version `1.0.0`, with their content hashed. They are then the
baseline vocabulary in every tenant, and the engine and the studio are reading the same rows rather than
two copies that drift.

**Inline schemas get promoted, not migrated.** There is only one in the real data and it is prose, so
there is nothing to bulk-convert. The path forward is an action in the editor: take this node's inline
schema, give it a slug, and it becomes an org kind that other workflows can reference. Until someone
does that, an inline schema keeps working as a local, unnamed, unreusable check. It cannot feed a typed
input, which is exactly the loud escape hatch the specification asks for.

**The engine change this forces, stated plainly.** Baton's artefact kind is a Postgres enum
(`create type baton.artifact_kind as enum (...)`). An enum cannot hold per-tenant values, so the
registry requires that column to become text with a reference to the kinds table, plus validation
resolving a schema by slug and version instead of by filename. That is a real migration with real
weight, and it is the largest single item in this design. It should happen as part of the engine moving
into Clane's database rather than before it, because doing it twice would be foolish.

## Where validation sits in the walk

The smallest change that proves the whole idea: a node that declares what it produces has its output
validated before the edge is followed.

There is exactly one right place, and the code already points at it. In
`workflowOrchestrator.ts:825-915`, `runWorkNode` calls `const r = await exec()` at `:849` and writes the
channel at `:856-859`:

```ts
const key = node.data.config.output_key || node.id;
const produced = { output: r.output, ...(r.structured ?? {}) };
channels.set(key, produced); lastChannelKey = key;
```

**The check belongs between those two statements.** Validate `produced` against the declared kind's
schema; on failure, do not write the channel, mark the node failed, and stop.

Three reasons that specific position and not another:

- **It is where the shape exists.** Before the executor returns there is no output; after the channel is
  written the bad value is already visible to everything downstream and to the checkpoint.
- **It keeps the walker's best property.** Nodes never touch channels, and the walker owns the
  bookkeeping. Validation in the wrapper preserves that; validation inside each executor would duplicate
  it four times and let one forget.
- **It is before the edge.** Edge selection happens at `:1680-1684`, long after. Anything validated later
  is validated after the run has already moved on.

**Two dependencies, named rather than assumed.** This check is only meaningful once a failed node stops
the walk, which today it does not: `runWorkNode` returns the output regardless of success (`:914`) and
the switch ignores the flag. Without that fix, a validation failure would be recorded and then stepped
over, which is worse than no validation because it looks like a control. And the `output` node is
executed inline in the switch (`:1439-1548`) rather than through the wrapper, so it needs the same
treatment separately — which is one more argument for giving it a wrapper like the work nodes have.

**Retries.** The platform already has a retry that re-asks the extractor when structured output does not
parse. A schema failure should use that same path before failing the node, with the validation errors fed
back into the retry prompt. That is the cheapest way to make typing helpful rather than merely strict.

## The two constraints, kept

**An untyped output stays legal.** A node with no declared kind produces a channel exactly as it does
today, and its gate checks only that something exists. It simply cannot satisfy a typed input, and the
editor should say so at design time rather than at run time. The converter now reports untyped outputs
as their own finding rather than burying them among compromises, so the escape hatch is loud.

**Paths never cross a boundary.** Documents on an artefact carry a label and an identifier; bytes live in
the store and screens address them by identifier. Nothing in this design puts a filesystem path in a
manifest, a channel or an interface payload.
