# Typed artefacts and documents in the node graph

**Asked by the user, 24 September 2026:** the engine's idea that every task produces a typed, validated
artefact, and that artefacts carry the documents a person needs to see, is a good one. What has to change
in Clane's node graph to use it?

This is the design answer. It is written against what the graph does today, read from the code on the
same day, and against what the engine already enforces.

## What each side has now

**The engine.** A task declares `produces` as one or more artefact *kinds*, and `consumes` as kinds with
an optional producing task. A kind names a JSON Schema from a closed set of nineteen. The completion gate
validates the artefact against that schema before the task may be done: the service decides completion,
not the agent. Artefacts carry content, an optional blob, a hash, and a `documents[]` list naming
workspace files, which the engine stores and screens address by identifier. A task becomes ready when the
artefacts it consumes exist, so data dependency, not drawing order, decides what may run.

**The graph.** A node writes a named channel: a free-text `output` string plus whatever structured fields
came back. The walker owns that bookkeeping and nodes never touch it. Typing is optional and per node: a
role node may declare output fields, and a separate validator node may carry an inline schema. Downstream
nodes reach earlier values by templating a path. File delivery lives inside the output node.

The consequence, measured rather than asserted: converting a real Clane workflow to the engine lands
every step as the generic kind, because a free-text channel has no kind. **Conversion therefore switches
off the engine's main quality mechanism.** The gate can only check that something was submitted.

## Corrected, 24 September 2026: most of this already exists and runs

The largest finding of the day, from reading the platform rather than the studio, and it changes what
this document is for. **Clane already has a typed node contract, and the orchestrator already enforces
it.** What is missing is that the editor cannot author one.

**The contract.** The shared types define a node contract of inputs and outputs. An input port carries a
name, a **type**, the channel it reads from, a **required** flag and a default. An output port carries a
name, a **type** and a description. The port types are string, number, boolean, json, array and file.
The file's own comment describes it as a node working inside declared ports rather than a free-for-all.

**The enforcement.** Three checks exist and the orchestrator calls all three: a pre-flight over the whole
graph when a run starts, an input check as a node is entered, and an output check as it leaves. The
pre-flight is not advisory — it fails and the run does not start.

**Why none of it is visible.** When a node has no explicit contract, one is *derived* from the legacy
declared inputs and output fields, with every input forced to not-required and **every output typed as a
string**, deliberately, so that existing graphs stay lenient. No studio surface writes a contract, so no
real workflow has one, so everything runs on the derived lenient version. That is also the whole
explanation of the code editor promising typed objects and generating string for every leaf: it is not a
separate defect, it is the derived contract showing through.

**So the gap is one authoring surface, not eleven node types.** The contract lives on the node and is
type-agnostic, so the engine does not care which node type declares. The cost is almost entirely the cost
of building the authoring experience at all; the increment per node type after that is small. That
reverses the scope limit recorded earlier in this document, which said typing would reach two node types
out of eleven.

### The hazard to decide before building, not during

**`required` defaults to true on an input port, and every contract today is derived with it false.** The
moment an editor writes an explicit contract for a node, that node's inputs become required, the
pre-flight begins enforcing, and a graph that ran this morning refuses to start. Whoever builds this has
to decide deliberately whether authoring is additive or whether the first save flips a workflow into
strict mode. Discovering that from a customer's failed run is the bad version.

### Port types and kinds are two layers, and both are needed

A port type is a primitive. An `invoice` is not a primitive: at the port level it is json, and the kind
refines what shape of json it is. So a kind registry does not replace the port type, it sits above it.
Say that explicitly wherever the registry is built, or it will be built as a competing enumeration and
the two will disagree.

### "Declare" means three different things, and conflating them is what makes this expensive

- **Derived, never hand-typed.** An app action's output shape is knowable from the connector's own tool
  definition, exactly as its inputs already are. A router or validator produces a branch decision whose
  possible values are already on screen as its outcome labels: an enum the editor can derive without
  asking anybody. Making an author retype either would be worse than what exists today.
- **Hand-declared, because nothing else can know.** A role node's declaration is prose aimed at an
  extractor, and that is legitimate: no schema can tell a model which sentence holds the manager's name.
  A human review node is the sharper case and **the highest priority of all of them**: it produces the
  approver's decision and possibly an edited artefact, only the author knows which, and today it cannot
  declare anything at all. It is the only node whose output is both unknowable and unauthorable.
- **Declared and strictly checkable.** A code node is deterministic, so its declaration is a real
  contract the output check can enforce properly rather than leniently. It is the one place where
  turning enforcement on costs nothing in fidelity.

Default to derivation; reserve hand-authoring for the two cases where derivation is impossible. That
keeps the authoring surface small, which matters because the surface is the whole cost.

### Still unchecked

Whether the graph pre-flight has ever actually refused a real run. Whether the studio's serialisation
would preserve a contract it did not author, which decides whether one could be written through the
interface today and survive an editor save. And the reachability logic inside the pre-flight, which is
described by its comment rather than read.

## The six changes, in the order they pay off

