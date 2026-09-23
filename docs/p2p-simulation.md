# Procure-to-pay simulation, 23 September 2026

What was run, what came out, and what it changed in Baton. The example itself lives in
`docs/examples/workflows/p2p/` (manifest, role files, integrations, simulator, scorer).

## Setup

- Process: requisition → buyer raises a purchase order (LLM) → a person approves (simulated) →
  supplier ERP acknowledges, ships and invoices (script) → goods-in books the receipt (LLM) →
  AP three-way match (LLM) → bank schedules payment (script); rejected orders end in a rework
  note, mismatched invoices in a dispute email. Two exclusive gateways, no orchestrator process.
- Documents: eight requisition PDFs with covering emails, vendor master, catalogue, purchasing
  policy; per order the integrations produced the PO email, the acknowledgement, a delivery note
  PDF, a warehouse count sheet, an invoice PDF and email, and a remittance advice.
- Human: `sim/human.mjs` plays a purchasing manager with a 10,000 limit, reads each PO, decides
  by policy with a written reason, takes 20 to 50 seconds, and forgets one requisition until the
  `approval_overdue` event (3-minute deadline on the approval node) nudges her.
- Scenarios: 4 clean (one in USD with a simulated ERP timeout), 2 rejections (over limit; vendor
  not approved), 2 invoice mismatches (price +11%; 8 of 10 delivered, 10 invoiced).
- Reviewer: session clane-baton-f6, read-only, scored every artefact against the documents.

## Results

| | First batch (8 runs) | Blind reruns (3 runs) |
|---|---|---|
| Reached the expected end | 8 of 8 (one after `baton tasks retry`) | 3 of 3 |
| Human decisions matching policy | 8 of 8 | 3 of 3 |
| LLM artefacts accepted first time | 4 of 24 (17%) | 9 of 10 (90%) |
| Schema rejections per LLM step | 1.13 | 0.10 |
| Attempts lost to the session-overlap bug | 5 (+3 on the parked task) | 0 |
| LLM spend | $4.66 | $1.19 |
| Average end to end | 5.8 min | 2.9 min |

Money: no purchase order, goods receipt, invoice match or payment mis-stated an amount, quantity
or vendor in any run (reviewer's finding). The 225.00 EUR overbilling and the 1,240.00 EUR
short-delivery variance were both identified, disputed, and not paid.

Integration: the simulated supplier timeout released the task with a reason and the queue
reclaimed it one second later; the documents it produced were identical (idempotent by PO number).

## What the simulation found in Baton

1. **Session overlap released a sibling's lease** (reviewer finding E). With three sessions allowed
   per role, the daemon started a second Claude Code process for the same agent while the first was
   still starting; the idle one exited and its session-end released the working one's task. Six
   steps lost an attempt, one run parked in `needs_human`. Fixed: one session per agent identity in
   the daemon; `claims.session_id` stamped from the `X-Baton-Session` header (daemon, hooks and
   scripts); `session_end` releases only a task its own session claimed (migration 003300).
2. **Scenario labels leaked** through the requisition email subjects, so the first batch's detection
   cases were not blind. Subjects made neutral; the three detection scenarios rerun blind.
3. **Open shapes drifted.** Schema-valid but inconsistent keys (invented names, GRN numbers read two
   ways, three date formats). Prompts now give the exact key list; the three LLM-produced kinds are
   `additionalProperties: false`; rejections fell from 1.13 to 0.10 per step.
4. **`needs_human` was terminal.** `baton tasks retry` added (reset attempts, budget, deadline,
   drops inputs pinned to a cancelled child); used to finish the parked run.
5. Earlier review fixes applied before the first batch: gateway conditions read the latest artefact;
   resumes after a question or delegation do not burn attempts; cascade-cancelled steps count as
   branch-not-taken in the run status; `approval_overdue` for overdue operator tasks; the compiler
   refuses rejoins and nodes fed by two gateways.

## Still open (reviewer, ranked)

Operator token stored next to agent tokens on a machine that runs agents; a full-access test login
role on the database; the scope gate does not cover Bash or MCP writes; dashboard lacks approve,
reject and a `failed` state; webhook retries have no backoff; a delegation child parked in
`needs_human` strands its parent; unanswered role questions respawn sessions every 10 minutes;
`task_create` over MCP accepts privileged fields. See the review notes in the repository history.

## Reproduce

See `docs/examples/workflows/p2p/README.md`. Results of this run: `p2p-results.json` produced by
`sim/score.mjs`; run keys p2p-101 to p2p-108 and p2p-114 to p2p-116 on the shared project.
