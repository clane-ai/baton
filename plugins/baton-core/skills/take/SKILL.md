---
name: take
description: Work one specific Baton task by key, for example /baton-core:take TSK-0042. Use when the user names a task key.
disable-model-invocation: true
---

The user wants you to work the Baton task `$ARGUMENTS`.

1. Call `whoami`. If you already hold a different task, tell the user and stop: one lease at a time.
2. Call `board` and find the task by key. If it is not `ready` for your role, explain its state (blocked, in progress with another agent, done, wrong role) and stop.
3. Baton claims by priority, so raise the odds of getting this task: call `task_next`. If the task you receive is not `$ARGUMENTS`, release it with `task_release` (reason: "wanted $ARGUMENTS") and ask the user to reprioritise `$ARGUMENTS` with `baton tasks prioritise $ARGUMENTS 1000` or the dashboard, then try again.
4. Once you hold `$ARGUMENTS`, follow the baton-protocol skill to submission.