### 1. A node declares what it produces, by kind

`output_key` names a slot. `produces: <kind>` names a *contract*. The second is what lets anything
downstream, in any process, know what it is getting without reading the node that made it.

Keep the channel. This is additive: the channel remains how values move, and the kind is what the value
claims to be.

### 2. A node declares what it consumes, by kind and source

Templating a path is a read of the walk's memory. A declaration is an input contract. It is the single
change that makes a step runnable somewhere other than inside the walk, because its inputs are named
rather than scraped.

Templating stays for convenience. A declared input is what the engine matches on and what the editor can
check before anything runs.

### 3. Kinds live in a registry, not inside a node

Kinds belong to the organisation: defined once, versioned, referenced by name. An invoice is an invoice
across every workflow, or the typing buys nothing.

**Corrected 24 September 2026, measured rather than assumed.** I wrote that inline schemas are redefined
per workflow and need consolidating. Across the five active definitions and their twenty-eight nodes,
that is not what exists. A node's declared output fields are names with optional prose, carrying no types
and no required flag, on four nodes. The single "output schema" in the whole estate sits on a trigger node
and is not a schema at all: it maps a field to a sentence such as "the purchase order". So **the registry
is a new capability with one weak precedent to absorb, not a reconciliation of competing schemas.** That
makes it larger than described, not smaller, and it removes the argument that the work pays for itself by
deduplication.

**Shape, against the tables that exist.** It is the third instance of a pattern the platform already runs
twice, for skills and for workflows: a current row carrying source, owner, slug, version and schema, plus
an append-only version table keyed by parent and version. No install or toggle table, because a kind is a
tenant's vocabulary rather than something a user opts into. The engine's nineteen seed it as platform
kinds, so both sides read the same rows, and an inline schema is promoted with a slug when somebody
chooses rather than bulk-converted.

**Publishing locks the version.** Resolving a declared version range at publish time and storing the lock
in the workflow version's manifest means a kind changing never disturbs a run in flight, there is no
migration of half-finished runs, and adopting a new version is an act of republishing, which the product
already does and already records.

**One structural consequence, and it is the largest single item.** The engine's artefact kind is a
Postgres enum, and an enum cannot hold per-tenant values. The registry forces that column to become text
with a reference, and validation to resolve by slug and version rather than by filename. That belongs
*inside* the engine's move into Clane's database rather than before it, because doing it twice would be
foolish.

### 4. Validation becomes a gate, not a node you remember to add

The engine validates on submission, always. In the graph, a node that declares `produces` has its output
validated before the edge is followed, with no separate node required. The validator node then remains
only for what it is actually good at, which is checking something other than shape.

A gate you cannot forget is worth more than a node you can.

**Position, from the code.** There is exactly one right place: between the executor returning and the
walker writing the channel, which are two adjacent statements in the work-node wrapper. That is where the
shape first exists, it is before an edge is chosen, and it preserves the property that nodes never touch
channels.

**Two dependencies, named rather than assumed.** The gate is meaningless until a failed node stops the
walk, because a validation failure would otherwise be recorded and stepped over, which is worse than no
validation: it looks like a control and is not. And the output node is executed inline rather than through
the wrapper, so it needs the same treatment separately.

### 5. Documents become first class

File delivery inside the output node means files are a side effect of one step rather than part of what
a step produced. An artefact should carry `documents[]`, each a label and a reference, with the bytes in
the store and the screens addressing them by identifier. That is already how the engine and the approval
screens work, and it is why a person reviewing a purchase order can open the requisition and the email
beside it.

Rule to keep: paths are internal. Anything crossing a boundary uses an identifier.

### 6. Per-field provenance, optional but reserved

For any step that extracts rather than decides, each field may carry where it came from and how
confident the extractor was. The engine already accepts this as an optional map per artefact. Reserving
it in the graph's contract now costs nothing and is what lets a review screen show a number beside the
place in the document it came from.

## What this changes about edges

Today an edge is control flow: the walker follows the first edge whose handle matches the outcome. With
declared inputs, the graph also has *data* dependencies, which are not the same thing.

Two consequences worth deciding deliberately rather than discovering:

- **The editor can check a graph before it runs.** A node consuming a kind nobody produces is a drawing
  error, visible at design time rather than at three in the morning.
- **Order can relax where only data requires it.** The engine already starts a task when its inputs
  exist. A graph whose edges are pure control flow cannot express that two steps are independent; a
  graph with declared inputs can.

Keep both. Control edges say what may happen after a decision; data declarations say what a step needs.
Collapsing them would lose the branch semantics that make a workflow a workflow.

## What not to do

- **Do not make the closed set a wall.** An untyped output stays legal, because half a business process
  is prose. It simply cannot be consumed by a typed input, and its gate can only check that it exists.
  The escape hatch must be loud rather than default.
- **Do not add kinds per workflow.** That is the inline schema problem with extra steps.
- **Do not retrofit the studio first.** The contract is what matters; the editor follows it. A designer
  offering kinds it cannot enforce is worse than one that offers none.
