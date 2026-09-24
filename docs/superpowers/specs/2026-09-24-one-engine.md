# One engine: Clane workflows and Baton as a single system

**Decision asked for by the user, 24 September 2026:** extend Clane's workflows with what Baton has
built, so that hundreds of agents can automate business processes inside Clane, with a human approval
UI. This spec says how the two become one system without a rewrite of either, and what must be true
before it can carry real business processes.

**Status:** the three shape questions below were ruled by the Clane architect on 24 September 2026 and
are recorded here as settled, not proposed. The three fit conditions attached to that ruling are
answered in their own section. Whether the programme starts is the user's call; the architect has
flagged it as multi-week work.

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

1. **One authoring surface.** The studio is the only place people draw workflows. The YAML and manifest
   form (`docs/workflow-yaml.md`) is export, diff and version control, never a rival authoring path.
   Two authoring paths are two sources of truth, which is the same failure as two engines one layer up.
   The studio may only offer semantics the engine actually runs; anything else is a drawing, not a
   workflow.

2. **One runtime spine.** A workflow run creates a Baton run, and its nodes become tasks. That single
   change gives durable steps what the walker cannot give them: a state machine, a lease that survives
   a lost process or machine, attempt counts, a budget, idempotency, a completion gate, and an audit
   event per transition. Which nodes pay for a task and which do not is answered under fit condition
   (a) below.

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

## Ownership (ruled)

- **The converged runtime** (queue, lease, state machine, executor contract) is owned by the engine
  owner, `clane-baton-ba` today.
- **The definition** (studio and manifest), **the node implementations** and **the UI** are owned by
  the Clane platform.
- **The existing graph-walker executor is retired, not maintained in parallel.** Two executors with two
  owners is precisely the divergence this spec exists to prevent, and the only durable remedy is that
  the second one stops existing. Retirement is a deliverable, not an aspiration; the cutover plan is
  fit condition (b).
- **Ownership transfer, agreed in advance.** When the engine moves into Clane's Postgres (phase 5),
  ownership of the runtime moves with it to the platform and backend owner. Deciding this now costs
  nothing; renegotiating it mid-migration is expensive.
- **One bounded exception.** The command line keeps a local workflow runner for interactive,
  single-machine use. It is a conformant lightweight executor of the same definition and the same node
  semantics, not a fork and not a rival semantics path. Drift from the contract is a bug in it, never a
  variant of it.

## Tenancy (ruled: now)

The converged schema carries a tenant on every row and a tenant prefix on every stored file, with
row-level security, from the start. This **revises** the earlier single-tenant ruling, which was scoped
to a narrow first integration; the direction of one system with hundreds of agents changes the premise.
Clane's platform is already multi-tenant, the converged runtime serves it, and tenancy is the single
most expensive thing in this plan to retrofit.

**Caveat, so nobody churns:** this does not touch the approvals proxy now in flight. That integration
stays on an environment-held operator token and one deployment per customer. The ruling is about the
converged runtime's schema, not about work already underway.

## Where the section lives (ruled)

**Workflow is a top-level section of the product**, a sibling of Build, Settings and Admin, inside the
main client application. It is not a separate build. In the client that means one entry in the
canonical route set, one entry in the named sub-section table beside settings, admin and build, one
left rail entry and one render branch in the shell. This overrules the earlier separate-build pick,
which was correct only while this was a standalone area; a separate build cannot share routes or state
with a studio that lives in the main application.

**The section carries everything except the inbox**: the workflow definitions, runs, a single run,
documents, activity and spend. The work item screen, where a person acts on one thing, lives in the
section too, and returns the person to Home once a decision is recorded, because that is where the rest
of their queue is.

**The studio moves into the section**, and its old address in the build section aliases to the new one.
The alias must resolve to a single canonical address by redirecting, never a second route rendering the
studio independently: two live addresses for one surface is the same divergence one layer down, and the
route module's legacy alias table exists to prevent exactly that. Leaving authoring in Build while
operations live in Workflow would also reproduce the authoring and execution split at the interface
layer, which is the two-halves problem this convergence exists to end.

Note for anyone reading the repository: the separate `studio` build there is a different surface, the
skills and tools area, and is not the workflow graph studio.

**The inbox lives on Home**, which is where a person lands, because approvals are what interrupts
someone while the rest of the section is somewhere you go on purpose. Architectural rule: Home shows a
summary view of **the one inbox**, the same component and the same data in a summary mode, never a
second implementation. Two inboxes would drift, and the wrong one would be the one people see first.
How much Home shows and how it looks is a product design decision for the user and the interface owner.

**Consequences, all of them simplifications.** The static mount and the deep-link fallback built for a
separate area are not needed, because a route in the main application needs neither. The entitlement
predicate, the gate on the platform interface and the module list reported to the client all stay,
because they still decide whether the interface answers and whether the section is offered.

