# Refinements after the first runs (23 September 2026, evening)

Baton is the engine. These close the gaps the day's runs exposed and make workflow runs first-class in Baton itself.

| Change | What it does | How to use |
|---|---|---|
| Task affinity | A task may be pinned to one machine or one agent. Shared queues across machines no longer let the first poller take work meant for another machine. | `baton tasks create --affinity <machine or agent name>`, `baton workflow compile --affinity <machine>`, or `config.baton.affinity` on a node. Only agents on that machine (or that agent) see or claim it. |
| Deadlines | A task past its deadline before it is claimed or while blocked goes to needs_human with a `deadline_passed` event, so nothing waits forever unnoticed. Checked every minute (pg_cron `baton-deadlines`). | `--deadline 2026-09-30T12:00:00Z` on create, or `config.baton.deadline`. |
| Credits | Runs and tasks carry gateway credits beside dollars. Clane workers report credits; nothing is converted. | Spend tab and `baton workflow status` show both. |
| Duplicate daemon guard | A second `baton supervise` for the same checkout on the same machine refuses to start and names the live pid. | Lock in `~/.baton/supervise-<hash>.lock`, cleared on exit or when the pid is gone. |
| Approvals | A built-in `operator` role. Its tasks are human decisions: they never become ready, they go straight to needs_human and appear under Attention. A workflow `approval` node compiles to one. | `baton tasks approve TSK-x [--reason …]` registers an approve review and runs the gate; `baton tasks reject TSK-x --reason …` cancels it, which sends dependants to needs_human. |
| Workflow definitions and runs | `baton workflow compile` stores the manifest under a key and creates a run row. A run's status is derived from its tasks: pending, running, blocked, needs_human, failed, cancelled, done; `finished_at` is stamped when it ends and a `workflow_run_finished` event fires once. | `baton workflow list`, `baton workflow runs`, `baton workflow status --run <key>`; the dashboard's Runs tab lists runs with a progress bar and shows a run's steps. |

Verified live: affinity (a task pinned to another machine is invisible to this machine's agent and still counted globally), the duplicate guard, and the approval workflow `docs/examples/workflows/release-approval/workflow.json` (qa → operator approval → reviewer), run `release-1`.

Not done yet: several delegations from one parent at once (fan-out with a wait), control nodes with conditions evaluated inside Baton, and a separate schema for the test suite.
