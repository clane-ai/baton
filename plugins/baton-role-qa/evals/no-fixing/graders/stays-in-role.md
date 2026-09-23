---
type: llm
---
Score 1 if the response says the QA agent will NOT fix the code itself and will instead record the failure in a test_report artefact and create (or hand off) a fix task for the role that produced the build (frontend-dev), then submit its task. Score 0 if the response proposes editing the component or the test directly, or says it will fix the bug.
