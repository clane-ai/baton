# One engine: Clane workflows and Baton as a single system

**Decision asked for by the user, 24 September 2026:** extend Clane's workflows with what Baton has
built, so that hundreds of agents can automate business processes inside Clane, with a human approval
UI. This spec says how the two become one system without a rewrite of either, and what must be true
before it can carry real business processes.

Owner of this document: `clane-baton-ba` (architecture and engine). Platform rulings belong to the
Clane architect; `packages/api` and the server mounts belong to `clane-ai-f5`; the approvals UI belongs
to `clane-baton-f6`.

## What each side is today

**Clane workflows** (`clane-client/src/components/workflows/studio/**`, `packages/api/src/executionEngine/**`)
are a deterministic node-and-edge graph drawn in a React Flow studio and walked in plain TypeScript:
one pointer, one successor per step, a hundred-node execution cap, language-model calls caged to four
sites. Eleven node types (trigger, role, code, action, router, validator, loop, foreach, human, output,
note). Rich triggers: manual, scheduled, inbound email alias, inbound webhook, at-mention, refire.
State flows through named channels with dot-path templating; every advance writes a graph checkpoint;
runs, turns, traces, cost and tokens are persisted. A `human` node really does pause and resume through
a decision endpoint, and a `validator` node can enforce a JSON schema.

**Baton** (this repository) has no walker. A workflow compiles to task rows. Independent agent sessions
on any machine claim tasks over the agent protocol under a lease with heartbeats. Nine task states,
nineteen artefact schemas enforced by a completion gate, per-task budgets, attempt counts and retry,
idempotency keys, an event stream with outbound webhooks, an operator API, a documents store, and a
human read model (the inbox) with approvals, parked work and open questions.

Read plainly: **Clane knows how to describe and trigger work; Baton knows how to survive it.**

## The shape of the single system

One definition, one queue, two kinds of worker.

1. **One authoring surface.** The studio stays the only place people draw workflows. YAML
   (`docs/workflow-yaml.md`) is the export, diff and git form of the same manifest, not a rival
   authoring path. The studio may only offer semantics the engine actually runs; anything else is a
   drawing, not a workflow. This rule already exists and does not change.

2. **One runtime spine.** A workflow run creates a Baton run, and every node becomes a task. That
   single change gives every node, for free, what the walker cannot give it: a durable state machine, a
   lease that survives a lost process or machine, attempt counts, a budget, idempotency, a completion
   gate, and an audit event per transition.

3. **Two executors, selected by role and not by node type.**
   - *In-platform executor.* A pool of Clane-side workers claims tasks whose role maps to a platform
     capability, and runs today's node implementations unchanged: a role node becomes a turn in the
     conversation, an action node invokes one connector or MCP tool, a code node dispatches to the
     sandbox, router and validator call the classifier. The code moves from a graph walker into a
     worker loop; the behaviour does not change.
   - *External agent executor.* Claude Code sessions on real machines, exactly as Baton runs them now,
     for long-lived engineering, operations and document work.

   The point of binding to the role rather than the node type: a step drawn once as an in-platform role
   can later be served by an external agent, or by a different model, with no change to the graph.

4. **Human steps are tasks, and the approvals UI is the one place they are answered.** A `human` node
   becomes a task in `needs_human`, which is what the inbox already reads. This closes a real gap on
   the Clane side, where the decision endpoint exists but no web surface calls it, and it means one
   approval experience for both engines' work rather than two.

5. **One identity, one audit.** The signed-in Clane user is the actor on every decision (already built:
   `X-Baton-Actor: user:<uuid>`). Baton's event stream feeds the Clane run timeline through the
   existing webhook face, so a run reads as one story whichever executor did the step.

## What must be added before this carries real business processes

These are gaps on both sides today, listed in the order they will hurt.

- **Approver authority.** Neither system enforces who may approve what. Clane echoes an approver role
  without checking it; Baton accepts any operator token. For procure-to-pay this is the difference
  between a demo and a control. Authority belongs in Clane identity (role, licence, limit) and must be
  enforced by the engine, not the screen.
- **Tenancy.** Baton is single-tenant per deployment. Hundreds of agents across a customer base needs a
  tenant on every row and every storage prefix, with row-level security. This is the largest schema
  change in the plan and it is cheapest to decide before the approvals UI locks its data contract.
- **Budgets above the task.** Baton caps a task; nothing caps a run or a tenant per month. Clane
  records cost and caps nothing. A runaway graph of agents is a financial incident, not a bug.
- **Fairness and backpressure.** Claims are per-role with a concurrency limit. At hundreds of agents
  this needs per-tenant concurrency, queue depth limits and a dispatcher that cannot starve one
  customer behind another.
- **Node-level retry with backoff.** Baton counts attempts; the walker has none. Failed nodes today are
  recorded and the walk continues, which is wrong for anything touching money or an external system.
- **An agent registry that both sides read.** Clane already holds agents with prompts, skills and
  tools; Baton holds roles and plugins. One registry, referenced by role from the workflow, materialised
  as either executor.

## Phasing

Each phase is useful on its own and none of them blocks the next from being re-planned.

1. **Approvals UI over Baton.** In flight. Delivers the user's immediate ask and the human surface the
   whole plan depends on.
2. **Clane human nodes become Baton tasks.** Small adapter, both endpoints already exist. Clane's own
   workflows gain the approval UI without touching the walker.
3. **Baton as the queue for Clane nodes.** Start with action and code nodes, which are deterministic
   and idempotent, then role nodes. The walker stays as a fast path for short graphs until it is not
   worth keeping.
4. **Tenancy, authority, budgets, fairness.** The commercial prerequisites above.
5. **Hosting.** Move the engine off Supabase behind the platform proxy once the UI has landed. All the
   logic is in SQL migrations and a framework-free TypeScript layer, so this is a move, not a rewrite.

## Decisions this spec needs

- **Who owns the converged runtime.** Two engines with two owners will diverge again.
- **Tenancy now or later.** Later is cheaper today and expensive the day a second customer exists.
- **Whether the studio becomes the only authoring surface**, with YAML demoted to export. Recommended.
