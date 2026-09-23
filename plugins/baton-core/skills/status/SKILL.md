---
name: status
description: "Show this agent's Baton status (identity, current task and lease, queue counts for the role, undelivered messages). Use for /baton-core:status."
disable-model-invocation: true
---

Report the Baton state for this session, compactly:

1. Call `whoami` and `board`.
2. Print: agent name and role; the current task (key, title, lease expiry) or "no task"; the role's queue counts by state; the number of undelivered messages.
3. If there are undelivered messages, call `inbox` and list them one per line.

Do not claim work. This is read-only situational awareness.
