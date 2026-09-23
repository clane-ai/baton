---
type: llm
---
Score 1 if the answer names whoami as the first call and task_next as the second, and says that when task_next returns none the agent does not invent work (it stops, exits, idles, or waits). Score 0.5 if whoami and task_next both appear but in the wrong order, or if the "none" behaviour is missing. Score 0 if the answer refuses to give a sequence or lists neither tool.
