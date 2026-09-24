# Retiring the separate service: the engine moves into Clane

**Decision, 24 September 2026 (the user):** Baton stops being a separate service. Everything that can run
inside Clane runs inside Clane. The schema and its tables move into the database Clane already uses, and
the functions Supabase serves today become Clane's own interface.

**One refinement, agreed the same day:** *one database, two processes.* The data moves into Clane's
Postgres, because tenancy, identity and licensing live there and a second store would duplicate all
three. The engine keeps a process of its own rather than being folded into the application server,
because it has a different shape: long-lived work, leases, background reconciliation, and direct
connections from agents on other machines that authenticate with their own tokens rather than a browser
session. That process ships from the same repository and shares the same database and libraries.

Implementation owner: `clane-ai-f5`. Architecture: `clane-baton-ba`. This spec is the hand-over.

## What actually has to move

The engine is not only a database. It uses four things its current host provides, and each needs a Clane
equivalent before the service can be retired.

| Dependency today | What it holds | Clane equivalent needed |
|---|---|---|
| Supabase Postgres | the `baton` schema: enums, tables, row-level security, and most of the logic as database functions | Clane's Postgres, same schema name |
| Supabase Storage | artefact blobs, and workspace documents under `docs/<workspace>/<path>` | Clane's file storage |
| Supabase Vault | two secrets: a GitHub token and a webhook signing secret | Clane's secret storage |
| Supabase Edge runtime | serves every face: agent protocol, hooks, gates, GitHub webhooks, invite redemption, operator API | the engine's own Node process |

The good news is where the logic lives. Most of the engine is PL/pgSQL inside the schema, so it ports as
data-definition rather than being rewritten. The TypeScript layer is a thin, framework-free wrapper that
calls those functions; its faces become routes.

## The faces, and which way they point

Two different audiences, and the boundary between them is the part to get right.

**Inward, to people.** The operator API, consumed by Clane's server on behalf of a signed-in person. It
already runs behind a proxy that holds the operator credential and names the acting user in a header.
That arrangement does not change: the proxy keeps its platform paths so the client is untouched by the
move.

**Outward, to machines.** The agent protocol, the hook face, the enforcement gates, invite redemption
and GitHub webhooks. These are called by agent sessions on other machines and by GitHub, with the
engine's own bearer tokens, never a browser session. They must stay reachable and must keep
authenticating against the engine's token model.

Do not put the outward faces behind Clane's user-session middleware. A mis-mounted authentication layer
fails silently rather than loudly: the configuration route that blocked the whole Workflow section for a
day did exactly that, answering successfully while omitting the half that only exists for a signed-in
user.

## Where agents run (decided, 24 September 2026)

**Agents stay on machines for now**, until the system has been tested and the model is settled. Clane
hosts the engine; it does not host the sessions. The supervisor daemon keeps running where the work
belongs, next to the repository and the tools it needs.

For the migration that makes one requirement firm rather than optional: the agent-facing endpoints must
stay reachable from other machines, and must keep authenticating with the engine's own tokens. An agent
changes one value, the engine's address, or redeems a fresh invite. Nothing else about the agent model
moves.

Two things this defers rather than solves, and they should be reopened together, not separately:

- **Clane-hosted sessions.** Possible, and it needs model credentials on a worker host plus a workspace
  per task. It is not a configuration change: a session executing one customer's workflow on a shared
  host must not reach another customer's files, tokens or repositories, which is container-level
  isolation. Revisit once tenancy exists, never before.
- **The in-platform executor.** Most business-process steps are a model call, a connector call or a
  script, none of which needs a session on a machine at all. That is where hundreds of agents becomes
  affordable, and it is independent of this migration. Real sessions stay for work that needs a machine,
  a repository and tools.

## Order of work

Each step leaves the system serving. Nothing is switched over until the step before it is proven.

1. **Schema into Clane's database.** Create the `baton` schema there and run the migrations against it.
   They are raw SQL, so they sit alongside Clane's own migration tooling rather than inside it; decide
   explicitly which tool owns them and write that decision down. Nothing reads from the new schema yet.
2. **Storage and secrets.** Replace the two blob paths (artefacts, workspace documents) and the two
   secrets with Clane's equivalents, behind the same small interfaces the engine already uses. These are
   the only places the host leaks into the code.
