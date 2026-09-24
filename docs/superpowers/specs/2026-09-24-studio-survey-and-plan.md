# The workflow studio today, and what to add

**Asked by the user, 24 September 2026:** look at the node graph editor, say what it has, and plan what
has to be added so a drawn graph can carry typed artefacts and run on the engine.

Surveyed from the studio **source**, not from the running editor. Every claim below names the thing it
came from, and that distinction matters: source says what the code does, not what a person sees while
doing it.

**What is therefore unverified here.** Whether the canvas gives any visible sign of an edge's inferred
kind — a label, a colour, a cursor — and so whether a person drawing an approval is told it became an
escalation. Item 1 below rests on the answer being no. A second pass against the live editor is running
in parallel to settle exactly that, and its result may change the priority rather than merely confirm
this. Read that pass before treating the two defects below as fully established.

## What the editor has

**Eleven node types.** Start (pinned, not in the palette), Role, Code, Action, Router, Validator, Loop,
Foreach, Human, Output and Note.

**Every node carries** a label, free-text instructions, a list of named outcomes (which is what edges
attach to), and a per-type configuration block.

| Node | What a person can actually set |
|---|---|
| Role | A **reference to a saved role** by slug, or an inline one; model override; system prompt; tool names; skill names; a cap on tool rounds; a token cap |
| Code | Language (Python, Node or Bash) and the source |
| Action | A connected app, one tool on it, and its parameters, which may template other channels |
| Router / Validator | A condition in natural language or as a predicate, and which channels it reads |
| Loop | An iteration cap |
| Foreach | Which array channel to map, the item's local name, concurrency from one to twenty, and whether an item's failure skips or aborts |
| Human | An approver role, a timeout in hours, and which channel the approver reviews |
| Output | Deliver as file, JSON or message; which channels to project; filename; format |
| Role and Code both | **Declared output fields**, an output channel name, **input bindings**, a legacy JSON-schema text, and a retry count for re-asking the model |

**The workflow itself has an input contract**: a list of named inputs, each with a kind, a label and a
required flag. That is a real precedent for typing, at the boundary, already built.

## The three questions I most needed answered

**Can a node say anything about what it produces beyond naming a slot?** Partly, and weakly. Declared
output fields are a name, an optional sentence for the extractor and a fallback value. No type, no
required flag. There is also a JSON-schema text field, marked legacy in the source, and a retry count
that re-asks the model when a declared field is missing. So the *intent* to type outputs already exists;
what is missing is that any of it means the same thing twice.

**Does anything reference a shared definition rather than text typed into the node?** Yes, and this
matters more than it sounds: a Role node references a saved role by slug, and an Action node references
a connected app and one of its tools. So the editor already knows how to point at something defined
elsewhere. It simply has no shared thing to point at for the *shape of an output*.

**Does the editor let a person draw the edge kinds the compiler refuses?** It never asks them. Edge kind
is **inferred**, from the node type and from where the boxes sit on the canvas:

- an edge into a Human node is always an **escalate** edge
- an edge into an Output node is always a **terminate** edge
- an edge drawn to a node higher up the canvas is a **backtrack** edge
- a node joined to itself is a **loop** edge

Two consequences follow, and both are defects regardless of anything to do with the engine.

## Two defects found on the way

**Moving a box changes what the workflow means.** Dragging a node thirty pixels above another turns an
ordinary edge into a backtrack. Nothing in the editor says so, and the meaning of a workflow should not
be a function of its layout.

**Every human approval is an escalation.** Because the rule keys on the target's type, an edge into a
Human node is an escalate edge whether or not anybody is escalating. This is why the engine refused a
real workflow earlier today: the only link between its decision and its human review was an escalate
edge, and a forward-only task graph cannot express one. The workflow was drawn correctly; the editor
labelled it in a way that cannot be executed.

## What to add

In the order that each one unblocks the next.

### 1. Let an edge's kind be chosen, and keep inference as a suggestion

The smallest change with the largest effect. A person drawing an approval step should get a forward
edge; someone genuinely building an escalation should say so. Keep the current rule as a default, show
the kind on the edge, and let it be changed. Until this exists, no amount of contract work makes a real
workflow runnable, because the graph will keep declaring escalations nobody meant.

### 2. Promote the output declaration from a slot to a kind

The field already exists; it needs to point at something shared. A node declares that it produces an
`invoice`, and `invoice` is defined once for the organisation rather than typed into the node. Keep the
free-text option: half a business process is prose, and an untyped output must stay legal.

### 3. A kind registry, and a picker that reads it

The editor already has the pattern for referencing something shared, in the role picker. Reuse it. The
registry itself is the third instance of a shape the platform already runs twice, for skills and for
workflows: a current row and an append-only version table. Publishing resolves the version and locks it
into the published workflow, so a kind changing never disturbs a run in flight.

### 4. Turn input bindings into declared inputs

Bindings pull a channel path into a local name today, which is a read of the walk's memory. Add the kind
alongside: this node consumes an `invoice`, produced by that node. That is what lets a step run outside
the walk, and it is what lets the editor catch a node consuming something nobody produces, before it
runs rather than at three in the morning.

### 5. Validate on produce, not in a node

A Validator node is a node someone can forget. Once a node declares a kind, its output is checked before
the edge is followed. Keep the Validator for what it is genuinely good at, which is checking something
other than shape.

### 6. Say what cannot run, in the editor

The compiler now refuses a graph it cannot express. The editor should say the same thing at the point of
drawing: this node type has nobody to run it, this edge cannot be expressed, this kind is not produced by
anything upstream. A person should learn that from the canvas, not from a run.

## What this does not fix

Loops still have no equivalent in a task graph and are costed separately. Code and Action nodes still
have nobody to run them until the in-platform executor exists, which is why that comes first in the
engine plan. Neither is a reason to delay any of the six above: all of them improve the product whether
or not a single node ever moves onto the queue.
