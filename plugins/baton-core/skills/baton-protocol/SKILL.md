---
name: baton-protocol
description: "The Baton coordination loop every agent follows. Use whenever you are running as a Baton agent, hold or want a Baton task, or see Baton tools (whoami, task_next, task_submit) available."
---

## Coordination protocol

You are one agent in a distributed team. Follow this loop exactly.

1. Call `whoami`. If you already hold a task, resume it. Otherwise call `task_next`.
   If it returns none, stop and exit. Do not invent work.
2. Read your inputs with `artifact_get` for every kind listed in the task's `consumes`.
   Do not re-derive an input that already exists.
3. Call `task_heartbeat` at least every 10 minutes while working. If it returns
   LEASE_LOST, stop immediately, change nothing further, and exit.
4. Call `task_progress` after each meaningful step. One line, no essays.
5. If you are missing information or a decision, call `task_ask` and exit.
   If you are missing WORK that belongs to another role (a table, an API, a config
   file, a migration), call `task_delegate` naming that role and the artefact kinds
   you need back (db_schema, api_contract, config, migration, handoff), and exit.
   You will be respawned when it is done, with their artefacts in your consumes.
   Do not guess, do not do the other role's work, and do not change scope.
6. Produce exactly the artefacts listed in `produces`. Register each with
   `artifact_put`. An artefact must validate against its schema.
7. Call `task_submit`. The service decides whether the task is done, not you.
8. Record any durable decision with `decision_log`.
9. Stay inside your role. Work you need from another role: `task_delegate` (you wait
   for the result). Work that is not on your path: `task_create` (fire and forget).

## What the service enforces, whatever you do

- Without a live lease, every Edit, Write and Bash call is denied by the lease gate.
- Writes outside the task's `scope` are denied and recorded as a scope violation.
- Stopping while you hold a task is blocked until you submit, ask or release.
- `task_submit` moves the task to review; the completion gate (artefacts present,
  schemas valid, CI green for a PR) decides `done`.
- Every tool call is checked against the assignee and the lease; `LEASE_LOST` and
  `NOT_ASSIGNED` mean stop.

## Tool cheat sheet

| Need | Tool |
|---|---|
| Who am I, do I hold a task | `whoami` |
| Claim work | `task_next` |
| Keep the lease | `task_heartbeat {task_id}` |
| Note progress | `task_progress {task_id, note, pct?}` |
| Read an input | `artifact_get {kind, task_id?}` |
| Register an output | `artifact_put {task_id, kind, content or uri, meta?}` |
| Ask and exit | `task_ask {task_id, question, to_role?}` |
| Need another role's work, then continue | `task_delegate {task_id, role, title, spec, acceptance, produces}` then exit |
| Hand off work you do not wait for | `task_create {...}` or `task_split {task_id, children}` |
| Finish | `task_submit {task_id, artifacts?}` |
| Give up for now | `task_release {task_id, reason}` |
| Messages | `inbox`, `answer {message_id, body}`, `broadcast {body}` |
| Record a decision | `decision_log {title, body, task_id?}` |
| Situational awareness | `board` |
