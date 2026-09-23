# Onboarding a new agent machine

Start to first claimed task, following prd.md section 23. Everything below was exercised on 23 September 2026 on a Windows machine; the commands are the same on macOS and Linux.

## Operator, from anywhere

```
npm i -g @clane-ai/baton-cli          # or run it from a checkout: node packages/cli/bin/baton.mjs
baton config set operatorToken <token>  # or export BATON_OPERATOR_TOKEN
baton agents add --name qa-01 --role qa --machine sabita-laptop
```

The token is printed once. Give it to the person who owns the machine over a channel you trust.

## On the agent machine

1. `npm i -g @clane-ai/baton-cli`, then store the token: `baton config set operatorToken ...` is not needed on an agent machine; instead write the agent token with

   ```
   baton agents add --name qa-01 --role qa --store     # if you are also an operator
   ```

   or, when you were handed a token, put it in `~/.baton/config.json`:

   ```json
   { "serverUrl": "https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton",
     "agents": { "qa": { "name": "qa-01", "token": "btn_..." } } }
   ```

   The supervisor daemon and the plugin's hooks and MCP server all read this one file (or `BATON_TOKEN` in the environment). Nothing is ever committed.

2. In the product repo:

   ```
   claude plugin marketplace add clane-ai/baton --scope project
   claude plugin install baton-core@clane-ai --scope project
   claude plugin install baton-role-qa@clane-ai --scope project
   ```

   The marketplace is private: access is through SSH keys, which is what the clone above used. Accept the trust prompt; it covers the plugin's whole codebase, so review it once as you would any dependency. Or skip the three commands and run `baton sync`, which does exactly this from the project's profile on the server.

3. `baton doctor --role qa` checks the server is reachable, the token is valid, the role matches the plugin, the gates are registered and the MCP tools resolve.

4. `baton supervise --roles qa --install` writes a scheduled task (Windows), a launchd agent (macOS) or a systemd user unit (Linux) and starts it. Without `--install` it runs in the foreground.

5. `baton seed --demo` from the operator side, then watch the dashboard (`packages/dash`, `pnpm --filter @clane-ai/baton-dash dev`).

## What you should see

- `baton status` lists the agent as idle with a recent `seen` time once the daemon has polled.
- When a task is ready for the role, the daemon logs `qa: work available (1 ready), spawning agent`, streams the session to `~/.baton/logs/`, and the task moves ready, in_progress, review, done on the dashboard.
- A killed agent process shows as idle within seconds and its task returns to ready.

## Things that bit us

- Claude Code does not support HTTP hooks for SessionStart and does not substitute plugin user config into HTTP hook headers. The plugin therefore ships the CLI inside itself and uses command hooks for everything; the MCP server gets its header from `headersHelper`.
- `claude plugin install --scope project` writes `enabledPlugins` into the repo's `.claude/settings.json`; commit that file so collaborators get the same set.
- Plugin MCP tools are named `mcp__plugin_baton-core_baton__<tool>`. Interactive sessions are asked for permission the first time; the product settings template allows the server up front.
