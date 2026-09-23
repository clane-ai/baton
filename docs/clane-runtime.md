# Running Baton agents on the Clane CLI

`baton work --role qa --runtime clane` and `baton supervise --roles … --runtime clane` spawn the Clane CLI instead of Claude Code (`defaults.runtime` in `~/.baton/config.json` sets the default; `BATON_RUNTIME` overrides). Everything the server sees is the same: an MCP client with the agent's bearer token, the hook calls, the gates.

How a run works today, against the Clane CLI as shipped (0.1.25):

1. The daemon writes `<repo>/.clane/settings.local.json` (gitignore it) with the Baton connector (`type: http`, `headers.Authorization: Bearer {{BATON_TOKEN}}`) and a PreToolUse hook (`baton gate pretool`) matched to Clane's write and shell tools. Clane resolves `{{BATON_TOKEN}}` from `~/.clane/.credentials.json` when it starts; the daemon sets that key to the run's agent token just before each spawn. Because that store is per machine, Clane runs are serialised per machine (a lock in `~/.baton/clane.lock`): one Clane worker at a time until Clane ships `connectors.inject`. Clane 0.1.25 parses `headersHelper` but never runs it, which is why the placeholder is used.
2. It posts session-start to Baton to get the task line and unread messages, then runs `clane --output-format json --permission-mode trusted -- <prompt>` with the role body, the protocol, that context and the run prompt. Clane's Baton tools are `mcp__baton__<tool>`.
3. Clane's PreToolUse hook calls Baton's gate before every write or command; Baton denies without a lease or outside scope, with the reason Clane shows the agent.
4. After the run the daemon asks Baton whether the agent still holds a lease. If it does, the run is continued with the block reason as the next prompt, at most three times. This stands in for a run-end hook until Clane ships its `Stop` hook event.
5. Cost comes from the run envelope's `gateway_usage` (credits and, when present, USD), posted to `/runs/usage`; session-end is posted with the exit reason.

What Clane will add (specified by the CLI owner, pending the user's go): `connectors.inject` (per-session connector, no file in the workspace), per-run turn and spend caps, and the `Stop` hook. When they land, the daemon switches to `clane serve` with `role.set` and `turn.submit` and drops the emulation.

Not yet: per-key cost attribution at the gateway (charges are per user today), and gateway keys per worker (needs the user's decision on issuing keys, mint-route hardening and expiry).

## First live run, 23 September 2026

TSK-0815 (qa, "run the test suite") on the demo repo with the Clane CLI 0.1.25 as the worker. The run: whoami, task_next, task_progress, two bash_exec calls (git rev-parse, npm test), artifact_put, task_submit; the test_report validated (2 passed, 0 failed, sha ac51682) and the gate passed. Seven tool calls, 14 gateway credits, 1 minute 20 seconds from claim to done. The first attempt, before the credential placeholder, showed the gate doing its job: with no lease every write and command was denied and the agent stopped and reported the blockage rather than working around it.

Known gap: the gateway reports credits, not dollars, so `cost_usd` is 0 for Clane runs and the credits ride in the run's exit reason until the gateway exposes per-key cost.
