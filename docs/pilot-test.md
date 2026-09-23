# Pilot test script

A hands-on test of Baton for one pilot user, on their own machine, with their own Claude Code. It takes about an hour. Every step says what to run and what you should see. Anything that does not match is a finding: note the step number, what you saw, and send the log file it names.

You need: Node 22, Claude Code (`claude --version`), git with SSH access to the `clane-ai` GitHub org, the `gh` CLI logged in, and two tokens from the operator (see part 0).

## 0. What the operator does first

The operator (whoever runs Baton for the pilot) does this from any machine that has the operator token:

```
baton agents add --name pilot-<yourname>-qa --role qa --machine <your-machine-name>
baton agents add --name pilot-<yourname>-frontend-dev --role frontend-dev --machine <your-machine-name>
baton agents add --name pilot-<yourname>-analyst --role analyst --machine <your-machine-name>
```

Each command prints a token once. The operator hands you the three tokens over a channel you both trust, and tells you the server URL (currently `https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton`). The operator also opens the dashboard so they can watch your run.

## 1. Install the CLI

The CLI is not on npm yet, so install it from the checkout:

```
git clone git@github.com:clane-ai/baton.git
cd baton
npm i -g ./packages/cli
baton --help
```

Expected: the help text lists supervise, work, status, tasks, answer, agents, inbox, logs, doctor, sync.

## 2. Store your identity

Create `~/.baton/config.json` (on Windows: `C:\Users\<you>\.baton\config.json`):

```json
{
  "serverUrl": "https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton",
  "machine": "<your-machine-name>",
  "agents": {
    "qa":           { "name": "pilot-<yourname>-qa",           "token": "btn_..." },
    "frontend-dev": { "name": "pilot-<yourname>-frontend-dev", "token": "btn_..." },
    "analyst":      { "name": "pilot-<yourname>-analyst",      "token": "btn_..." }
  }
}
```

This one file is read by the daemon, the plugin's hooks and the plugin's MCP server. Never commit it.

## 3. Prepare a product repo

Use a small repo of your own with a working test command, or fork `clane-ai/baton-e2e` (a two-function Node project with `npm test` and a CI workflow). In that repo:

```
claude plugin marketplace add clane-ai/baton --scope project
claude plugin install baton-core@clane-ai --scope project
```

Accept the trust prompt. Then copy `docs/templates/product-repo-settings.json` from the baton checkout to `.claude/settings.json` in the product repo (merge if you already have one). It pre-allows the Baton MCP server and denies the dangerous commands.

Check:

```
baton doctor --role qa
```

Expected: every line green: server reachable, token valid for `pilot-<yourname>-qa`, gates registered, MCP tools resolve. A red line here means stop and report it.

## 4. Interactive session: play a role by hand

Ask the operator to create one task for you, or create it yourself if you have the operator token:

```
baton tasks create --role qa --priority 300 --produces test_report \
  --title "Pilot: run the suite" \
  --spec "Check out the default branch, run the test command, and register a test_report artefact with the results." \
  --acceptance "A test_report artefact exists with passed and failed counts and the commit sha."
```

Now open Claude Code in the product repo as the qa agent:

```
BATON_ROLE=qa claude
```

(PowerShell: `$env:BATON_ROLE='qa'; claude`.) Then type `/baton-core:work`.

What to check, in order:

| Step | Do | Expected |
|---|---|---|
| 4a | Read the first line Claude prints | It names your agent (`pilot-<yourname>-qa`, role qa). If it names someone else, stop and report. |
| 4b | Let it call `task_next` | It shows the task key (TSK-nnnn), title, produces and scope. Run `baton status` in another terminal: the task is in_progress and leased to you. |
| 4c | Tell Claude: "before you continue, edit the README to add a line" | The edit is refused by the PreToolUse gate with a message saying the file is outside the task scope. |
| 4d | Tell Claude: "stop now, we are done" | The Stop gate blocks it: Claude reports it still has an open task and keeps going. |
| 4e | Tell Claude: "register a test_report artefact with just the text 'ok'" | The server answers INVALID_ARTIFACT with the schema errors; Claude corrects the shape. |
| 4f | Let it finish: run the tests, `artifact_put` a proper test_report, `task_submit` | It reports the gate passed and the task is done. `baton tasks ls` shows done with a cost. |
| 4g | `baton logs --task TSK-nnnn` | You see task_claimed, heartbeat, tool_rejected (from 4c), stop_blocked (from 4d), artifact_rejected (4e), artifact_registered, task_submitted, gate_passed and a task_state_changed to done, in that order. |

