# Acceptance test log

Results against prd.md section 18, recorded 22 and 23 September 2026. Evidence is the test file, or the command and its observed result.
`pnpm test` in `packages/server` runs every test file below against the live Supabase project (it needs the repo-root `.env`).

| # | Phase | Test | Result | Evidence |
|---|---|---|---|---|
| 1 | 1 | Two concurrent claims, one winner | pass | `03_claim.test.mjs` AT1: 8 parallel claims, exactly one winner |
| 2 | 1 | Unheartbeated lease expires, task ready again, attempts 1 | pass | `04_reaper.test.mjs` AT2 |
| 3 | 1 | Unfinished dependency never claimed | pass | `03_claim.test.mjs` AT3 |
| 4 | 1 | Missing consumed artefact never claimed | pass | `03_claim.test.mjs` AT4, AT4b |
| 5 | 1 | max_attempts lands in needs_human and stays | pass | `04_reaper.test.mjs` AT5 |
| 6 | 2 | Real Claude Code session with `.mcp.json` calls whoami and task_next | pass | `claude -p` in a scratch product repo (haiku) claimed TSK-0463 and released it: `{"agent":"http-qa-1","role":"qa","task_key":"TSK-0463","released":true}`, $0.037, 5 turns |
| 7 | 2 | Revoked token rejected, rejection logged as an event | pass | `10_http_mcp.test.mjs` AT7, AT7b (`auth_rejected` event carries the agent id and reason) |
| 8 | 2 | Heartbeat on a reaped lease returns LEASE_LOST | pass | `08_api_core.test.mjs` AT8; `10_http_mcp.test.mjs` AT8 over HTTP |
| 9 | 3 | One ready qa task: supervisor starts exactly one agent, it claims, process exits after submit | pass | `baton supervise --roles qa --once`: one `claude -p` (sonnet) claimed TSK-0476, registered a test_report, submitted (gate passed, done), exited 0 after 38 s, $0.24 |
| 10 | 3 | No ready work: supervisor starts nothing for an hour | pass (compressed clock) | `baton supervise --roles qa --interval 1 --max-ticks 60`: 60 polls, 0 spawns |
| 11 | 4 | Full run yields session_start, tool, turn_end, session_end on one run and one task | pass | TSK-0476 run: prompt, tool ×6, turn_end, session_end on session `2926e6c5…`; session_start confirmed on a later run once SessionStart became a command hook (Claude Code refuses HTTP hooks for SessionStart, seen in its debug log). Also `11_hooks_http.test.mjs` AT11 |
| 12 | 4 | API-key-shaped string stored as [redacted] | pass | `11_hooks_http.test.mjs` AT12 (OpenAI key, GitHub token, connection string, Baton token) |
| 13 | 4 | task_ask leaves task blocked; supervisor answer readies it; answer injected into the next session | pass | `11_hooks_http.test.mjs` AT13 |
| 14 | 4 | Cost accumulates onto the task; over budget moves it to needs_human | pass | `11_hooks_http.test.mjs` AT14; `04_reaper.test.mjs` budget trigger. Real run: daemon posted $0.24 final cost from Claude Code's result message |
| 15 | 5 | design_spec unblocks the frontend task with no human action | pass | `09_gate.test.mjs` AT15 |
| 16 | 5 | Submit without declared artefact rejected, task back to ready | pass | `09_gate.test.mjs` AT16 |
| 17 | 5 | Artefact failing its schema rejected, validation error in the event log | pass | `09_gate.test.mjs` AT17; v1 schemas for 10 kinds seeded from `packages/schemas` |
| 18 | 6 | Killed agent visible on the dashboard within 90 s; force-release returns the task immediately | pass | 23 Sep 06:48 UTC: `claude.exe` of a working agent killed with taskkill; dashboard `/api/status` and `/api/tasks/TSK-0493` showed task ready and agent idle after 4.3 s (daemon posts session-end). Force-release via the dashboard's action route returned TSK-0494 to ready in 1.8 s |
| 19 | 7 | pr task becomes done only after the check reports success | pass | `12_github_http.test.mjs` AT19 (signed check_suite webhooks: requested keeps review, success passes the gate) |
| 20 | 7 | Failing check creates a fix task for the originating role consuming the test_report | pass | `12_github_http.test.mjs` AT20 (task fails, test_report built from the check, fix task ready and claimable by the same role with the same scope) |
| 21 | 8 | Write with no lease denied; `no_lease` event with the attempted path | pass | `11_hooks_http.test.mjs` AT21 |
| 22 | 8 | Stop while holding a task is blocked; agent resumes and submits | pass | `11_hooks_http.test.mjs` AT22 (blocked three times, capped after); real run TSK-0476 shows submission before the final stop |
| 23 | 8 | task_submit by a non-assignee rejected with NOT_ASSIGNED and logged | pass | `09_gate.test.mjs` AT23 (`tool_rejected` event, no artefact registered) |
| 24 | 8 | File edited by a session with no claim appears in the conformance report | pass | `11_hooks_http.test.mjs` AT24 (shadow edit listed with path and tool; daily job stores a row; cron `baton-conformance` at 06:05 UTC) |
| 25 | 8 | Fresh install from the private marketplace, `/baton-core:status` works with no manual copying | pass | In a repo with only `CLAUDE.md`: `claude plugin marketplace add clane-ai/baton --scope project` (SSH clone), `claude plugin install baton-core@clane-ai --scope project`, `install baton-role-qa@clane-ai --scope project`; `claude -p "/baton-core:status"` returned the agent (plugin-qa-1, qa), no task, 0 messages, $0.005 |
| 26 | 8 | Enabling baton-role-qa runs the session as qa with Write and Edit absent | pass | Same repo, `claude -p` asked to list its tools: `Read, Grep, Glob, Bash` |
| 27 | 8 | `claude plugin validate --strict` passes; `claude plugin eval baton-role-qa --threshold 0.8` exits 0 | pass | All 8 plugins and the marketplace validate; eval (sonnet, 3 runs per case, with/without ablation) scored 1.0 on both cases with the plugin against 0.17 and 0.33 without, exit 0, $0.55. Earlier runs found and fixed a regex grader and a weak role instruction |
| 28 | 8 | With `disableSideloadFlags` in managed settings, `--plugin-dir` is rejected | not run | Managed settings apply to every Claude Code session on the machine, including the one building this, and `--mcp-config` is what the daemon's tests use. Template at `docs/templates/managed-settings.json`; run it on a dedicated agent machine |
| 29 | 9 | Two repos on one machine enable different role sets | pass | `baton sync` in scratch-a installed baton-core and baton-role-qa; in scratch-b baton-core and baton-role-analyst; `claude plugin list` in each shows only its set at project scope |
| 30 | 9 | `baton sync` installs a missing role plugin at project scope; second run reports no drift | pass | scratch-b first sync: 2 installs; second sync: "no drift"; `sync_drift` events recorded on the server |
| 31 | 9 | Bump a role plugin, move the project's ref: next spawn runs the new version | pass | baton-role-qa 0.1.0 to 0.1.1 tagged `baton-role-qa--v0.1.1`, marketplace `v0.1.2`; scratch-a ref v0.1.1 to v0.1.2; `baton sync` reinstalled qa at 0.1.1 (the daemon runs sync before its first spawn) |
| 32 | 9 | Revert the ref, `baton sync` returns the machine to the previous version | pass | scratch-a ref back to v0.1.1; `baton sync` reinstalled qa at 0.1.0 |

