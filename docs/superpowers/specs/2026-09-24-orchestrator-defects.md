# Three defects in Clane's workflow runtime

**Found while reading the orchestrator on 24 September 2026**, not while looking for bugs. They are
independent of the convergence work and would be worth fixing if that work never happened. References
are to `C:\git\clane.ai` as it stands today.

Owner: whoever owns `packages/api/src/executionEngine`. Raised by the engine side because we read the
code, not because we are asking for it as a dependency.

## 1. A failed node does not stop the run

`runWorkNode` returns the node's output regardless of whether it succeeded
(`workflowOrchestrator.ts:914`), and the switch cases that call it ignore the success flag entirely
(`:1551-1563`). Failure is recorded in the node results (`:892`), in the trace, and by marking that
node's child run failed (`runService.ts:3356`). The walk then follows the first outgoing edge and
carries on. Only a thrown exception escapes, into the detached catch (`:3644-3650`).

So a workflow whose extraction step failed still runs its delivery step, and the run reports whatever
the last node produced. The failure is discoverable in a trace that nobody reads unless something else
goes wrong.

**Why it matters beyond tidiness.** The next node usually consumes the failed node's channel, which now
holds an error string or nothing. Downstream nodes then do the wrong thing with confident output. For
anything that sends, pays or files, this is the difference between a run that failed and a run that did
damage.

**Smallest honest fix:** stop on failure by default, with continuing an explicit property **of the
node**. Not of the edge: "this step is allowed to fail" is how a person describes it, it is one property
rather than a routing concept, and failure routing in the graph is a design worth deciding on its own
rather than arriving as the side effect of a bug fix. Nothing in the real definitions wants failure
routing; the closest thing, a validator's pass and fail outcomes, is a decision rather than a failure.

**Measured, 24 September 2026:** seven parent runs in the history reported success while a child run
had failed, the most recent in June. That proves the behaviour occurs in practice. It does not prove
anything depends on it, and the per-node property means anyone who was relying on it has a one-line
fix rather than a rollback.

## 2. The checkpoint has no lease, and the pending node re-runs at least once

`Run.graphCheckpoint` (`prisma/schema/03-agents.prisma:116-122`) records the pending node, the
channels, the loop counts and the execution count. Nothing in it marks a run as claimed by a process:
there is no lease, no heartbeat and no fencing token. The checkpoint is written after the edge
traversal and before the move (`workflowOrchestrator.ts:1697-1704`), so it is not atomic with the node
run, and the code says the consequence plainly: the pending node "re-runs at-least-once"
(`:1695-1696`).

Recovery relies entirely on the prior process being dead, which the boot path states as its assumption
(`nexa-server.js:1637-1641`). That assumption holds for a single server being restarted. It does not
hold for two instances, a rolling deploy, a container that is replaced while still finishing work, or
any future where the reaper runs somewhere other than the process that died.

**Why it matters.** At-least-once on a model call costs money twice. At-least-once on an action node
that sends an email, posts an invoice or schedules a payment does it twice, and the second one is
indistinguishable from the first to the receiving system.

**Smallest honest fix:** a lease with a heartbeat on the run, so a second process cannot resume one that
is still live, and an idempotency key per node execution for action nodes so a repeat is recognised
rather than repeated.

## 3. Two pieces of walk state are never checkpointed

`lastChannelKey` and `lastOutput` are walk-local (`workflowOrchestrator.ts:690`) and are not part of
the checkpoint. On resume they start empty (`:1424`).

The consequence is specific rather than theoretical. A validator with no explicit reads falls back to
the last output; an output node with no explicit source does the same. After a resume, both fall back
to the workflow's user text or to nothing, so a run that paused for an approval and resumed can
validate or deliver something other than what the previous node produced, with no error anywhere.

**Why it matters.** The record ends up saying that a named person approved a particular thing at a
particular time, and the thing that went out is not that thing. So the audit trail becomes evidence of
something that did not happen, which is worse than having no approval step at all: an approval that does
not bind to the artefact it approved manufactures a false record rather than merely failing to create a
true one. (That framing is the gateway owner's, and it is better than the one this note originally had.)

It is also the failure mode hardest to see: the run completes, reports success, and the content is
wrong. It bites precisely the workflows that pause, which are the ones with a person in them.

**Measured, 24 September 2026:** no run is currently paused awaiting approval with a checkpoint, so
there is nothing in flight for this fix to disturb.

**Smallest honest fix:** put both in the checkpoint. They are two strings.

## One observation about all three

Each of them is invisible in the normal case and only appears under failure, restart or approval. That
is why reading the code found them and running it did not.
