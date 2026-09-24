# Procure-to-pay on Baton

A business process, not a software delivery: requisition in, payment out. It exercises everything
Baton has that a workflow orchestrator needs and an LLM cannot be trusted with alone:

| Step | Who | What Baton enforces |
|---|---|---|
| Raise purchase order | `buyer` (Claude Code session) | one `purchase_order` artefact that validates against its schema |
| Approve purchase order | `operator` (a person; simulated by `sim/human.mjs`) | task parks in `needs_human`; a 3-minute deadline raises `approval_overdue` |
| Approved? | exclusive gateway on `review.verdict` | the branch not taken is cancelled, its dependants with it |
| Send PO to supplier | `supplier-erp` (script, `integrations/worker.mjs`) | idempotent side effects; a simulated timeout releases the task and the queue retries it |
| Book goods receipt | `receiving` (Claude Code session) | `goods_receipt` from the count sheet, not from the delivery note |
| Three-way match | `ap-clerk` (Claude Code session) | `invoice_match` with `status` matched or mismatched |
| Matched? | exclusive gateway on `invoice_match.status` | payment or dispute, never both |
| Schedule payment | `bank` (script) | refuses anything not matched; `payment` artefact |
| Rework note / Dispute | `buyer` / `ap-clerk` | `handoff` artefact that is the email to the requester or supplier |

No orchestrator process runs the flow. The compiler turns `workflow.json` into eight tasks per
requisition with `depends_on`, `consumes` and `condition`; the queue readies each task when its
inputs exist and its gateway outcome holds, and the completion gate decides when a step is done.

## Files

- `workflow.yaml`: the workflow in the YAML form (docs/workflow-yaml.md); this is the file to edit.
- `workflow.json`: the same workflow as a Clane node-graph manifest (what the designer exchanges; `baton workflow export` produces the YAML from it).
- `agents/*.md`: role definitions for the three LLM roles; copy them into `<workspace>/.claude/agents/`.
- `integrations/worker.mjs`: the supplier ERP and the bank as Baton agents that are scripts.
- `sim/make-documents.py`: generates the requisition PDFs, emails and master data for eight scenarios.
- `sim/supplier-docs.py`: generates delivery notes, count sheets, invoices, acknowledgements and remittances.
- `sim/human.mjs`: the simulated approver (policy: manager, limit 10,000; forgets one requisition until nudged).
- `masterdata/`: written by the generator into the workspace (vendors, catalogue, policy).

## Run it

```
# roles and agents (once)
baton agents add --name p2p-buyer --role buyer --store           # and receiving, ap-clerk, supplier-erp, bank
# workspace with the documents
python docs/examples/workflows/p2p/sim/make-documents.py ./p2p-run
cd p2p-run && git init && mkdir -p .claude/agents && cp ../docs/examples/workflows/p2p/agents/*.md .claude/agents/ && git add -A && git commit -m ws
# one run per requisition
baton workflow compile docs/examples/workflows/p2p/workflow.yaml --run p2p-101 --input PR-2026-101
# the players
node docs/examples/workflows/p2p/sim/human.mjs --cwd ./p2p-run
node docs/examples/workflows/p2p/integrations/worker.mjs --role supplier-erp --cwd ./p2p-run
node docs/examples/workflows/p2p/integrations/worker.mjs --role bank --cwd ./p2p-run
baton supervise --roles buyer,receiving,ap-clerk --interval 15 --runtime claude   # in ./p2p-run
# watch
baton workflow status --run p2p-101
```

## Scenarios (sim/make-documents.py)

| Requisition | What happens | Expected end |
|---|---|---|
| PR-2026-101 | laptops and docks, clean | paid |
| PR-2026-102 | chairs and paper, clean; the approver forgets it until the overdue nudge | paid |
| PR-2026-103 | three servers, 25,200 EUR, above the approver's authority | rejected (rework note) |
| PR-2026-104 | monitors; supplier invoices 455 instead of 410 per unit | disputed |
| PR-2026-105 | ten desks; eight delivered, ten invoiced | disputed |
| PR-2026-106 | SSDs from a vendor that is not approved | rejected (rework note) |
| PR-2026-107 | cloud VMs in USD; supplier ERP times out once, queue retries | paid |
| PR-2026-108 | consultant days, clean | paid |

The simulation is scored by `sim/score.mjs`: did each run reach its expected end, how many gate
attempts each LLM step needed, what the human decided and how long it took, and what it cost.
Results of the 23 September 2026 run are in `docs/p2p-simulation.md`.
