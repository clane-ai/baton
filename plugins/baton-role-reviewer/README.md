# baton-role-reviewer

Enabling this plugin makes this machine's Claude Code the Baton **reviewer** agent: its `settings.json` activates the `reviewer` agent as the main thread, with that agent's tools, model and instructions. It depends on `baton-core` for the MCP server, the gates and the protocol skill.

Install: `/plugin install baton-role-reviewer@clane-ai`. Regenerated from `packages/cli/roles/reviewer.md` by `node plugins/gen-role-plugins.mjs`; edit the role there.
