# Baton app: UI/UX brief and contract

Owner split, decided 24 September 2026:

- **UI and UX** (`packages/dash`): session `clane-baton-f6` designs and builds it. Reference: the two
  order-to-cash screenshots the user supplied (a work queue with counts, filters and an AI tag per row; a
  detail screen with the source email and PDF on the left, the extracted document with per-field source and
  confidence on the right, an activity log, and Save Draft / Approve at the bottom).
- **Architecture and the engine** (`packages/server`, `packages/cli`, schemas, migrations, edge function):
  session `clane-baton-ba`. The UI never changes engine code or SQL; when a screen needs data or an action
  the API does not have, it is requested from the engine owner as a named endpoint and added there.

Delivery follows the customer's SoW model (EolasFlow AI Limited): **M1 design signed off** by the user
before build, **M2 build complete and UAT ready**, **M3 UAT passed**, **M4 handover** (code in the
customer's repository, documentation). Weekly written status. Nothing is out of scope by accident: what is
not built is listed.

## What the engine gives the UI today (operator API, proxied by `packages/dash/lib/baton.ts`)

| Need | Route |
|---|---|
| Queue counts, agents, attention list | `GET /admin/status` |
| Tasks by state, role, run | `GET /admin/tasks?state=&role=&workflow_run=&limit=` |
| One task with artefacts, consumed inputs, events, claims, messages | `GET /admin/tasks/:key` |
| Decide an approval | `POST /admin/tasks/:key/approve {verdict: approve|reject, reason}` |
| Put a parked task back | `POST /admin/tasks/:key/retry {reset_attempts, budget_usd, deadline, reason}` |
| Cancel, reprioritise, force-release | `POST /admin/tasks/:key/cancel|prioritise|force-release` |
| Answer a question from an agent | `POST /admin/answer {message_id, body}` |
| Runs and one run with its steps, conditions and costs | `GET /admin/workflow-runs`, `GET /admin/workflow-runs/:key` |
| Workflows (definitions) | `GET /admin/workflows`, `GET /admin/workflows/:key` |
| Event stream | `GET /admin/events?task=&agent=&type=&since=&limit=` |
| Artefacts by kind or task | `GET /admin/artifacts?kind=&task=` |
| Spend | `GET /admin/spend` |
| Roles, agents | `GET /admin/roles`, `GET /admin/agents` |
| Workspace documents (pdf, text, email) | dashboard-local `GET /api/workspace?path=` (BATON_WORKSPACE) |

Artefact kinds and their JSON Schemas: `packages/schemas/*.json`. Workflow definitions: `docs/workflow-yaml.md`.
Events worth surfacing: `approval_required`, `approval_overdue`, `gate_failed`, `artifact_rejected`,
`branch_not_taken`, `deadline_passed`, `task_retried`, `workflow_run_finished`.

## What the engine does not have yet (ask, do not fake)

- Per-field source and confidence inside artefacts (the schemas carry values only). The engine owner will
  add an optional `_provenance` map per artefact kind when the design needs it.
- Approver authority (who may approve what amount). Today any operator token can approve; the policy check
  on the purchase order says what level the amount needs. Enforcement belongs with Clane identity.
- An AutoPilot threshold (skip the approval when confidence is high). Would be a gateway condition; not built.
- Escalation on `approval_overdue`; loops; fan-out joins; rejoin after a gateway.
- Draft decisions ("Save Draft"). A decision is final when posted; drafts would be UI-local state.

## Constraints

- Next.js 15, React 19, no UI library today; adding one is a design decision to state in M1, not a default.
- The dashboard is unauthenticated and local; it runs with an operator token from the server environment.
  Do not add login; identity comes from Clane later.
- Keep the operator console (Now, Board, Flow, Runs, Stream, Attention, Spend) working; the human-facing
  surface (Inbox and what follows it) is the new product face.
- Real data only: the P2P runs p2p-101 to p2p-122 and the workspace documents are the test fixtures.
