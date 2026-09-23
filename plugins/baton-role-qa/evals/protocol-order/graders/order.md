---
type: llm
---
Score 1 if the answer calls whoami first, then task_next, and says that when task_next returns none it stops and exits without inventing work. Score 0.5 if whoami and task_next are both present but the "none means stop" behaviour is missing or wrong. Score 0 otherwise.