**The wiring lands dark, except on the development box.** Because the section is gated by the
entitlement and the module list, the commit that wires it ships a route nobody can reach and a rail
entry nobody is shown: the feature turns on with configuration, not with the commit. That gives two
independent safety nets, a revert for the structure and a flag for the exposure. The exception matters
because it is where people will be looking: the development deployment licenses every module by
wildcard, so the section lights there the moment the wiring lands. Seeing it on development is not a
gating defect, and development cannot prove the switched-off behaviour. That branch is proved by tests
with an explicit module list, not by looking.

**Naming.** The area key, the entitlement and the section are named `workflow`. The operational
interface is a distinct compound resource name sitting beside the existing workflow registry, matching
this codebase's own precedent where a compound run resource sits beside its plural parent. It is not
nested under the registry: nesting would depend on route declaration order holding forever, and that
shadowing trap has already fired in this repository once. This supersedes the earlier preference for
nesting.

## Fit conditions

### (a) Per-node task overhead

"Every node becomes a task" is right for steps that can fail on their own, take real time, or need a
person. It is too expensive for trivial control flow: a lease, a gate and an attempt count per branch
node is real cost, and a five-node workflow must not become slow in order to prove the model.

The queue boundary therefore sits where durability is actually needed:

- **Durable tasks**: role nodes, action nodes, human nodes, any node calling an external system, and
  any node with a budget, an idempotency key or a retry policy. These pay the full price and earn it.
- **Inline steps**: router, validator, loop and branch evaluation, and trivial code nodes, are executed
  by the dispatcher or folded into the claiming worker's existing lease as part of the neighbouring
  task. They are recorded as events and trace rows, so they remain visible and auditable, but they do
  not cost a claim round trip each.

The compiler decides the class from the node type and its declared properties, and the linter states
the class for every node so that authors can see what they are buying. The overhead target is
measured, not assumed: a workflow of only inline steps must cost no more than one claim in total, and
the per-advance cost of an inline step must stay well under a tenth of a second. If the measurement
fails, the boundary moves, not the target.

### (b) Cutover from the graph walker

Retiring the walker must not break a single existing workflow. The invariant from the designer applies
unchanged: what you can author is exactly what will run.

1. **Shadow.** Both executors run the same definitions, with the walker authoritative and the queue
   shadowing. Per node, compare the resulting channels, the terminal outcome and the cost.
2. **Compare and fix.** Differences are defects in the queue path until proven otherwise. The
   comparison runs until a defined quiet period passes with no unexplained divergence.
3. **Flip per workflow**, behind a flag, so a single definition can be moved and watched rather than
   the whole estate at once.
4. **Keep rollback for one release**, then delete the walker. Retirement is only complete when the code
   is gone, not when it is unused.

### (c) Approver authority is first, not one of four

Ranked first among the prerequisites below, and stated plainly: an approvals product where anyone who
can see an item can approve it is not commercially shippable. It does not block the build of the
approvals area now in flight, but it must land before that surface is trusted with real business
decisions. Authority belongs in Clane identity (role, licence, limit) and must be enforced by the
engine, not by the screen.

## What must be added before this carries real business processes

In priority order.

1. **Approver authority.** Neither system enforces who may approve what. Clane echoes an approver role
   without checking it; Baton accepts any operator token.
2. **Budgets above the task.** Baton caps a task; nothing caps a run or a customer per month. Clane
   records cost and caps nothing. A runaway graph of agents is a financial incident, not a bug.
3. **Fairness and backpressure.** Claims are per-role with a concurrency limit. Hundreds of agents need
   per-tenant concurrency, queue depth limits, and a dispatcher that cannot starve one customer behind
   another.
4. **Node-level retry with backoff.** Baton counts attempts; the walker has none. A failed node today
   is recorded and the walk continues, which is wrong for anything touching money or an external
   system.
5. **An agent registry both sides read.** Clane holds agents with prompts, skills and tools; Baton holds
   roles and plugins. One registry, referenced by role from the workflow, materialised as either
   executor.

## Phasing

Each phase is useful on its own and none of them blocks the next from being re-planned.

1. **Approvals UI over Baton.** In flight. Delivers the user's immediate ask and the human surface the
   whole plan depends on.
2. **Clane human nodes become Baton tasks.** Small adapter, both endpoints already exist. Clane's own
   workflows gain the approval UI without touching the walker.
3. **Baton as the queue for Clane nodes.** Start with action and code nodes, which are deterministic
   and idempotent, then role nodes, under the shadow and flip plan in fit condition (b).
4. **Tenancy, authority, budgets, fairness.** Tenancy lands in the converged schema from the start of
   this work rather than after it; authority is first among the rest.
5. **Hosting.** Move the engine off Supabase into Clane's Postgres behind the platform proxy. Runtime
   ownership transfers with it. All the logic is in SQL migrations and a framework-free TypeScript
   layer, so this is a move, not a rewrite.
