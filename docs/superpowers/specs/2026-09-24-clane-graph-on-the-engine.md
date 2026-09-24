# Running a Clane studio graph on the engine: what breaks

**The experiment, 24 September 2026.** Take real workflow definitions out of Clane's database, convert
the studio's node graph into the manifest Baton's compiler already accepts, and plan it onto the queue.
The point was to find the gap, not to finish a feature.

**The headline.** The shapes nearly match, because both sides are node-and-edge graphs and Baton's
compiler already consumes one. The semantics do not. Two of the three real graphs cannot run at all,
and the one that plans successfully is no longer the same workflow: its approval no longer waits for
the work it approves, and its gateway decides nothing.

Converter: `packages/cli/src/clane-graph.mjs`. It records every compromise and refusal rather than
dropping anything silently, which is the only reason this document can be specific.

## What was tested

Three active definitions, taken from the platform's `workflows` table.

| Definition | Nodes | Node types present | Result |
|---|---|---|---|
| po-order-extractor | 9 | trigger, code, role, output, validator, action | plans only once every role and worker is named by hand |
| po-order-extractor-ai | 8 | trigger, role, code, loop, validator, human, output | cannot plan: the loop is a wall |
| po-order-extractor (5-node) | 5 | trigger, code, validator, human, output | plans, but the workflow it plans is not the one drawn |

## What converts cleanly

- **trigger, output, note.** Structural in both. Carried across and ignored by the compiler.
- **human → approval.** A Clane human node becomes an operator task that waits in `needs_human`, which
  is exactly what the approvals screen already reads. This is the cleanest correspondence of the lot.
- **router and validator → control.** Baton's gateway. The outcomes carry over.
- **role → role**, once a Baton role name exists. See below: it usually does not.
- **The overall graph.** Topological order, dependencies through structural nodes, and branch
  conditions all survive. The compiler's machinery is not the problem.

## The compromises, and where each fix belongs

**A Clane role node names a prompt, not a role.** Baton dispatches by role: an agent of that role
claims the task. A studio role node carries instructions and a model, with no role reference, so
nobody can claim it. The converter can accept a mapping, and a studio node often carries an empty
string where the value would go, which a naive check accepts and turns into a role nobody can claim.
*Fix: the converter, plus a field in the studio if this becomes routine.*

**Output channels are not artefact kinds.** Clane names a free-text output channel; Baton has a closed
set of artefact kinds, each with a schema the completion gate enforces. Everything converted lands as
`other`, which means no schema validates anything and the gate checks only that something was
submitted. The engine's main quality mechanism is switched off. *Fix: the engine, by letting a workflow
declare its own kinds, or the studio, by choosing from the closed set.*

**A gateway carries no decision.** Clane's validator node has outcomes but no record of which field of
which artefact it reads, so the engine infers the deciding step and reads `verdict`. That works by
luck when the upstream step happens to produce a review. *Fix: the studio should record it; the
converter cannot invent it.*

**Code and action nodes have nobody to run them.** Baton never executes anything: it hands work to an
agent. A code or action node is inline execution, so it converts only by naming a worker role that
does the same thing, and that worker must exist. *Fix: the engine's in-platform executor, which is
already the plan; until then, the converter needs a worker name per node.*

## The walls

**Loop and foreach.** Not a naming problem. Baton's task graph is acyclic, with exclusive gateways and
no fan-out-and-join, so repetition cannot be expressed as tasks at all. The eight-node definition fails
here, and no converter can get past it. *Fix: the engine, and it is a substantial one.*

**Backtrack and escalate edges.** The studio draws edges that send a run backwards. The compiler
already ignores `terminate` as control flow, but has no notion of these two, and an acyclic task graph
cannot honour them. Dropping them is not neutral: in the five-node definition the escalate edge is the
only thing connecting the gateway to the human review, so dropping it leaves an approval that waits for
nothing and a gateway that decides nothing. The run plans and is wrong. *Fix: the engine, or an
explicit refusal to convert a graph that uses them.*

**The silent version of the same problem.** Fed a Clane graph directly, without this converter, the
compiler does not refuse the node types it does not understand: it records them as skipped and carries
on. A definition with code, action or loop nodes would compile into a run that quietly omits steps.
*Fix: the compiler should refuse a node type it cannot express when that node carries an edge, rather
than skipping it.* That is the smallest change on this page and the one I would make first.

## Conclusion

The distance is not in the graph format. It is that Clane's graph assumes an executor that runs steps
itself and may go round again, and Baton's assumes a queue of durable tasks claimed by someone else,
which only ever goes forwards. Everything that maps cleanly is a step someone else does; everything
that breaks is the platform doing the work itself, or doing it repeatedly.

That is an argument for the convergence rather than against it, with one order implied: the in-platform
executor before loops. Once Clane's own node implementations can run as workers claiming tasks, code
and action nodes stop being a wall and become an ordinary role. Loops stay hard, and should be costed
separately rather than discovered inside that work.
