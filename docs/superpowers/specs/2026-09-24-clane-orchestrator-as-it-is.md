# Clane's orchestrator as it is

**Read on 24 September 2026, description only.** No design proposals: the previous finding was useful
because it reported what is, and a bridge designed against an imagined mechanism would be worse than no
bridge. Everything below is from the source in `C:\git\clane.ai`, with file and line references so it
can be checked rather than believed. The two files are
`packages/api/src/executionEngine/workflowOrchestrator.ts` and `.../runService.ts`.

## 1. The seam: there is half of one

Execution is **spread through the walk**. The walk is a single `while (current)` loop in
`executeWorkflow` (`workflowOrchestrator.ts:1426-1707`) with one `switch (node.type)` at `:1434`
covering every node type.

There are two layers, and only one has a boundary:

- **Work nodes** go through a shared wrapper,
  `runWorkNode(node, exec: () => Promise<NodeExecResult>): Promise<string>` (`:825-915`), used by
  role, code, action and foreach (`:1551-1563`). Per-type executors sit behind it: `execRole` (`:1019`),
  `execCode` (`:1065`), `execAction` (`:1148`), `execForeach` (`:1188`).
- **Control nodes** have no boundary at all. Trigger, note, router, validator, loop, human and output
  are executed inline in the switch body. The `output` case alone runs from `:1439` to `:1548`,
  including projection, file delivery, a summarising model call, its own trace record and its own
  begin/end of a child run.

The cut line for moving one node's execution elsewhere is exactly `const r = await exec()` inside
`runWorkNode` (`:849`). It is a real line, but the executors are **closures over the walk**, not pure
functions: they take only `node` and read `channels`, `lastChannelKey`, `lastOutput`, `args`,
`recorder`, `llm`, `threaded` and `signal` from scope.

What would have to cross that line: the node, the whole rendered channel map, the user text, the merged
role from `buildRoleForNode` (`:508`) with its role and skill resolvers, the model caller, and the
`threaded` dependency bundle (`:770-791`) which carries user and tenant identity, memory and file
stores, the apps service, live connector built-ins, a token callback and an abort signal. Coming back:
`NodeExecResult` (`:810-821`), which is `{output, structured?, succeeded, error?, steps?, model?,
totals?}`.

## 2. How state moves: the walker owns the bookkeeping

A role node does not receive an object. It receives **a string**: the rendered channel map, then the
task, then the workflow input (`:1033-1034`). `renderChannels` (`:263-269`) emits a "workflow state so
far" block with one section per channel, each truncated at four thousand characters (`:56`). Code and
foreach nodes get the same channels instead as **native local variables**, injected by `buildInjection`
(`:361-384`) with every channel name sanitised into an identifier.

Output bookkeeping belongs entirely to the walker (`:856-859`):

```ts
const key = node.data.config.output_key || node.id;
const produced = { output: r.output, ...(r.structured ?? {}) };
channels.set(key, produced); lastChannelKey = key;
```

So every channel has the same shape, an `output` string plus whatever structured fields the node
produced, and **nodes never touch the channel map**. That is the cleanest property in the whole
mechanism and the one most worth preserving.

Channels live in a plain `Map` in memory for the life of the call (`:687`), reaching Postgres only
inside checkpoints. Templating is `resolveVar` (`:796-808`), where the first dotted segment names the
channel; the `{{a.b}}` rendering itself lives in `workflowActions.ts` (`:11-45`), and a whole-string
reference preserves the raw type while an embedded one stringifies.

## 3. Persistence and resume: one pointer, no lease

`Run.graphCheckpoint` (`prisma/schema/03-agents.prisma:116-122`) holds four fields: `pendingNodeId`,
the node to execute next; `channels`, the whole map; `loopCounts`, per-loop iteration counts; and
`executions`, the count feeding the runaway guard.

It is written after **every edge traversal, before moving** (`:1697-1704`), as a best-effort update
(`runService.ts:3576-3585`), and on a human pause with the status overridden to awaiting approval
(`:3631-3636`). Any terminal state clears it to null.

Boot-time recovery reads it: `loadResumableRun` (`:2830-2844`) into `dispatchResume` (`:2851-2925`),
which reloads the definition, flips the status back to running, registers a fresh abort controller and
launches a detached walk with the restored state. The reaper offers every orphan carrying a checkpoint
to that path (`reapOrphans.ts:249-271`), on the stated assumption that at boot "the prior process is
definitively gone, so there's no live walk to double-run" (`nexa-server.js:1637-1641`).

What an external queue driving the advance would collide with, as facts rather than opinions:

- **One pointer.** `pendingNodeId` is a single node. There is no representation of two nodes pending.
- **No lease and no fencing.** Nothing marks a checkpoint as claimed, and safety rests entirely on the
  old process being dead.
