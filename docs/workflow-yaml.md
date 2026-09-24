# Workflows in YAML

People and agents write workflows as YAML and keep them in git. The designer draws the same document.
Both become the Clane node-graph manifest, and `baton workflow compile` turns that into tasks. The
YAML carries only meaning: who does a step, what it must produce, what it runs after, and when. Layout
belongs to the designer. Every key maps to something the engine enforces today; the linter refuses
anything else, so what you can write is what will run.

```
baton workflow lint    docs/examples/workflows/p2p/workflow.yaml
baton workflow compile docs/examples/workflows/p2p/workflow.yaml --run p2p-121 --input PR-2026-101
baton workflow export  docs/examples/workflows/release-approval/workflow.json    # JSON manifest -> YAML
```

## Shape

```yaml
workflow: Procure to pay          # name; key is derived (procure-to-pay) unless you set `key:`
version: 0.3.0
description: one paragraph
inputs:
  requisition: { type: text, label: Requisition number, required: true }

steps:
  po:                             # step id: letters, digits, _ and -
    role: buyer                   # exactly one of role | human | script
    title: Raise purchase order   # optional; the id, humanised, otherwise
    do: what the step must do     # becomes the task spec, with the workflow input appended
    produces: [purchase_order]    # artefact kinds the completion gate requires
    budget_usd: 1.5

  approve:
    human: purchasing manager     # an approval; parks in needs_human until approve or reject
    after: po
    reads: [purchase_order]       # inputs; the producer becomes a dependency and its artefact is pinned
    decide:                       # the gateway lives on the step that decides
      field: review.verdict       # <kind>.<field> of an artefact this step produces
      outcomes: { yes: approve, no: request_changes }
    deadline: 3h                  # 30m, 3h, 2d; approvals raise approval_overdue when it passes

  send_po:
    script: supplier-erp          # a role served by a script worker, not a model
    after: [approve, po]
    when: approve = yes           # runs only on that outcome; the other branch is cancelled
    produces: [delivery_note, invoice]
    idempotent_by: purchase_order.po_number   # advisory for the script; stated in its task spec
    max_attempts: 3

outputs: [payment, handoff]       # kinds produced by the steps that end the workflow
```

## What each key means to the engine

| Key | Engine |
|---|---|
| `role: x` | a task with `role = x`; any agent whose role is `x` may claim it |
| `human: label` | a task for the built-in `operator` role; goes straight to `needs_human`; decided with `baton tasks approve|reject`; produces a `review` |
| `script: x` | same as `role`, marked `execution: script` in the manifest; served by a worker process such as `integrations/worker.mjs` |
| `after` | `depends_on`; the step is ready when every listed step is done |
| `reads` | pins the producing step's artefact into `consumes`; the linter requires a producer somewhere upstream |
| `produces` | the gate requires one valid artefact of each kind before the task is done |
| `decide` + `when` | an exclusive gateway: `when: approve = yes` becomes a condition on the deciding task's artefact; when the decision lands the other branch is cancelled with `branch_not_taken` |
| `deadline` | `deadline_in_minutes` from compile time; a ready or blocked task past it parks in `needs_human`; an approval past it raises `approval_overdue` |
| `budget_usd`, `max_attempts`, `scope`, `affinity`, `acceptance` | task columns and gate rules |

## What a role is

`buyer` is a **role name**, not an agent. A role is a row in `baton.roles` (created with
`baton seed` or `POST /admin/roles`) with a description, a default model, a definition file
(`.claude/agents/buyer.md` in the workspace) and a fleet-wide `max_concurrent`. A task is created for a
role. An **agent** is an identity with a token (`baton agents add --name p2p-buyer --role buyer`) that
belongs to one role and runs on one machine; any agent of the role may claim the role's tasks. To pin a
step to one agent or one machine use `affinity: p2p-buyer` or `affinity: AIHQ-SERVER`.

`human: purchasing manager` names the role of the person for the reader; today every approval goes to
the shared `operator` role and the label is recorded on the node. Routing approvals to a named person or
group is identity work that belongs with Clane's user model.

`script: supplier-erp` is a role like any other; its agents are worker processes, so the same lease,
gate and retry rules apply to an integration as to a model.

## Not in the language yet

The linter names these and refuses them, so a designer cannot draw what will not run: `on_overdue`
(escalation), `repeat` (loops), `join` (fan-out joins), `retry_backoff`, `timeout` on running steps, and
rejoining two branches of one gateway. Each unlocks when the engine runs it with tests.

## Versioning

`workflow` plus `version` identify the definition; a run records the version it was compiled from
(`baton workflow runs`). Editing the file never changes a running instance; compile again for a new run.