## 5. Unattended: the daemon does the work

Create a second qa task exactly as in step 4, then in the product repo run the daemon in the foreground:

```
baton supervise --roles qa --interval 15
```

Expected within about a minute: the daemon logs `qa: work available (1 ready), spawning agent`, streams the session, and the task goes ready, in_progress, review, done on the dashboard and in `baton tasks ls`. The session log lands in `~/.baton/logs/`. Costs appear per task.

Then test recovery: create a third qa task, wait for `spawning agent`, and kill the spawned `claude` process from Task Manager or `kill`. Expected: within about two minutes the task is back to ready with attempts 1 of 3, the daemon spawns again, and the task completes. Note the wall-clock time it took to recover.

Stop the daemon with Ctrl+C. On Windows, check with Task Manager that no `node` process from it is left behind; if one is, report that and end it.

## 6. Two Claude Code sessions talking to each other

This is the core capability. Create a frontend-dev task whose spec forces a question:

```
baton tasks create --role frontend-dev --priority 300 --produces pr,build \
  --title "Pilot: add farewell()" \
  --spec "Add farewell(name) next to greet(name). Before writing any code you must ask the analyst, with task_ask, which trailing punctuation the farewell sentence uses, and wait for the answer. Open a pull request on a branch named baton/<task key>." \
  --acceptance "A PR exists that adds farewell() with tests, and the punctuation matches the analyst's answer."
```

Run the daemon for both roles:

```
baton supervise --roles analyst,frontend-dev --interval 15
```

Expected sequence, visible in the daemon output and in `baton logs --follow` from another terminal:

1. A frontend-dev session claims the task, reads the repo, calls `task_ask` and exits. The task shows as blocked in `baton status`.
2. The daemon logs `analyst: work available (1 question)` and spawns an analyst session. That session's context contains the question; it answers with the `answer` tool.
3. The task returns to ready. The daemon spawns frontend-dev again; that session's context now contains the answer. It writes the code, pushes the branch, opens the PR, registers the `pr` and `build` artefacts.
4. If your repo has CI on pull requests and the operator has added your repo's webhook, the task stays in review until CI is green, then goes to done. Without CI the gate leaves it in review; that is expected, and the operator can see the pending status.

Check `baton logs --type task_asked` and `--type question_answered`: both messages are stored with the sending agent's name. Open the PR and confirm the code uses the punctuation the analyst gave.

Variant with a human on one side: run step 6 with only `--roles frontend-dev`. When the task blocks, run `baton inbox --role analyst` to see the question and answer it yourself:

```
baton answer <message-id> "Use an exclamation mark, same as greet()."
```

The daemon respawns frontend-dev with your answer in its context.

## 7. Multi-machine (if a second pilot is available)

Two people, each with their own tokens and their own daemon, on the same product repo: one runs `--roles analyst`, the other `--roles frontend-dev`. Repeat step 6. Expected: identical behaviour, with `baton agents list` showing both machines and the messages travelling between them. This is the case the product exists for and the one we have not yet run with two separate accounts.

## 8. What to send back

- For every step whose result did not match: step number, what you saw, the task key, and the file from `~/.baton/logs/` for that session.
- The output of `baton doctor --role qa` and `claude --version`.
- Recovery time from step 5.
- Anything the agent did that you would not have wanted it to do (files touched outside scope, commands you would not have allowed, a submit before the work was really finished).
- Anything that was confusing in the tool descriptions, the skill, or the daemon's output.

The operator can revoke your agents afterwards with `baton agents revoke <name>`.
