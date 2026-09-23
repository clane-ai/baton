# Onboarding a new agent machine

Start to first claimed task, following prd.md section 23. Everything below was exercised on 23 September 2026 on a Windows machine; the commands are the same on macOS and Linux.

## Operator, from anywhere

```
irm https://clane.sh/baton/install.ps1 | iex     # or: curl -fsSL https://clane.sh/baton/install.sh | sh
baton config set operatorToken <token>          # or export BATON_OPERATOR_TOKEN
baton invite --roles qa --name-prefix sabita --machine sabita-laptop
```

The invite code is printed once, is single use, and expires after 24 hours. Give it to the person who owns the machine over a channel you trust. The agent tokens are created when they redeem it, so no token ever passes through you. `baton invite list` shows what is outstanding and what was redeemed from where.

## On the agent machine

1. Install the standalone CLI with the one-liner above. Node 22 is still needed because the plugin's hooks run through it.

2. In the product repo:

   ```
   baton join <invite-code>
   ```

   This writes `~/.baton/config.json` with one agent per role on the invite, registers the `clane-ai` marketplace and installs `baton-core` at project scope, writes `.claude/settings.json` from the template when the repo has none, and runs `baton doctor`. Commit the settings file. The repository is public. Accept the trust prompt; it covers the plugin's whole codebase, so review it once as you would any dependency. `baton setup` repeats the repo part in another checkout; `baton sync` does the same from the project's profile on the server when one exists.

   The supervisor daemon and the plugin's hooks and MCP server all read that one config file (or `BATON_TOKEN` in the environment). Nothing is ever committed. Handed a raw token instead of an invite? Put it in the file by hand:

   ```json
   { "serverUrl": "https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton",
     "agents": { "qa": { "name": "qa-01", "token": "btn_..." } } }
   ```

3. `baton doctor --role qa` checks the server is reachable, the token is valid, the role matches the plugin, the gates are registered and the MCP tools resolve.

4. `baton supervise --roles qa --install` writes a scheduled task (Windows), a launchd agent (macOS) or a systemd user unit (Linux) that runs the installed executable, and starts it. Without `--install` it runs in the foreground.

5. `baton seed --demo` from the operator side, then watch the dashboard (`packages/dash`, `pnpm --filter @clane-ai/baton-dash dev`).

## What you should see

- `baton status` lists the agent as idle with a recent `seen` time once the daemon has polled.
- When a task is ready for the role, the daemon logs `qa: work available (1 ready, 0 questions), spawning agent`, streams the session to `~/.baton/logs/`, and the task moves ready, in_progress, review, done on the dashboard.
- A killed agent process shows as idle within seconds and its task returns to ready.

## Things that bit us

- Claude Code does not support HTTP hooks for SessionStart and does not substitute plugin user config into HTTP hook headers. The plugin therefore ships the CLI inside itself and uses command hooks for everything; the MCP server gets its header from `headersHelper`.
- `claude plugin install --scope project` writes `enabledPlugins` into the repo's `.claude/settings.json`; commit that file so collaborators get the same set.
- Plugin MCP tools are named `mcp__plugin_baton-core_baton__<tool>`. Interactive sessions are asked for permission the first time; the product settings template allows the server up front.
