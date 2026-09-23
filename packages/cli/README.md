# @clane-ai/baton-cli

Supervisor daemon and operator CLI for Baton. Node 22, no runtime dependencies.

```
npm i -g @clane-ai/baton-cli
baton help
```

## Configuration

Environment first, then `~/.baton/config.json`:

| Variable | Purpose |
|---|---|
| `BATON_URL` | Server base URL. Defaults to the Clane AI project's edge function. |
| `BATON_OPERATOR_TOKEN` | Operator token for `status`, `tasks`, `answer`, `agents`, `seed`, `sync`, `logs`. |
| `BATON_TOKEN` / `BATON_ROLE` | Agent token for one role. The daemon sets these per spawn. |

`baton agents add --name qa-01 --role qa --store` creates an agent and stores its token under `agents.qa` in the config file.

## The daemon

`baton supervise --roles qa,frontend-dev` polls `/work-available` every 60 seconds and, when a role has ready work and fewer running agents than its `max_concurrent`, spawns

```
claude -p "<run prompt>" --permission-mode dontAsk --max-turns 60 --max-budget-usd 2 \
  --output-format stream-json --verbose --model sonnet \
  --append-system-prompt "<role body + protocol>" --allowedTools "<role tools>,mcp__baton" \
  --mcp-config ~/.baton/tmp/mcp-<role>.json --strict-mcp-config
```

with `BATON_URL`, `BATON_TOKEN` and `BATON_ROLE` in the child's environment. It streams the session to `~/.baton/logs/`, posts token usage to `/runs/usage` every 30 seconds and at exit, and always posts `/hooks/session-end` on exit so a held lease is released even when hooks did not run (a killed process).

`--install` registers the daemon with Task Scheduler (Windows), launchd (macOS) or a systemd user unit (Linux). `--once` runs a single poll, useful in tests. `--agent` passes `--agent <role>` so Claude Code runs the role's agent definition as the main thread (needs the role plugin or `.claude/agents/<role>.md`).

## Command hooks

`baton gate pretool` and `baton hook <event>` read the hook JSON on stdin and forward it. The gate **fails closed**: if the server cannot be reached, the write is denied. That is the behaviour prd.md decision 10 asks for and something a plain HTTP hook cannot promise.
