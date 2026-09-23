---
name: work
description: "Start the Baton loop interactively (whoami, task_next, then work the task to submission). Use when the user says /baton-core:work or asks you to pick up Baton work."
disable-model-invocation: true
---

Run the Baton coordination loop now, in this session, alongside the user.

1. Call `whoami`. Tell the user in one line who you are (agent name, role) and whether you already hold a task.
2. If you hold a task, resume it. Otherwise call `task_next`. If it returns `none`, say so and stop.
3. Show the user the task key, title, `consumes`, `produces` and `scope` in a short block.
4. Follow the baton-protocol skill to the end: read inputs with `artifact_get`, heartbeat every 10 minutes, one-line `task_progress` notes, `artifact_put` for each declared output, then `task_submit`.
5. Report the gate result. If it failed, show the missing kinds or validation problems and, if the task returned to ready, ask the user whether to claim it again.

Never mark a task done yourself. If you need a decision the user can give, ask the user; if the user is not present, use `task_ask`.
