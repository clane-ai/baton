# @clane-ai/baton-server

Supabase side of Baton: migrations, functions, cron, and later the edge functions.

## Target
Shared Supabase project `yemmiowsudakdviqqlnt` (eu-west-1). All objects live in schema `baton`.

## Applying migrations
Migrations are `supabase/migrations/<timestamp>_<name>.sql`, applied in order with the
Supabase MCP `apply_migration` tool (`name` = part after the timestamp, `query` = file contents).
After each migration in a development environment, re-run `supabase/dev/test_role_grants.sql`
with `execute_sql` so the `baton_test` role can see new objects.

## Tests
`pnpm test` runs `tests/*.test.mjs` serially with Node's test runner, reading `BATON_DB_URL`
from the repo-root `.env`. Tests truncate every table in schema `baton`. Never point them at
a database holding real task data.

## Seed
`supabase/seed/seed.sql` is idempotent. Run it with `execute_sql`. It creates roles `analyst` and
`frontend-dev`, agent `analyst-01` (dev token `baton_dev_analyst_01`), and three tasks: one ready
for the analyst and two frontend tasks waiting on its output.
