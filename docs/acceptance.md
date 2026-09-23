# Acceptance test log

Results against prd.md section 18. Evidence is the test file or the command that proves it.
`pnpm test` in `packages/server` runs everything marked as a test file (needs the repo-root `.env`).

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
| 9 | 3 | Supervisor starts exactly one agent for one ready qa task; process exits after submit | pass | 2026-09-23 06:13 UTC: `baton supervise --roles qa --once` spawned one `claude -p` (sonnet) which claimed TSK-0476, registered a test_report, submitted (gate passed, task done) and exited with code 0 after 38 s, cost $0.24 |
| 10 | 3 | No ready work: supervisor starts nothing for an hour | pass (compressed clock) | `baton supervise --roles qa --interval 1 --max-ticks 60`: 60 polls, 0 spawns |
| 11 | 4 | Full agent run produces session_start, tool, turn_end, session_end correlated to one run and task | pass | TSK-0476 run: events prompt, tool ×6, turn_end, session_end all on session `2926e6c5…` and TSK-0476, run row closed with exit reason. Note: Claude Code refuses HTTP hooks for SessionStart (debug log: "HTTP hooks are not supported for SessionStart"), so SessionStart is a command hook (`baton hook session-start`); HTTP simulation in `11_hooks_http.test.mjs` |
| 12 | 4 | API-key-shaped string stored as [redacted] | pass | `11_hooks_http.test.mjs` AT12 (OpenAI key, GitHub token, connection string, Baton token) |
| 13 | 4 | task_ask leaves task blocked; supervisor answer readies it; answer injected into next session | pass | `11_hooks_http.test.mjs` AT13 |
| 14 | 4 | Cost accumulates onto the task; over budget moves it to needs_human | pass | `11_hooks_http.test.mjs` AT14 (usage via `/runs/usage`), `04_reaper.test.mjs` budget trigger |
| 15 | 5 | design_spec unblocks the frontend task with no human action | pass | `09_gate.test.mjs` AT15 |
| 16 | 5 | Submit without declared artefact rejected, task back to ready | pass | `09_gate.test.mjs` AT16 |
| 17 | 5 | Artefact failing schema rejected with error in event log | pass | `09_gate.test.mjs` AT17; schemas for 10 kinds seeded from `packages/schemas` |
| 21 | 8 | Write with no lease denied, `no_lease` event with path | pass | `11_hooks_http.test.mjs` AT21 |
| 22 | 8 | Stop while holding a task is blocked, agent resumes and submits | pass | `11_hooks_http.test.mjs` AT22 (blocked three times, then capped); real run TSK-0476 shows turn_end followed by submission ordering |
