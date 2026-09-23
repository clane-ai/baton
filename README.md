# Baton

Coordination layer for teams of Claude Code agents that run on different machines under different accounts. One authoritative task queue with leases, typed artefact handoff, asynchronous messages, a complete event log with cost, a dashboard with four supervisor actions, and enforcement that holds even when an agent ignores every instruction.

The specification is `prd.md`. The acceptance log is `docs/acceptance.md`. A recorded end-to-end run with live Claude Code agents, including two sessions talking to each other through Baton, is in `docs/e2e-run.md`. The manual test script for pilot users is `docs/pilot-test.md`. How an agent hands part of its task to another role and gets the result back is `docs/delegation.md`.

## Layout

| Path | What |
|---|---|
| `packages/server` | Supabase side: migrations for schema `baton`, the `baton` edge function (MCP face, hook face, gates, GitHub face, operator API), tests |
| `packages/schemas` | JSON Schemas for every artefact kind; generator for the seed migration |
| `packages/cli` | `@clane-ai/baton-cli`: supervisor daemon, operator commands, command hooks, `baton sync`, role definitions |
| `packages/dash` | Next.js dashboard: Now, Board, Stream, Attention, Spend |
| `plugins/baton-core` | Claude Code plugin: MCP server, gates, protocol skill, `/baton-core:work`, `take`, `status`, inbox monitor, bundled CLI |
| `plugins/baton-role-*` | One plugin per role; enabling it runs the session as that agent |
| `.claude-plugin/marketplace.json` | The private marketplace `clane-ai` |
| `docs/` | Plans, acceptance log, onboarding runbook, settings templates |

## Where things run

- Database and edge function: Supabase project `yemmiowsudakdviqqlnt` (eu-west-1), schema `baton`, function `https://yemmiowsudakdviqqlnt.supabase.co/functions/v1/baton`.
- Agents: any machine with Node 22 and Claude Code, driven by `baton supervise`.
- Dashboard: run locally with `pnpm --filter @clane-ai/baton-dash dev` (port 3210); it needs `BATON_URL` and `BATON_OPERATOR_TOKEN`.

## Developing

```
pnpm install
cd packages/server && pnpm test        # needs the repo-root .env (BATON_DB_URL, BATON_URL, tokens)
node plugins/gen-role-plugins.mjs      # role plugins are generated from packages/cli/roles
node plugins/sync-cli-into-core.mjs    # the plugin carries a copy of the CLI
claude plugin validate ./plugins/baton-core --strict
```

Migrations are applied through the Supabase MCP `apply_migration` tool in order; see `packages/server/README.md`.

## Release train

1. Change a role or a gate. 2. `claude plugin validate` and `claude plugin eval` (CI). 3. Bump `version` in the plugin's `plugin.json`. 4. `claude plugin tag ./plugins/<name> --push` writes `<name>--v<version>`; tag the marketplace `vX.Y.Z` for projects that pin by ref. 5. Move a project's `marketplace_ref` on the server; `baton sync` on each machine (the daemon runs it before the first spawn) reinstalls at that ref.

## Installing on a developer machine

`baton invite --roles qa --name-prefix alice --machine alice-laptop` (operator) produces a single-use code. On the developer machine: the install one-liner from `packages/cli/install/` (served at clane.sh/baton once published), then `baton join <code>` inside the product repo. Standalone executables are built by `.github/workflows/release.yml` on a `cli-vX.Y.Z` tag with `node packages/cli/scripts/build-binaries.mjs` (bun, one binary per platform, assets embedded).