3. **The engine process.** Stand up the engine as its own service in the repository, serving both faces
   against the new database. Run it alongside the existing one, reading the same data, before anything
   depends on it.
4. **Data migration.** Move the live procure-to-pay data, or reset it. That is the user's call and
   should be asked rather than assumed, because the runs are the only real test data that exists.
   **Do the artefact-kind change in this step, not separately.** The kind column is a Postgres enum,
   which cannot hold per-tenant values, so a kind registry forces it to become text with a reference and
   validation resolving by slug and version. Changing the shape of that column twice, once here and once
   for the registry, would be foolish; it is one migration.
5. **Cut the proxy over**, then the agents, then retire the Supabase deployment. The proxy first because
   it is reversible in one line; the agents second because they are distributed and slower to change.

## Where artefacts live once the engine is in Clane

Asked by the user, 24 September 2026. Five decisions, and two of them only became visible tonight.

**The rows.** Artefacts stay a table of their own beside the tasks that produced them: the task, the
kind, the content as JSON, a hash, a schema version, metadata, and a reference to a stored file when
there is one. Nothing about that shape needs to change; it moves.

**The schema, and this is the part that changed tonight.** Clane does not use one schema per database.
Its application data lives in `app_dev` and `app_prod` in the same database, with the same rows under the
same identifiers in both. So the engine does not add *a* schema, it adds one per environment, and every
rule below applies twice. Anything that assumes a single engine schema per database is wrong here.

**The kind column.** Today it is a Postgres enum, which cannot hold per-tenant values. It becomes text
with a reference into the kind registry, resolved by slug and version rather than by filename. That is
the largest single change and it belongs in the same migration as the move, not a later one.

**The files.** Artefact blobs and workspace documents are files, not rows, and they are addressed by
identifier everywhere a screen or an interface can see them. Paths stay internal. Clane's own file
storage replaces the bucket; what must not change is that a document is fetched by its id and streamed,
so nothing outside the engine ever learns where the bytes actually sit.

**The tenant.** Every row carries one and every stored file sits under a tenant prefix, with row-level
security. Ruled today, and cheapest while the data is being moved anyway.

**An artefact table is an append log, not a list.** Verified in the schema, not assumed: every write is
a plain insert, there is no unique constraint on task and kind and no upsert anywhere. So one task and
one kind does not mean one row. A retried step leaves both, and the newest wins. That is correct for a
retry — losing the earlier attempt would destroy the evidence of what went wrong — but it means any
screen, query or migration that treats a task's artefacts as a list rather than a history will be
wrong, and wrong in the way that reports success. Whatever moves this data into Clane keeps the
ordering, and whatever reads it selects the latest explicitly rather than assuming there is only one.

### The hazard the environment split creates

Clane's two environments hold **the same five workflows under the same identifiers**. If artefacts are
copied between environments the way those rows evidently were, then an approval decided in one appears
decided in the other, and an audit trail stops meaning anything. Artefacts and events are a record of
what happened, so they are per-environment and never copied. Say so where somebody refreshing a
development environment from production will read it, because that is exactly when it will happen.

## What must not regress

- **Tokens stay hashed.** Agent and operator tokens are stored only as hashes and shown once. No step of
  this migration is a reason to hold a plaintext token anywhere.
- **Row-level security survives.** Agents see their own work through a bound database role, not through
  application filtering. If the Clane database cannot express that, say so early rather than quietly
  dropping to application-level checks.
- **Documents keep their identifiers.** Screens address documents by id and stream them through the
  platform. Paths are an internal detail and must not resurface in any interface.
- **The audit trail stays continuous.** Events are the product, not debugging output. A migration that
  loses or renumbers them costs more than it saves.

## What this unblocks, and what it does not

It unblocks tenancy, because a tenant column and a storage prefix are far cheaper to add while the data
is being moved anyway, and tenancy is already ruled as landing in the converged schema.

It does not address approver authority, which remains the first commercial prerequisite: today the
engine trusts whoever holds the operator credential and takes the person's name from a header the
platform sets. That belongs with Clane identity once the engine lives beside it, and it should be the
first thing built after the move rather than the last.
