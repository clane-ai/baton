# End-to-end run with live Claude Code agents

Date: 23 September 2026, 07:37 to 07:42 UTC. Target repo: https://github.com/clane-ai/baton-e2e (private). Everything below happened with real Claude Code sessions spawned by `baton supervise`, the installed `baton-core` plugin providing the MCP server and the gates, GitHub Actions as CI, and the GitHub webhook driving the completion gate. No step was simulated.

## Set-up

- A tiny Node 22 project (`src/greeting.js`, `test/greeting.test.js`, `npm test`), CI workflow on pull requests, the product settings template, the coordination protocol in `CLAUDE.md`, and the four role definitions in `.claude/agents/`.
- `claude plugin marketplace add clane-ai/baton --scope project` and `claude plugin install baton-core@clane-ai --scope project`. `baton doctor --role analyst` all green.
- Four agents on one machine, one per role, created with `baton agents add --name e2e-<role> --role <role> --store`.
- A webhook on the repo for `pull_request`, `check_suite` and `workflow_run`, signed with the secret in Vault.
- Four tasks:

| Key | Role | Consumes | Produces | Waits on |
|---|---|---|---|---|
| TSK-0721 | analyst | (user story in the spec) | task_spec | |
| TSK-0722 | frontend-dev | task_spec from 0721 | pr, build | 0721 |
| TSK-0723 | qa | build from 0722 | test_report | 0722 |
| TSK-0724 | reviewer | pr from 0722 | review | 0722 |

TSK-0722's spec told the developer to ask the analyst the open punctuation question with `task_ask` before writing code.

- `baton supervise --roles analyst,frontend-dev,qa,reviewer --interval 15 --agent --no-mcp-config`.

## What happened

| Time (UTC) | Event |
|---|---|
| 07:37:22 | analyst spawned; claims TSK-0721, reads the repo, registers a `task_spec`, creates a follow-up task with `task_create`, submits; gate passes, TSK-0722 becomes ready |
| 07:38:29 | frontend-dev spawned; claims TSK-0722, reads the task_spec with `artifact_get`, tries to stop; **the Stop gate blocks it** ("You have an open task"); it then asks the analyst with `task_ask` ("what is the exact trailing punctuation for the farewell sentence?") and exits; TSK-0722 is blocked |
| 07:39:05 | daemon spawns an analyst because an unanswered question addressed to the role is work; the question is injected into its context at session start; it answers with `answer` ("Goodbye, ${name.trim()}!, same style as greet()"); TSK-0722 is ready again |
| 07:39:39 | frontend-dev spawned; the answer is in its context; implements `farewell`, adds tests, `npm test`, commits on `baton/TSK-0722`, pushes, `gh pr create` opens PR #1, registers `pr` and `build` artefacts |
| 07:40:46 | webhook: check_suite requested, artefact `ci_status` pending |
| 07:40:51 | webhook: check_suite completed success (GitHub Actions run 35832964933), `ci_status` success |
| 07:40:52 | frontend-dev submits; gate passes (artefacts present, schemas valid, CI green); TSK-0722 done; TSK-0723 and TSK-0724 become ready |
| 07:41:1x | qa and reviewer spawned in parallel; qa checks out the branch, runs the suite (4 pass), registers a `test_report`; reviewer reads `gh pr diff 1`, checks it against the task_spec and scope, registers a `review` with verdict approve |
| 07:42:08 | both submit; gates pass; all four tasks done |

Costs from the daemon's final usage posts: analyst $0.19 across three sessions, frontend-dev $0.39, qa $0.16, reviewer $0.10. About $0.85 for the pipeline.

The conversation between the two sessions, as stored in `baton.messages`:

> **e2e-frontend-dev to role analyst, 07:38:52**: For TSK-0722 (farewell(name) in src/greeting.js): what is the exact trailing punctuation for the farewell sentence? greet(name) returns `Hello, ${name}!`. Should farewell(name) return `Goodbye, ${name}!`, `Goodbye, ${name}.`, `Goodbye, ${name}` or `Goodbye, ${name}...`?
>
> **e2e-analyst, 07:39:23**: Use an exclamation mark for consistency with greet(): farewell(name) must return exactly `Goodbye, ${name.trim()}!`. Trim the name the same way greet() does. Write exact-match tests against this string.

The PR is left open at https://github.com/clane-ai/baton-e2e/pull/1 for inspection.

## Defects found by the run and fixed

1. **Plugin MCP identity on a multi-role machine.** Claude Code runs a plugin's `headersHelper` from the plugin directory with `BATON_ROLE` in the environment but `BATON_TOKEN` stripped (secret-looking variables are dropped), and does not expand `${VAR}` in that field. The first run authenticated every session as the first agent in the config file. Fix: the helper resolves the token by `BATON_ROLE` from `~/.baton/config.json` (`baton-core` 0.1.3).
2. **Unanswered questions were not work.** The daemon only spawned for ready tasks, so nobody would ever answer a role-addressed question. Fix: `work_available` counts unanswered questions for the role (with a ten-minute retry window once delivered) and the run prompt tells an agent to answer its context's questions before `task_next`.
3. **CI verdicts matched only by commit sha.** Now also by pull request number from the check payload, and the sha is stored on the artefact.
4. Two things in the daemon's operation on Windows: stopping the shell that launched the daemon does not stop the node process (a second daemon ran alongside the first and spawned a duplicate agent), and `wmic` is gone on Windows Server 2025. Neither is a Baton defect, but `baton supervise --install` and the docs now assume Task Scheduler manages the process.

## What was not exercised

- Outbound GitHub calls (issue promotion, completion comment, closing issues): there is no GitHub token in Vault, so they were queued and marked skipped. Add one with `select vault.create_secret('<token>', 'baton_github_token')`.
- A failing CI run and the fix-task path: covered by the signed-webhook tests in `12_github_http.test.mjs`, not by this run.
- More than one machine: all four agents ran on this machine under one account. Nothing in the run depended on that except the shared checkout, and the agents' git work stayed on one branch.
