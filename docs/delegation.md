# Delegation: hand part of a task to another role and get the result back

Added 23 September 2026. Prompt-driven workflows need one move that the queue did not have: an agent in the middle of a task discovers that a piece of the work belongs to another role (a table, an API, a config file, a decision with evidence), hands exactly that piece over, sleeps, and is resumed with the result in hand. Questions (`task_ask`) carry text; delegation carries tracked work with an artefact, a gate and a cost line of its own.

## The move

`task_delegate {task_id, role, title, spec, acceptance, produces: [kind…], priority?, scope?}`

1. The server checks the caller's lease, then creates a child task for `role` with `parent_task` = the caller's task, `produces` = the kinds named, and priority just above the parent's so it is picked first.
2. The caller's task gets one new `consumes` entry per kind, pinned to the child (`from_task`), moves to `blocked` with `waiting_on` = child, and its lease is released. The tool answer tells the agent to exit.
3. The child flows through the normal lifecycle: claimed by an agent of that role, artefacts registered and schema-checked, `task_submit`, gate.
4. When the child reaches `done`, a trigger clears `waiting_on`, writes a `notice` message to the parent's role ("Delegated task TSK-x is done; its artefacts are in your consumes; read them with `artifact_get task_id=…`"), records `delegation_returned`, and promotes the parent to `ready`.
5. The daemon sees ready work for the parent's role and spawns an agent. Its session-start context carries the notice; `task_next` returns the parent with `delegations: [{key, title, produces}]` so it knows what came back; `artifact_get` reads the result.
6. If the child is cancelled or fails, the parent goes to `needs_human` with `delegation_failed`, so nothing waits forever on work that will not arrive.

The promoter never promotes a task whose `waiting_on` is set, so a parent cannot wake before the child's gate has passed, even though the child's artefacts exist earlier.

## Artefact kinds for non-code handoffs

| Kind | Meaning | Required fields |
|---|---|---|
| `db_schema` | tables the other role created or changed | `tables[]` with `name`, `columns[]` |
| `config` | a configuration file or set of keys | `path`, `keys[]` with `name` |
| `handoff` | any other result: what was done, where, what to know | `summary` |

`api_contract` and `migration` already exist. All schemas are in `packages/schemas/` and enforced on `artifact_put`.

## Role guidance

The protocol's step 5 now reads: missing information, `task_ask`; missing work that belongs to another role, `task_delegate`; in both cases exit. Roles must not do another role's work to unblock themselves. Prompts for frontend-dev and backend-dev say which kinds to ask for and which to deliver.

## What is not in this change

- A parent cannot delegate twice at once; delegate, sleep, resume, delegate again. `task_split` remains for fan-out where the parent keeps working.
- No timeout on a delegation. The child has its own max attempts and budget, and lands in `needs_human` like any task, which then fails the parent over as above.

## Live run, 23 September 2026

Repo `clane-ai/baton-e2e`, agents `e2e-frontend-dev` and `e2e-backend-dev` on one machine, real Claude Code sessions.

| Time (UTC) | Event |
|---|---|
| 12:05:03 | frontend-dev claims TSK-0811 ("Locale greetings from a config file"; the config file is owned by backend-dev) |
| 12:05:20 | it calls `task_delegate` to backend-dev with `produces: [config]`, scope `src/greetings.json`, and a spec it wrote itself naming the path and the three keys; TSK-0812 is created ready; TSK-0811 goes to blocked; the session exits ($0.12) |
| 12:06:25 | the backend-dev daemon spawns an agent, which claims TSK-0812 |
| 12:06:46 to 12:06:55 | three `config` artefacts are rejected by the schema with precise errors (a flat map, then keys as objects without `name`); the agent corrects each time |
| 12:06:59 | a valid `config` artefact is registered: path, keys en/fr/de with values, a summary |
| 12:07:02 | backend-dev submits; gate passes; TSK-0812 done ($0.19). The trigger writes the notice, records `delegation_returned`, and TSK-0811 returns to ready |
| 12:07:34 | frontend-dev is spawned again, attempt 2; `task_next` returns the parent with `delegations: [TSK-0812 → config]` |
| 12:07:40 | `artifact_get` reads the config; the agent implements `greetingsFor`, adds tests, runs them, commits on `baton/TSK-0811`, pushes |
| 12:08:31 | registers a `build` artefact; submits; gate passes; TSK-0811 done ($0.32 across both attempts) |

Seven tests pass on the branch. No pull request was opened, as the task said. Total cost of the pair: about $0.51.

What the run exposed:

- A repo run with `--agent <role>` needs a `.claude/agents/<role>.md` for every role a daemon may spawn; the first backend-dev spawns failed with "agent not found" until the role file was added.
- The backend agent wrote the file in the working tree but did not commit it. On one machine that is enough; across machines it is not. The backend-dev prompt now says to commit delegated files on `baton/<parent key>` and push, and the frontend-dev prompt says to pull that branch when the artefact names one.
