# Bridging the two runtimes: a design, argued from the code

**Follows** the description in `2026-09-24-clane-orchestrator-as-it-is.md`. That document reported the
mechanism; this one proposes what to do about it. Where the two disagree, the description wins, because
it has line numbers.

## The steer, tested rather than confirmed

The convergence specification says durable tasks for the expensive steps and inline execution for
control flow, written before either side had read this code. **The code supports the split and
contradicts the boundary.**

Supports it: work nodes really do pass through one wrapper with a single await
(`workflowOrchestrator.ts:825-915`, the cut at `:849`), which is a genuine seam. Control flow really is
a pointer following edges, which has nothing worth making durable.

Contradicts it: the boundary is not node-type-shaped.

- **Router, validator and loop call a model.** They go through `classify` (`:1318`) and `validate`
  (`:1364`). They are not cheap and they are not deterministic. Treating them as free inline control
  flow means a model call with no budget, no retry policy and no record as work.
- **The output node is a work node in disguise.** Its case runs from `:1439` to `:1548` and includes
  projection, file delivery, a summarising model call and its own child run. It is inline only by
  accident of where it was written.
- **The human node is inline and is the most durable thing in the system.** It returns rather than
  blocks, holds nothing, and resumes from a checkpoint.

So the predicate is not "is this a work node". It is **does this step call a model or an external
system, or can it wait**. Under that predicate: role, code, action, foreach, output and human are
durable; router, validator and loop are durable when they classify and inline when their rule is
deterministic; trigger and note are structural.

Recommendation: keep the split, restate it as that predicate, and let a node's configuration decide
rather than its type.

## Start with the human node, and change nothing else

Agreed, and the code makes the case better than the argument does. On arrival the walk records a trace
step, returns `pause(node)` (`:748-767`, `:1629-1673`), opens no child run, and the finally block
revokes the run-scoped key and closes the connector host (`runService.ts:3651-3666`). A paused Clane run
already holds nothing.

The bridge is therefore additive:

1. On reaching a human node, before pausing, create a Baton task for the operator role carrying the
   run, the node, the rendered channels and the approver role. Then pause exactly as today.
2. When that task is decided, the engine's existing event stream calls the platform, which calls its
   own resume path (`resumeWorkflowRun`, `runService.ts:2931-2945`) with the decision.
3. The walk resumes as a fresh detached walk from its own checkpoint, as it already does.

**Nothing about the walker changes.** No node execution moves, no channel bookkeeping moves, the
checkpoint format is untouched. What changes is that the approval appears in the approvals screen
alongside every other waiting decision, with an actor recorded, a deadline, an audit trail and an
overdue signal, none of which the platform has today.

Two things to get right rather than discover. The decision endpoint currently requires the caller to be
the run's creator (`:2931-2945`); an approval arriving from the engine is being made by a different
person, which is the point of an approval, so that check has to become an authority check rather than
an ownership one. And the engine must be the record: if a decision exists in both places they will
disagree eventually, so the platform should treat the task as the source and its own state as a mirror.

## The real cost is the dependency bundle

The queue is not the work. A node executing in a worker cannot inherit what a closure gives it today
(`:770-791`), and each piece has to be re-established per task rather than per run:

| Held today | Held how | What a worker needs |
|---|---|---|
| user and tenant identity | closure over the run | carried on the task, and trusted by the worker |
| memory and file stores | per-run handles | opened per task from the same identity |
| live connector built-ins | an open host with live connections | opened per task, paying that cost per step rather than per run |
| a run-scoped API key | minted at start, revoked in `finally` (`:3206-3215`, `:3654-3657`) | a credential scoped to the task, with its own lifetime |
| the model caller | closure | ordinary, the only easy one |
| the abort signal | a process-local controller map (`:944-948`) | the engine's lease and cancellation as the signal |
| token streaming | a process-wide emitter, not persisted (`runEventBus.ts:30-35`) | either dropped for queued nodes, or transported |

Two of those are genuinely hard. **The run-scoped key** exists for the lifetime of a walk measured in
seconds; a task may be claimed minutes or hours later, so it needs a credential with a task lifetime,
which is a new thing rather than a moved one. **The connector host** holds live connections that cannot
be serialised, so per-task reconnection changes the cost and latency profile of every action node.

**Token streaming is the honest casualty.** A queued node cannot stream into a process-wide emitter in
another process. Either queued nodes lose live token output, or that transport becomes real work. I
would accept losing it for queued nodes first and revisit it, rather than build a streaming bus to
make a migration invisible.

## What the engine must supply, and already does

Claiming with a lease and a heartbeat; attempts, retry and a budget per task; idempotency keys, which
the action nodes need more than anything else here; a completion gate; an event per transition; and the
operator surface for anything that waits on a person. None of this has to be built.

What it does not supply, and would need: the channel map travelling as task input and the result
returning as a channel, which is the one place the platform's cleanest property has to be preserved
deliberately. Today the walker owns the bookkeeping (`:856-859`) and nodes never touch channels. That
must stay true: a task carries rendered channels in, returns an artefact, and the advance writes the
channel from it. If a worker ever writes a channel directly, the property is gone.

## Order

1. **The human node**, as above. Additive, reversible, and it delivers the approvals surface to Clane's
   own workflows immediately.
2. **The three runtime defects**, written up separately. They are prerequisites rather than politeness:
   at-least-once with no lease, plus a run that continues past a failed node, is exactly the combination
   that makes a queue dangerous rather than safer.
3. **One work node type on the queue**, behind a per-node flag, with the walker shadowing it: code
   first, because it is the most deterministic and needs the least of the dependency bundle.
4. **Action nodes**, only once idempotency keys are carried, because those are the ones that send and
   pay.
5. **Role nodes**, which need the whole bundle.
6. **The classifying control nodes**, reclassified as durable or left inline per configuration.
7. **Loops**, costed separately as agreed, and not discovered inside step three.

## What would make me wrong

If the dependency bundle cannot be reconstructed per task at acceptable cost, particularly the
connector host, then the in-platform executor is not a worker claiming tasks but a thin shim that keeps
a warm run context and pulls work into it. That is a different design with different failure modes, and
it would be better to discover it at step three with one node type than at step five with all of them.
