# Baton and Clane: where each sits, and how they join

Design note for a decision. Written 23 September 2026 after two exchanges with the Clane architecture session (clane-ai-30), who answered from the Clane crates and manifests. Nothing here is built yet; the last section lists what needs a decision.

## 1. The boundary

Clane already coordinates agents inside one machine: `agent_dispatch` (conversational, one task to a role), Agent Teams (lead and members to a goal), and a mesh that speaks Claude Code's cross-session protocol. Baton coordinates across machines and accounts with a server that decides when work is done. These do not compete if the rule is:

- Requester and doer can share a process: Clane dispatch or Teams. Baton is never involved.
- They cannot (other machine, other account, unattended, or the work must outlive the requester's session): a Baton task. `task_delegate` and `task_ask` mean "cross the boundary and wait".

Integration seam: Baton is a Clane connector (MCP over streamable HTTP with a bearer token, which is the shape Clane connectors already use). A role makes one "delegate across the mesh" call; the engine picks dispatch or a Baton task.

## 2. Worker runtime: why Claude Code today, and what changes with Clane

Baton is worker-agnostic. The server sees an MCP client with a bearer token plus a few hook calls. Claude Code is the worker only because it was the runtime verified for all five needs when Baton was built.

| Baton needs | Claude Code (today) | Clane CLI (from the crates) | Status |
|---|---|---|---|
| Headless spawn with role prompt, task prompt, cwd, caps, machine-readable result | `claude -p … --append-system-prompt --max-turns --max-budget-usd --output-format stream-json` | `clane -p … --output-format json --allowed-tool --permission-mode` (cli/headless.rs), or `clane serve` JSON-RPC: create session, turn.submit with output_schema, event stream | Exists. Per-run turn and spend caps as flags: CLI owner to confirm |
| Per-run MCP connector with that agent's token, no interactive prompts | per-spawn mcp config or plugin headers helper | connectors with grants; trusted default mode (prompts only for delete, outside-folder, workspace switch) | Exists. Injection knob per run: CLI owner to confirm |
| Deny before file writes and shell commands (scope, lease) | PreToolUse command hook | PreToolUse/PostToolUse command hooks returning PermissionOverride (runtime/src/hooks.rs); path scope enforced natively (policy_engine, permission_enforcer, toolgate) | Exists |
| Deny run end while a task is open | Stop hook | none in HookEvent | Small feature on the Clane side |
| Session start context, session end reason | SessionStart, SessionEnd hooks | serve event stream; daemon controls the first turn | Exists |
| Cost per run | result total_cost_usd (self-reported) | LLM gateway per-ApiKey credit ledger | Better. Attribution to a Baton-minted key and read-back: gateway owner to confirm |

Proposed shape: `baton supervise --runtime clane|claude` per role. Clane primary (it is the product, covers non-coding roles, meters through the gateway); Claude Code kept for coding-heavy roles while it earns its place. Baton side: a runtime adapter in the daemon (drive `clane serve`, inject the connector, forward events, read cost) and a PreToolUse hook command that calls Baton's gate. Clane side: the run-end deny hook; confirmation of caps, injection and event names. Estimate for the Baton side: about one day once the Clane specifics are confirmed.

## 3. Under a workflow orchestrator

A Clane workflow is a versioned manifest (`workflow.json`, WorkflowManifest): name, version, host_role, inputs, outputs, and a definition of nodes and edges. Node types: `role` (bounded agent step with prompt, output_key, max_tool_rounds), `code`, `action` (call an installed connector), `control` (branch), `approval` (human), `output`, `trigger`, `note`. IO between steps is typed: each node writes a named channel with an output_schema; downstream nodes read channels through source refs. It runs in `clane serve` on one machine (local runner, streams step events) or in the platform backend (workflow rows with status, runs with a RunStatus lifecycle, rendered live in the desktop). Neither runs steps on more than one machine. The local runner keeps a per-run journal and meters step cost through the gateway, but those are single-machine.

Neither runner has leases, retries or a completion gate that survive a machine dying, nor a cross-machine audit log. Baton has all of those: it is the more capable engine, and what it lacks is only a definition format and a run object. So the honest placement is a split rather than "Baton under the orchestrator": Clane owns the definition (manifest, editor, UI) and the run status people look at; Baton is the engine that executes the graph whenever any step must run on another machine, under another account, or unattended. For a purely local, interactive workflow the Clane runner stays. The mapping is nearly one to one:

| Clane workflow | Baton |
|---|---|
| `role` node that must run elsewhere or unattended | a task: role from the node, spec from prompt and instructions, scope and budget from config |
| node output_key with output_schema | artefact kind with JSON Schema (`produces`); registered on `artifact_put`, validated by the server |
| edge into a node; source refs to prior channels | `depends_on`; `consumes` pinned to the producing task |
| `action` node whose connector is Baton | the step that creates the task, waits for done, reads the artefact. No new node type needed; a first-class `baton` node is optional |
| `approval` node | `needs_human`, or a task_ask to no role, answered by the operator |
| `control` node | stays in the orchestrator; it creates the next Baton task when its condition holds |
| `trigger`, inbound webhook | stays in the orchestrator, or Baton's `/gh` style webhook for CI-like verdicts |
| workflow run | a group of Baton tasks; needs a run key on tasks |
| run status | advanced by Baton events: task done, gate failed, delegation returned, needs_human |

What Baton adds to make this clean, both small: a `workflow_run` key on tasks (column, filter, Flow tab grouping) and an outbound event subscription (webhook or long-poll) so the orchestrator does not have to poll `/admin/events`. A compiler from WorkflowManifest to a Baton task graph is straightforward once the io-contract spec is read and the CLI owner confirms the manifest is the target; it lives on the Clane side by ownership, with Baton supplying the task-graph API it already has.

Baton should report into Clane's existing run and instance model rather than grow its own; the exact backend schema is the platform team's to confirm.

Decide early whether a workflow run is all-local, all-Baton, or genuinely mixed. A mixed run needs Clane's run object to merge status from both executors into one view; that is the harder case and cheaper to settle now than to retrofit.

## 4. Decisions

1. Make Clane CLI the primary Baton worker, Claude Code secondary, selected per role. (Recommended.)
2. Make Baton the execution engine behind Clane workflows for any step that must run on another machine, under another account, or unattended; Clane keeps the definition and the run status; Baton is exposed as a connector and tasks are compiled from the manifest. (Recommended.)
3. Identity: Clane login as Baton operator identity; agent tokens minted for a Clane user so revocation follows the account.
4. Distribution: Baton's binary on the clane.sh install channel; a Clane hostname for the gateway (api.clane.sh/baton). Independent of 1 and 2.

If 1 and 2 are approved: the Clane architect coordinates; the CLI owner (clane-ai-56) specifies the engine details, builds the run-end hook and owns the compiler seam; the gateway owner (clane-ai-f5) confirms cost attribution; the platform team owns instance reporting; Baton builds the runtime adapter, the hook command, the run key and the event subscription.

## 5. Built on the Baton side (23 September 2026, afternoon)

- **Clane CLI as worker**: `baton work|supervise --runtime clane`, see `docs/clane-runtime.md`. Proven live on TSK-0815.
- **Workflow run key**: `workflow_run` on tasks, set with `baton tasks create --run <key>` or the `workflow_run` field of the task API; children inherit it (split, delegate); `baton tasks ls --run`; the Flow tab filters by run.
- **Outbound webhooks**: `baton webhooks add --url … [--events task_state_changed,gate_*]` returns a secret once; every matching event is queued by a trigger and POSTed after state transitions (and on `baton webhooks flush`) with `X-Baton-Signature: sha256=<HMAC-SHA256 of the body>` and `X-Baton-Event`. Payload: `{id, webhook_id, event:{id, ts, type, payload, task_id, task_key, workflow_run, agent}, sent_at}`. Five attempts, then parked. Verified live with signed deliveries for `task_state_changed` and `task_reprioritised` on run `demo-run-1`.

An orchestrator therefore needs only: create tasks with a run key, subscribe to `task_state_changed`, `gate_*`, `delegation_*` and `needs_human`-related events for that run, and read artefacts by task when a step completes.

## 6. Proof: a Clane workflow manifest, compiled and executed by Clane workers (23 September 2026)

Manifest: `docs/examples/workflows/locale-greetings/workflow.json`, in Clane's node-graph format (WorkflowManifest: inputs, outputs, definition.nodes with `role` nodes carrying `role_ref`, `instructions`, `output_key`, plus trigger and output nodes, and edges). Compiled with:

```
baton workflow compile docs/examples/workflows/locale-greetings/workflow.json --run locale-greetings-1 --input "Add farewellFor(locale) …"
```

which created four tasks with the run key: analyst TSK-0817 (task_spec), backend-dev TSK-0818 (config, after spec), frontend-dev TSK-0819 (build, after spec and config, both pinned as inputs), qa TSK-0820 (test_report, after implement). Executed with `baton supervise --roles analyst,backend-dev,frontend-dev,qa --runtime clane`: every step ran on the Clane CLI.

| Time (UTC) | Step | What happened | Credits |
|---|---|---|---|
| 15:04:49 to 15:09:01 | analyst | read the repo, registered a task_spec naming `src/farewells.json` and its keys, gate passed, backend step promoted | 20 |
| 15:10:00 to 15:12:00 | backend-dev | created the file, committed and pushed on `baton/TSK-0818`; two config shapes rejected by the schema, third accepted; gate passed, implement step promoted | 28 |
| 15:15:17 to 15:21:01 | frontend-dev | read both inputs, implemented `farewellFor`, 8 tests, committed on `baton/TSK-0819` on top of the backend branch, registered a build; gate passed, verify step promoted | 46 |
| 15:22:35 to 15:23:46 | qa | checked out the branch, ran the suite (8 passed), registered a test_report; gate passed; run 4/4 done | see log |

The orchestrator side: a webhook subscribed to the run received 30 signed deliveries, all signatures valid, tracing the run from the first ready state to the last gate_passed, with the run key on every event. `baton workflow status --run locale-greetings-1` and the Flow tab filter show the same graph.

Two things to know. The queue is shared: between steps, the daemon here also picked up the pilot machine's frontend-dev task, which is correct behaviour (whichever machine holds the role does the work) but worth remembering when several machines share a role. And Clane could not list the manifest from `~/.clane/workflows/` (its local listing parses more than the manifest); the CLI owner can say which field it wants. The compiler does not depend on that.