- **The checkpoint is not atomic with the node run**, and the code says so: the pending node
  "re-runs at-least-once" (`:1695-1696`).
- **Two pieces of walk state are never checkpointed**, `lastChannelKey` and `lastOutput` (`:690`,
  `:1424`). After a resume, a validator with no explicit reads and an output node with no explicit
  source fall back to the user text or to nothing.
- **The recorder, the model draft and the node results restart empty** on resume, because they are
  closure variables rather than persisted state.

## 4. The human node: the closest thing to a task waiting for a person

On arrival (`:1629-1673`) the walk records an approval-gate trace step, pushes a node result reading
"awaiting approval", and **returns**. Nothing blocks, no promise is held, and no child run or turn is
opened for it, because those are only created by the work-node wrapper and the output case. `pause`
(`:748-767`) returns the awaiting-approval marker and the checkpoint.

The caller persists the run as awaiting approval with that checkpoint, emits the event, and flips the
parent conversation to the same state (`runService.ts:3631-3638`, `:3899-3909`). The finally block
still revokes the run-scoped key, closes the connector host and releases the controller
(`:3651-3666`), so a paused run holds **no in-memory residue at all**. That is the single most
important fact in this document: Clane already has a node type whose semantics are exactly a durable
wait.

Resuming is a decision endpoint (`agentWorkflows.js:396-419`) calling `resumeWorkflowRun`
(`:2931-2945`), which requires the caller to be the run's creator, the status to be awaiting approval
and a checkpoint to exist, then dispatches a **fresh detached walk**. On that walk, channels and loop
counts are rehydrated, the trigger channel is deliberately not re-seeded, the pre-flight contract check
is skipped, and the pointer is set to the pending node (`:1399-1423`). Re-entering the human node with
a decision maps it to an approved or rejected outcome and leaves through the normal edge-following
(`:1649-1660`). Arriving without one, which is what crash recovery does, pauses again.

## 5. Next-node selection: first match wins, and failure does not stop

The pointer is a local variable (`:1409`), starting at the first trigger node or else the first node in
the list. Successors come from an outgoing-edge map built once (`:699-704`). Each iteration seeds an
outcome from the node's first declared outcome, which the control types then overwrite. Selection is
one line (`:1680-1684`): the first edge whose `sourceHandle` equals the chosen outcome, **else the
first edge**. Multiple successors are therefore not fan-out; nothing runs in parallel from a branch.

No outgoing edge finishes the run with a message saying so. A terminate edge ends it. A missing target
fails it.

**A failed node does not stop the walk.** The wrapper returns the node's output regardless of whether
it succeeded (`:914`), and the switch cases ignore the success flag entirely. Failure is recorded in
the node results, in the trace, and by marking that node's child run failed, and then the walk follows
the first edge and carries on. Only a thrown exception escapes into the detached catch.

The runaway guard is a hundred node executions by default (`:55`, `:692`), checked at the top of every
iteration (`:1428-1429`). Loop nodes additionally cap their own iterations, defaulting to three
(`:1601-1627`).

## 6. What is genuinely single-process

- **The run is started by a detached, unqueued call**, `void this.executeWorkflowDetached(...)`
  (`:2822`, and the same on resume at `:2914`). There is no job queue for the walk itself; the job
  queue in the codebase serves only the orphan reaper.
- **The whole walk is one awaited async call** held inside that detached promise, with every node
  boundary an `await` inside it.
- **Walk state is in memory**: channels, loop counts, node results, the trace recorder, the model
  draft, the last channel key and output, and the execution count (`:684-692`).
- **Cancellation is a process-local map of abort controllers**, and the code says so in a comment:
  single-process only, a multi-worker deployment would need a shared signal (`runService.ts:944-948`).
- **Foreach concurrency is in-process promises** over a shared cursor, capped at twenty (`:1193`,
  `:1265-1288`), with its abort flag, first error and results as plain closure variables.
- **Per-run resources are held across node boundaries**: the connector host with live connections and a
  run-scoped API key minted at the start and revoked in the finally block (`:3206-3215`, `:3654-3659`).
- **Telemetry is a process-wide event emitter** and is explicitly not persisted
  (`runEventBus.ts:30-35`).
- **Recovery is boot-triggered rather than queue-triggered**, with no heartbeat or lease on a
  checkpoint.

## The one-paragraph summary

The mechanism is a single in-process pointer walking a graph, with channel bookkeeping owned by the
walker rather than the nodes, a checkpoint written after each advance that records one pending node and
no claim, and a pause-and-resume path for human decisions that already releases every in-memory
resource and restarts from the checkpoint as a fresh walk. Work nodes have a real execution boundary;
control nodes have none. Failure is recorded and stepped over rather than stopping the run.