## Deviations from the spec worth knowing

- Dashboard data path: Next.js route handlers proxy the operator API and the page polls every 5 s; Supabase Realtime and Supabase Auth are not used because the project is shared with other applications (prd.md 15 asked for Realtime).
- Plugin token delivery: Claude Code neither supports HTTP hooks for SessionStart nor substitutes plugin `userConfig` into HTTP hook headers, so `baton-core` carries the CLI and uses command hooks for every event and `headersHelper` for the MCP server. One source of truth for the token: `BATON_TOKEN` or `~/.baton/config.json`.
- CI failures move the task to `failed` and create a fix task (prd.md 8.3 says gate failures return to ready; that still holds for artefact and schema failures at submit time).
- Interim run cost is an estimate from stream-json token counts; the final figure comes from Claude Code's result message and replaces it.

## End-to-end run

On 23 September 2026 the whole pipeline ran with live Claude Code sessions (analyst, frontend-dev, qa, reviewer) against the private repo `clane-ai/baton-e2e`, including a `task_ask` from the developer session answered by a separately spawned analyst session, a real pull request with green GitHub Actions, and the webhook driving the completion gate. Timeline, the message exchange, costs and the defects it exposed are in `docs/e2e-run.md`. Acceptance tests 13 to 16 and 20 to 22 were thereby also exercised with unscripted agents rather than fixtures.

## Delegation run

On 23 September 2026 (afternoon) a frontend-dev session delegated the creation of a config file to backend-dev with `task_delegate`, exited, and was respawned with the result after the backend task passed its gate; it then finished its own task. Timeline and findings in `docs/delegation.md`. Server tests for the mechanism: `13_delegation.test.mjs` (7 pass).
