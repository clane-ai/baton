# Acceptance test log

Results against prd.md section 18. Evidence is the test file or the command that proves it.
`pnpm test` in `packages/server` runs everything marked "node test".

| # | Phase | Test | Result | Evidence |
|---|---|---|---|---|
| 1 | 1 | Two concurrent claims, one winner | pass | `03_claim.test.mjs` AT1 (8 parallel claims) |
| 2 | 1 | Unheartbeated lease expires, attempts 1 | pass | `04_reaper.test.mjs` AT2 |
| 3 | 1 | Unfinished dependency never claimed | pass | `03_claim.test.mjs` AT3 |
| 4 | 1 | Missing consumed artefact never claimed | pass | `03_claim.test.mjs` AT4, AT4b |
| 5 | 1 | max_attempts lands in needs_human and stays | pass | `04_reaper.test.mjs` AT5 |
| 6 | 2 | Real Claude Code session calls whoami and task_next | pass | 2026-09-23: `claude -p` in the scratch product repo with `.mcp.json`, model haiku, claimed TSK-0463 and released it. Result `{"agent":"http-qa-1","role":"qa","task_key":"TSK-0463","released":true}`, cost $0.037, 5 turns |
| 7 | 2 | Revoked or bad token rejected and logged | pass | `10_http_mcp.test.mjs` AT7, AT7b (event `auth_rejected` with agent id and reason) |
| 8 | 2 | Heartbeat on reaped lease returns LEASE_LOST | pass | `08_api_core.test.mjs` AT8, `10_http_mcp.test.mjs` AT8 over HTTP |
| 15 | 5 | design_spec unblocks the frontend task with no human action | pass | `09_gate.test.mjs` AT15 |
| 16 | 5 | Submit without declared artefact rejected, task back to ready | pass | `09_gate.test.mjs` AT16 |
| 17 | 5 | Artefact failing schema rejected with error in event log | pass | `09_gate.test.mjs` AT17 |
