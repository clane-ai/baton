# Baton
## Product Requirements and Technical Design

| | |
|---|---|
| **Name** | Baton |
| **Owner** | Abhishek Jha, Clane AI |
| **Status** | Draft for implementation |
| **Date** | 22 September 2026 |
| **Audience** | Claude Code, building this from scratch |
| **First consumer** | The Packaging Portal (Brunton) build: Next.js app, Python AI service |

---

## 0. How to use this document

This is a build specification. Sections 1 to 5 are the requirements. Sections 6 to 17 are the design and are prescriptive: build what is written, and where a choice is left open it is flagged as an open decision in section 19.

Build in the phase order in section 18. Do not start a later phase before the acceptance tests of the earlier one pass.

Section 13 is the one to read twice. It is what makes the protocol binding rather than advisory, and it is the part most easily left until last and then never built.

Sections 20 to 25 are the product surface: repository layout, plugin packaging, distribution and enforcement, the onboarding runbook, the CLI, and how a person working on several projects gets the right agents and the right versions in each.

---

## 1. Problem statement

Multiple Claude Code agents, each with a specific role (UI designer, backend developer, QA, data engineer), need to work as one team on a single product. The agents run on **different machines**, under **different Claude accounts**, belonging to **different people**, in different places and at different times.

Claude Code has no first-party mechanism for this:

- **Agent teams** are scoped to a single session on a single machine. The team config lives at `~/.claude/teams/{team}/config.json`, the shared task list at `~/.claude/tasks/{team}/`, and task claiming uses **file locking**, which requires one filesystem. There is no remote teammate, and a team cannot be shared across sessions.
- **Cross-session messaging** does reach other machines, but only between sessions belonging to **the same account**, both connected to Remote Control, and it carries **plain text only**. Structured team protocol messages, including task claims, never leave a team.
- **Subagents** live inside one session and return a result to their caller. They have no persistent identity and no shared state.

So the coordination layer has to be built. This document specifies it.

---

## 2. Goals

1. A single authoritative place where work items live, with dependencies and typed deliverables.
2. Safe distribution of work: two agents can never do the same task, and a dead agent's task returns to the queue automatically.
3. Typed artefact handoff between roles, so the pipeline (design, then build, then test) flows without a human relaying files.
4. Asynchronous communication between agents: questions, answers, broadcasts, with no agent blocked on another being online.
5. A complete, queryable log of everything every agent did, with cost.
6. A human control plane: one web page showing live state, with the four actions a supervisor actually needs.
7. Machine-independent and account-independent. Adding an agent is adding a row and starting a process, nothing else.

## 3. Non-goals

- Not a replacement for git or CI. Code lives in GitHub, tests run in GitHub Actions.
- Not a replacement for a human-facing issue tracker. Durable, human-visible items are promoted to GitHub Issues under the rule in section 12.4.
- Not a chat product. Messages are machine-to-machine, task-scoped, and short.
- No real-time streaming of agent terminals. Observation is through the event log.
- No attempt to make Claude Code agent teams work across machines. That is not possible.

## 4. Personas

| Persona | Description | Interacts via |
|---|---|---|
| **Supervisor** (Abhishek) | Sets priorities, answers escalations, kills runaway work | Dashboard |
| **Collaborator** (Sabita) | Owns roles, reviews output, answers questions in her domain | Dashboard, GitHub |
| **Agent** | A Claude Code session running exactly one role | MCP tools |
| **Supervisor daemon** | A small process on each machine that starts agents when work exists | REST |
| **CI** | GitHub Actions, reports build and test outcomes | Webhook |

## 5. Roles (first set)

Each is a subagent definition in `.claude/agents/<role>.md` in the product repo, plus a row in `roles`.

| Role | Consumes | Produces |
|---|---|---|
| `analyst` | `user_story` | `task_spec` |
| `ui-designer` | `task_spec` | `design_spec` |
| `frontend-dev` | `design_spec`, `api_contract` | `pr`, `build` |
| `backend-dev` | `task_spec` | `api_contract`, `pr`, `migration` |
| `ai-dev` | `api_contract`, `task_spec` | `pr`, `service_contract` |
| `qa` | `build` | `test_report` |
| `reviewer` | `pr` | `review` |

Roles are data. Adding one is a row plus a markdown file, never a code change.

---

## 6. Architecture

```
  Machine A (Abhishek)          Machine B (Sabita)           GitHub Actions
  ┌───────────────────┐         ┌───────────────────┐        ┌──────────────┐
  │ supervisor daemon │         │ supervisor daemon │        │  CI runner   │
  │   ↓ spawns        │         │   ↓ spawns        │        └──────┬───────┘
  │ claude -p (role)  │         │ claude -p (role)  │               │
  │   • .mcp.json     │         │   • .mcp.json     │               │
  │   • hooks         │         │   • hooks         │               │
  └─────────┬─────────┘         └─────────┬─────────┘               │
            │  MCP over HTTPS + hook POSTs                          │ webhook
            └───────────────┬───────────────────────────────────────┘
                            ▼
                ┌─────────────────────────────┐
                │   Baton  (Supabase project) │
                │  • Postgres: queue, leases, │
                │    events, messages         │
                │  • Storage: artefacts       │
                │  • Edge Functions:          │
                │      /mcp  /hooks  /gh      │
                │  • pg_cron: reaper, digest  │
                └──────────────┬──────────────┘
                              ▼
                     ┌────────────────┐
                     │   Dashboard    │  Next.js, read-mostly
                     └────────────────┘
```

Three faces on one service:

1. **MCP face** (`/mcp`): the tools agents call. Streamable HTTP transport.
2. **Hook face** (`/hooks/:event`): the firehose from Claude Code hooks.
3. **Integration face** (`/gh`): GitHub webhooks in, GitHub API calls out.

---

## 7. Technology decision: Supabase, not Redis

**Decision: Supabase (Postgres) is the system of record. Redis is not used in v1.**

### Why

The workload is not queue-throughput bound. Two to six agents claiming a task every few minutes is a handful of writes per second at peak. It is **query and durability bound**: dependency graphs, artefact readiness predicates, an append-only audit log queried by time, role, task and cost, and state that must survive a restart with zero loss.

| Requirement | Postgres / Supabase | Redis |
|---|---|---|
| Atomic claim | `UPDATE ... WHERE state='ready' ... FOR UPDATE SKIP LOCKED` in one statement | `BRPOPLPUSH` or Streams consumer groups, both fine |
| Lease with expiry and reclaim | `lease_until` column plus a one-minute `pg_cron` job | `XAUTOCLAIM`, workable |
| Dependency graph readiness | A join and a `NOT EXISTS`, trivially expressible | Not expressible. Would need application-side graph walking on every poll |
| Typed artefact preconditions | `jsonb` predicate plus a join | Not expressible |
| Append-only event log, queried later | Ordinary table, indexed, cheap on disk, partitionable by day | Lives in RAM. Retention costs money, and analytical queries are not possible |
| Durability | Synchronous commit, point-in-time recovery | AOF `everysec` loses up to a second on crash. `always` is slow |
| Auth per agent over the internet | RLS plus a token, and PostgREST gives an HTTP API with no server to write | None. A server has to be built in front regardless |
| Artefact blobs | Supabase Storage, same auth | Not a blob store |
| Dashboard | SQL, plus Realtime subscriptions for push | Would need a separate store to query |
| Scheduled reaper and digest | `pg_cron` | External scheduler needed |

Redis would win on raw throughput at a scale this system will not reach, and would then require Postgres anyway for the graph, the log and the dashboard. Adding it in v1 means two stores, two consistency models and a class of bug where the queue and the record disagree.

**Where Redis may earn a place later:** a wake-up bus if polling latency becomes the bottleneck, and a rate limiter for GitHub API calls. Both are additive, neither is v1. Note that Supabase Realtime already covers the wake-up case.

### Supabase components used

- **Postgres** with `pgcrypto` and `pg_cron` enabled.
- **Storage**, one bucket `artifacts`, private.
- **Edge Functions** for the three faces.
- **Realtime** on `tasks` and `messages`, for the dashboard and optionally for supervisor wake-ups.
- **Row Level Security** on every table, no exceptions.

---

## 8. Data model

All DDL below is authoritative. Create it as ordered migrations under `supabase/migrations/`.

### 8.1 Types

```sql
create type agent_status  as enum ('idle','working','offline','error');
create type task_state    as enum ('draft','ready','blocked','in_progress','review','done','failed','needs_human','cancelled');
create type message_kind  as enum ('question','answer','broadcast','notice');
create type artifact_kind as enum ('user_story','task_spec','design_spec','api_contract','service_contract',
                                   'pr','build','test_report','review','migration','doc','other');
```

### 8.2 Tables

```sql
create table roles (
  name            text primary key,
  description     text not null,
  definition_path text not null,              -- .claude/agents/<role>.md
  default_model   text,
  max_concurrent  int  not null default 1,
  created_at      timestamptz not null default now()
);

create table agents (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,          -- e.g. 'qa-01'
  role          text not null references roles(name),
  machine       text not null,
  owner_email   text,
  token_hash    text not null,                 -- sha256 of the bearer token
  status        agent_status not null default 'offline',
  current_task  uuid,
  last_seen     timestamptz,
  created_at    timestamptz not null default now()
);

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,          -- TSK-0001, generated by trigger
  title         text not null,
  spec          text not null,                 -- what to do, in full
  acceptance    text not null,                 -- Given / When / Then
  role          text not null references roles(name),
  state         task_state not null default 'draft',
  priority      int not null default 100,      -- higher first
  depends_on    uuid[] not null default '{}',
  consumes      jsonb not null default '[]',   -- [{"kind":"design_spec","from_task":"<uuid|null>"}]
  produces      jsonb not null default '[]',   -- [{"kind":"pr"}]
  assignee      uuid references agents(id),
  lease_until   timestamptz,
  attempts      int  not null default 0,
  max_attempts  int  not null default 3,
  budget_usd    numeric(10,2),
  cost_usd      numeric(10,4) not null default 0,
  parent_task   uuid references tasks(id),
  github_issue  int,
  version       int  not null default 0,
  created_by    text not null default 'system',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on tasks (state, role, priority desc, created_at);
create index on tasks (assignee) where state = 'in_progress';
create index on tasks (lease_until) where state = 'in_progress';

create table claims (
  id          bigserial primary key,
  task_id     uuid not null references tasks(id),
  agent_id    uuid not null references agents(id),
  claimed_at  timestamptz not null default now(),
  released_at timestamptz,
  outcome     text,                            -- completed | released | expired | failed
  reason      text
);
create index on claims (task_id, claimed_at desc);

create table artifacts (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id),
  kind           artifact_kind not null,
  uri            text not null,                -- storage path, or a URL for a PR
  sha256         text,
  schema_version text not null default 'v1',
  meta           jsonb not null default '{}',
  created_by     uuid references agents(id),
  created_at     timestamptz not null default now()
);
create index on artifacts (kind, created_at desc);
create index on artifacts (task_id);

create table events (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  agent_id   uuid references agents(id),
  task_id    uuid references tasks(id),
  session_id text,
  type       text not null,                    -- session_start|prompt|tool|turn_end|session_end|progress|...
  payload    jsonb not null default '{}'
);
create index on events (ts desc);
create index on events (task_id, ts desc);
create index on events (agent_id, ts desc);
create index on events (type, ts desc);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references tasks(id),
  from_agent  uuid references agents(id),
  to_agent    uuid references agents(id),      -- null with to_role means role-addressed
  to_role     text references roles(name),
  kind        message_kind not null,
  body        text not null,
  in_reply_to uuid references messages(id),
  delivered_at timestamptz,
  answered_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on messages (to_agent, delivered_at) where delivered_at is null;
create index on messages (to_role,  delivered_at) where delivered_at is null;

create table runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id),
  session_id  text not null,
  task_id     uuid references tasks(id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  cost_usd    numeric(10,4) not null default 0,
  exit_reason text
);
create index on runs (session_id);

create table decisions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  task_id    uuid references tasks(id),
  made_by    text not null,
  created_at timestamptz not null default now()
);
```

### 8.3 State machine

```
draft ──(spec complete)──▶ ready ──(claim)──▶ in_progress ──(submit)──▶ review ──(gate pass)──▶ done
                             ▲                     │                        │
                             │                     ├──(ask)──▶ blocked ─────┘ (answer)
                             │                     ├──(release / lease expiry, attempts<max)
                             └─────────────────────┤
                                                   ├──(attempts>=max)──▶ needs_human
                                                   └──(gate fail)──────▶ ready (fix task created)
```

Rules:
- Only `ready` tasks can be claimed.
- A task is only `ready` when its spec and acceptance are non-empty, every entry in `depends_on` is `done`, and every entry in `consumes` is satisfied by an existing artefact.
- `done` is set by the service, never by an agent. See section 10.3.

---

## 9. Core algorithms

### 9.1 Readiness

```sql
create or replace function consumes_satisfied(p_task uuid) returns boolean
language sql stable as $$
  select not exists (
    select 1
      from tasks t, jsonb_array_elements(t.consumes) c
     where t.id = p_task
       and not exists (
         select 1 from artifacts a
          where a.kind = (c->>'kind')::artifact_kind
            and (c->>'from_task' is null or a.task_id = (c->>'from_task')::uuid)
       )
  );
$$;
```

A `pg_cron` job every minute promotes `draft` and `blocked` tasks to `ready` when their preconditions become true.

### 9.2 Atomic claim with lease

This is the heart of the system. One statement, no application-level locking.

```sql
create or replace function claim_next(
  p_agent uuid, p_lease_seconds int default 1800
) returns tasks
language plpgsql as $$
declare t tasks; r text;
begin
  select role into r from agents where id = p_agent;

  update tasks set
    state       = 'in_progress',
    assignee    = p_agent,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    attempts    = attempts + 1,
    version     = version + 1,
    updated_at  = now()
  where id = (
    select id from tasks
     where role = r
       and state = 'ready'
       and (assignee is null or lease_until < now())
       and not exists (
             select 1 from unnest(depends_on) d
               join tasks dt on dt.id = d
              where dt.state <> 'done')
       and consumes_satisfied(id)
     order by priority desc, created_at
     for update skip locked
     limit 1
  )
  returning * into t;

  if t.id is not null then
    insert into claims (task_id, agent_id) values (t.id, p_agent);
    update agents set current_task = t.id, status = 'working', last_seen = now() where id = p_agent;
    insert into events (agent_id, task_id, type, payload)
      values (p_agent, t.id, 'task_claimed', jsonb_build_object('lease_until', t.lease_until));
  end if;
  return t;
end $$;
```

Zero rows returned means no work for that role right now. The agent exits. It does not poll.

### 9.3 Reaper

```sql
select cron.schedule('baton-reap', '* * * * *', $$
  with expired as (
    update tasks set
      state = case when attempts >= max_attempts then 'needs_human' else 'ready' end,
      assignee = null, lease_until = null, updated_at = now(), version = version + 1
    where state = 'in_progress' and lease_until < now()
    returning id, assignee
  )
  update claims set released_at = now(), outcome = 'expired'
   where task_id in (select id from expired) and released_at is null;
$$);
```

This is what makes a laptop closing at 18:00 a non-event.

### 9.4 Budget stop

A trigger on `runs` accumulates `cost_usd` onto the task. When `cost_usd > budget_usd`, the task moves to `needs_human` and the lease is cleared, so the agent's next heartbeat fails and it exits.

---

## 10. MCP interface

Exposed at `POST /mcp` (streamable HTTP). Auth: `Authorization: Bearer <agent token>`. The server resolves the agent from the token hash. **The agent never declares its own identity.**

### 10.1 Tools

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `whoami` | `{}` | agent, role, current task | Called at session start |
| `task_next` | `{lease_seconds?}` | task or `{none:true}` | Calls `claim_next`. Atomic |
| `task_heartbeat` | `{task_id}` | `{lease_until}` | Extends lease. Fails if the lease was reaped |
| `task_progress` | `{task_id, note, pct?}` | `{ok}` | Writes an event |
| `task_ask` | `{task_id, question, to_role?, to_agent?}` | `{message_id}` | Moves the task to `blocked` |
| `task_submit` | `{task_id, artifacts:[{kind,uri,sha256,meta}]}` | `{state}` | Moves to `review`, runs the gate |
| `task_release` | `{task_id, reason}` | `{ok}` | Voluntary release, back to `ready` |
| `task_split` | `{task_id, children:[{title,spec,acceptance,role,consumes,produces}]}` | `[task]` | Creates child tasks |
| `task_create` | `{title,spec,acceptance,role,priority,depends_on,consumes,produces}` | `task` | Used by `analyst` and for fix tasks |
| `inbox` | `{}` | `[message]` | Undelivered messages for this agent or role; marks delivered |
| `answer` | `{message_id, body}` | `{ok}` | Unblocks the asking task |
| `broadcast` | `{body, task_id?}` | `{ok}` | Low volume, rate-limited |
| `artifact_put` | `{task_id, kind, content|uri, schema_version, meta}` | `{artifact_id, uri}` | Uploads to Storage when content is given |
| `artifact_get` | `{kind, task_id?, latest?}` | `[artifact]` | How a role reads its input |
| `decision_log` | `{title, body, task_id?}` | `{ok}` | So decisions are not re-litigated |
| `board` | `{role?}` | counts by state, own tasks | Cheap situational awareness |

### 10.2 Error contract

Every tool returns `{ok:false, error:{code, message, retryable}}` on failure. Codes: `LEASE_LOST`, `NOT_ASSIGNED`, `PRECONDITION_FAILED`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `INVALID_ARTIFACT`. `LEASE_LOST` means stop work immediately and exit.

### 10.3 The completion gate

`task_submit` does **not** mark a task done. The service runs the gate:

1. Every `kind` in `produces` has a matching artefact on this task.
2. Each artefact validates against its JSON Schema for its `schema_version`.
3. If `pr` is among the produced artefacts, the GitHub check status for that PR head must be `success`.

Pass, the task becomes `done` and dependent tasks are unblocked. Fail, the task returns to `ready` with an event explaining why, or to `needs_human` if attempts are exhausted. An agent asserting success is not evidence.

---

## 11. Hook interface

`POST /hooks/:event`, same bearer token. Configured in the product repo's `.claude/settings.json` so every agent on every machine reports identically:

```json
{
  "env": { "BATON_URL": "https://<project>.functions.supabase.co" },
  "hooks": {
    "SessionStart":   [{ "type": "http", "url": "${BATON_URL}/hooks/session-start",
                         "headers": { "Authorization": "Bearer $BATON_TOKEN" },
                         "allowedEnvVars": ["BATON_TOKEN"] }],
    "UserPromptSubmit":[{ "type": "http", "url": "${BATON_URL}/hooks/prompt" }],
    "PostToolUse":    [{ "matcher": "Edit|Write|Bash|MultiEdit",
                         "hooks": [{ "type": "http", "url": "${BATON_URL}/hooks/tool" }] }],
    "PostToolUseFailure":[{ "type": "http", "url": "${BATON_URL}/hooks/tool-failure" }],
    "Stop":           [{ "type": "http", "url": "${BATON_URL}/hooks/turn-end" }],
    "SessionEnd":     [{ "type": "http", "url": "${BATON_URL}/hooks/session-end" }]
  }
}
```

Every hook payload carries `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode` and `hook_event_name`; tool events add `tool_name` and `tool_input`. The service correlates by `session_id` to the run and the agent's current claim.

**Context injection.** `SessionStart` and `UserPromptSubmit` return `hookSpecificOutput.additionalContext` containing any undelivered messages and a one-line task-state reminder. This is the notification badge: the agent does not have to remember to check its inbox.

**Redaction.** The hook face runs every payload through a redaction pass before insert: anything matching key material, tokens, connection strings or `.env` content is replaced with `[redacted]`. Applied at ingest, not at read.

**Session end.** Releases any lease still held by that session and closes the run with token and cost totals.

---

## 12. Agent runtime

### 12.1 What each agent gets

1. `.mcp.json` committed at the repo root:

```json
{ "mcpServers": { "baton": { "type": "http", "url": "https://<project>.functions.supabase.co/mcp" } } }
```

2. A role file at `.claude/agents/<role>.md` with `tools`, `model` and the role's instructions in the body.
3. The shared protocol section in `CLAUDE.md` (section 12.3), identical for every role.
4. `BATON_TOKEN` in the environment, unique per agent.

### 12.2 Supervisor daemon

One per machine. Not a Claude process. Node or Python, run by systemd or Task Scheduler.

```
every 60s, for each role this machine owns:
  if running_agents[role] >= max_concurrent: continue
  GET /work-available?role=<role>   ->  {available: bool}
  if available:
    spawn: claude -p "$(cat .claude/prompts/<role>.md)" \
             --permission-mode acceptEdits \
             --output-format stream-json \
             --max-turns 60
    stream stdout to a local log file; the hooks report to Baton
```

Agents are summoned, work, and exit. Cost tracks work done, not wall clock. A machine being asleep is invisible to the system.

### 12.3 The protocol (goes in CLAUDE.md verbatim)

```markdown
## Coordination protocol

You are one agent in a distributed team. Follow this loop exactly.

1. Call `whoami`. If you already hold a task, resume it. Otherwise call `task_next`.
   If it returns none, stop and exit. Do not invent work.
2. Read your inputs with `artifact_get` for every kind listed in the task's `consumes`.
   Do not re-derive an input that already exists.
3. Call `task_heartbeat` at least every 10 minutes while working. If it returns
   LEASE_LOST, stop immediately, change nothing further, and exit.
4. Call `task_progress` after each meaningful step. One line, no essays.
5. If you are missing information or a decision, call `task_ask` and exit.
   Do not guess, and do not work around a blocker by changing scope.
6. Produce exactly the artefacts listed in `produces`. Register each with
   `artifact_put`. An artefact must validate against its schema.
7. Call `task_submit`. The service decides whether the task is done, not you.
8. Record any durable decision with `decision_log`.
9. Stay inside your role. If work belongs to another role, create a task for that
   role with `task_create` rather than doing it yourself.
```

### 12.4 GitHub integration

The service, not the agents, talks to GitHub. Four calls per task at most: promote a durable item to an issue, open the PR, post one completion summary, close the issue on merge. Inbound webhooks update `artifacts` and drive the completion gate.

**Promotion rule.** A bug found and fixed inside a task never becomes an issue. It becomes an event and a line in the PR body. Something becomes a GitHub Issue only when it **outlives the task**: deferred, needs a decision, changes scope, or someone outside the agent team must see it.

**Rate limits.** GitHub allows 5,000 requests an hour for a token, but the binding constraint is the secondary limit of **80 content-creating requests per minute and 500 per hour**. Never call GitHub from the hook face. State transitions only.

---

## 13. Enforcement: how agents are made to follow the protocol

### 13.1 The principle

A protocol written in prose is a request. An agent under pressure will skip the heartbeat, decide its own work is done, edit a file outside its scope, or wander off mid-task. Assume drift, and design so that a violation is either **impossible** or **has no effect**.

Five layers, weakest to strongest. The system does not rely on any layer above 4.

### 13.2 Layer 1: instruction (weak, but necessary)

- The protocol block in `CLAUDE.md`, loaded automatically in every session in the repo.
- The role's own instructions in the body of `.claude/agents/<role>.md`.
- The supervisor passes the protocol with `--append-system-prompt`, so for an unattended run it sits in the system prompt rather than in a file the model may skim.

Nothing here is binding. It exists so a compliant agent knows what to do, not to stop a non-compliant one.

### 13.3 Layer 2: capability restriction

Take away the ability to do the wrong thing.

- **Role `tools` list**: the `qa` role gets `Read`, `Bash(npm test *)`, `Bash(npx playwright *)` and the Baton tools. No `Write` outside the test directories. `ui-designer` gets no `Bash` at all.
- **Committed deny rules** in `.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Bash(git push origin main)",
      "Bash(git push --force*)",
      "Bash(rm -rf *)",
      "SendMessage",
      "ListAgents"
    ]
  },
  "enabledMcpjsonServers": ["baton"]
}
```

Denying `SendMessage` and `ListAgents` is deliberate: every inter-agent message must go through Baton where it is logged and task-scoped, not through an unlogged side channel. Both rules take the bare tool name.

- **Managed settings** (`/etc/claude-code/managed-settings.json`, or the Windows and macOS equivalents) for anything the repo must not be able to loosen. Managed settings apply after every other source, so a project file cannot override them.

### 13.4 Layer 3: hook gates (enforcement at the agent)

Hooks are code, they run on every tool call, and exit code 2 blocks the action. Four gates ship with the plugin:

**a. No lease, no write.** `PreToolUse` matching `Edit|Write|MultiEdit|Bash`. Calls `GET /gate/lease?session_id=`. If the session holds no active lease, it returns:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "No active Baton lease. Call task_next before editing anything." } }
```

An agent cannot touch a file without a claimed task.

**b. Scope gate.** `PreToolUse`. Every task carries a `scope` glob list. A write outside it is denied and recorded as a `scope_violation` event. This is what stops the frontend agent editing the Python service.

**c. Stop gate.** `Stop` hook. If the session holds an active lease and has not called `task_submit`, `task_ask` or `task_release`, exit 2 with feedback: *"You have an open task. Submit, ask, or release it before stopping."* Exit code 2 keeps the agent working. This is the single most valuable gate, because the commonest failure is an agent declaring itself finished halfway.

**d. Exit gate.** `SessionEnd`, unconditional. Releases the lease, closes the run, writes final cost.

Honest limitation: hooks live in the repo or in user settings, so a person with access to that machine can remove them. That is precisely why layer 4 exists and why nothing important is enforced here alone.

### 13.5 Layer 4: server-side invariants (the real enforcement)

Everything that matters is checked where the agent has no reach.

- **Identity comes from the token.** No tool accepts an agent id as input. An agent cannot act as another.
- **No lease, no effect.** Every mutating tool rejects a caller that is not the task's assignee, or whose `lease_until` has passed. The response is `LEASE_LOST`, and the protocol requires the agent to stop.
- **An agent cannot mark its own work done.** `task_submit` moves a task to `review`. The gate decides: declared artefacts present, each valid against its schema, CI green where a `pr` artefact exists.
- **Caps are database triggers**, not agent discipline: `max_attempts` and `budget_usd` move a task to `needs_human` without asking anyone.
- **Every state change writes an event with its actor.** There is no silent path.
- **Idempotency key on every mutating tool**, so a retried call cannot double-apply.

The net effect: an agent that ignores the entire protocol accomplishes nothing. It holds no lease, so the hook denies its edits. If the hook is gone, its submissions are rejected, its artefacts are never registered, and its work never reaches `done` or main.

### 13.6 Layer 5: outside the agent entirely

- **GitHub branch protection**: no direct push to `main`, PR required, required status checks, CODEOWNERS on migrations, auth and anything touching contact or consent data.
- **The supervisor owns the invocation.** The agent does not choose its own prompt, model, permission mode or turn limit. Those are arguments, not preferences.
- **Conformance report**, a daily `pg_cron` job into the dashboard's Attention view:
  - file-edit events with no active claim (shadow work, someone running plain `claude` in the repo),
  - tasks completed with no registered artefact,
  - heartbeat gaps longer than the lease,
  - any `scope_violation`,
  - sessions whose `session_start` never matched a claim.

That report is how you find out the process is being bypassed, rather than assuming it is not.

### 13.7 How a human starts a compliant agent

Three entry points, all landing in the same loop:

| Situation | Command |
|---|---|
| Unattended, the normal path | The supervisor daemon starts `claude -p` with the role prompt. Nobody types anything |
| Interactive, working alongside the agent | `/baton:work` from the plugin: runs `whoami`, `task_next`, then the loop |
| One specific task | `/baton:take TSK-0042` |

Running plain `claude` in the repo is not a compliant agent. It will be blocked by the lease gate the moment it tries to edit, and it will appear in the next conformance report.

### 13.8 Distribution: ship Baton as a Claude Code plugin

Enforcement only counts if it is on every machine. Package the whole thing as a plugin in a private marketplace, so an agent machine is one install away from compliant:

```
baton-plugin/
  .claude-plugin/plugin.json
  agents/
    analyst.md  ui-designer.md  frontend-dev.md
    backend-dev.md  ai-dev.md  qa.md  reviewer.md
  hooks/hooks.json            # the four gates of 13.4
  commands/
    work.md  take.md  status.md
  skills/baton-protocol/SKILL.md
  .mcp.json                   # the Baton MCP server
```

Sabita installs the plugin and her machine has the roles, the gates, the commands and the server endpoint. Updating the protocol is a plugin version bump, not an instruction to seven people. Plugin hooks load when the plugin is enabled.

---

## 14. Security

- **Identity**: one bearer token per agent, stored as a sha256 hash. The MCP face resolves the agent from the token. No tool accepts an agent id as input.
- **RLS**: on every table. Agent tokens map to a `service_agent` role that can only see tasks for its own role, its own claims, its own messages and artefacts it is entitled to read. The dashboard uses a separate authenticated human role.
- **Storage**: the `artifacts` bucket is private, access via signed URLs with a short expiry issued by `artifact_get`.
- **Secrets never enter Baton.** Database URLs and provider keys come from each machine's environment. The redaction pass in section 11 is the second line of defence, not the first.
- **Agents cannot escalate.** No tool can change another agent's task, change a role definition, or alter a completion gate. `needs_human` is the only escalation path.

---

## 15. Dashboard

Next.js, one page, Realtime subscriptions on `tasks` and `messages`.

- **Now**: each agent, its role, machine, status, current task, lease countdown.
- **Board**: tasks by state, filterable by role, with the dependency and artefact chain for a selected task.
- **Stream**: the last 200 events, filterable by agent, task or type, each linking to its transcript path.
- **Attention**: everything in `needs_human` or `blocked`, unanswered questions first.
- **Spend**: cost by task, by role, by day.

Four supervisor actions, and no more: **reprioritise**, **cancel**, **answer** a blocked question, **force-release** a lease.

---

## 16. Failure modes

| Failure | Behaviour |
|---|---|
| Agent process dies mid-task | Lease expires within `lease_seconds`, reaper returns the task to `ready`, attempts incremented |
| Machine offline for a day | Nothing happens. Its roles simply are not worked until it returns |
| Two agents claim simultaneously | Impossible. `FOR UPDATE SKIP LOCKED` in one statement |
| Agent loops on a failing task | `max_attempts` reached, state becomes `needs_human` |
| Agent burns budget | Trigger moves the task to `needs_human`, heartbeat fails, agent exits |
| Baton unreachable | Agent cannot claim, so it exits. No work happens, and no work is corrupted |
| Artefact fails schema validation | `task_submit` rejects it, task returns to `ready` with the validation error in the event |
| Circular dependency | Insert trigger rejects a `depends_on` that creates a cycle |
| Message flood | `broadcast` is rate-limited per agent per hour; questions are not |

---

## 17. Non-functional requirements

| | Target |
|---|---|
| `task_next` latency | < 300 ms p95 |
| Hook ingest | < 150 ms p95, and a hook failure must never block the agent |
| Event throughput | 50 events/second sustained, well inside a small Supabase instance |
| Event retention | 180 days hot, then archived to Storage as Parquet |
| Availability | Business hours critical. An outage stalls work but loses none |
| Data residency | EU region (Supabase `eu-west-1` or `eu-central-1`) |
| Recovery | Point-in-time recovery enabled, restore tested once before go-live |

---

## 18. Build phases

Each phase ends with its acceptance tests passing. Do not proceed otherwise.

### Phase 1: the spine
Migrations for all tables, types, `claim_next`, `consumes_satisfied`, the reaper cron, RLS policies. A seed script creating two roles and three tasks.

**Acceptance**
1. Two concurrent `claim_next` calls for the same role and one ready task: exactly one returns the task, the other returns none.
2. Claim a task, do not heartbeat, wait past the lease: the task is `ready` again and `attempts` is 1.
3. A task whose dependency is not `done` is never returned by `claim_next`.
4. A task whose `consumes` artefact does not exist is never returned.
5. After `max_attempts`, the task lands in `needs_human` and stays there.

### Phase 2: MCP face
All tools in section 10, bearer auth, the error contract, `whoami`.

**Acceptance**
6. A real Claude Code session with the `.mcp.json` mounted can call `whoami` and `task_next` and receive a task.
7. A tool call with a revoked token is rejected, and the rejection is logged as an event.
8. `task_heartbeat` on a reaped lease returns `LEASE_LOST`.

### Phase 3: supervisor and roles
Role definitions for `analyst`, `frontend-dev` and `qa`. The supervisor daemon. `/work-available`.

**Acceptance**
9. With a ready task for `qa` and no other work, the supervisor starts exactly one agent, which claims it, and the process exits when the task is submitted.
10. With no ready work, the supervisor starts nothing for an hour.

### Phase 4: hooks and inbox
The hook face, redaction, context injection, run and cost accounting, `inbox` and `answer`.

**Acceptance**
11. A full agent run produces `session_start`, at least one `tool`, `turn_end` and `session_end` events, all correlated to one run and one task.
12. A string shaped like an API key in a tool payload is stored as `[redacted]`.
13. An agent that calls `task_ask` and exits leaves its task `blocked`; a supervisor answer returns it to `ready` with the answer in the next agent's injected context.
14. Cost from `turn_end` accumulates onto the task, and exceeding `budget_usd` moves it to `needs_human`.

### Phase 5: artefacts and the pipeline
Storage bucket, `artifact_put` and `artifact_get`, JSON Schemas per artefact kind, the completion gate.

**Acceptance**
15. A `ui-designer` task producing `design_spec` unblocks a `frontend-dev` task consuming it, with no human action.
16. `task_submit` without the declared artefact is rejected and the task returns to `ready`.
17. An artefact failing its schema is rejected with the validation error in the event log.

### Phase 6: dashboard
The five views and the four actions.

**Acceptance**
18. Killing an agent's process is visible on the dashboard within 90 seconds, and force-release returns the task immediately.

### Phase 7: GitHub
Webhooks in, four outbound calls, the promotion rule, the CI completion gate.

**Acceptance**
19. A task producing a `pr` artefact only becomes `done` after the GitHub check reports success.
20. A failing check creates a fix task assigned to the originating role, consuming the `test_report`.

### Phase 8: enforcement and distribution
The four hook gates of section 13.4, the deny rules, the conformance report, and the plugin packaging of sections 21 and 22.

Build gates (a) and (c) as soon as Phase 4 exists. They are the two that change agent behaviour most, and running without them teaches the agents habits you will then have to correct.

**Acceptance**
21. An agent holding no lease attempts a `Write`. The `PreToolUse` gate denies it, and a `no_lease` event is recorded with the attempted path.
22. An agent stops while holding an open task. The `Stop` gate returns exit code 2 and the agent resumes and submits.
23. `task_submit` called by an agent that is not the task's assignee is rejected with `NOT_ASSIGNED`, and the rejection is logged.
24. A file edited by a session with no claim appears in the next day's conformance report.
25. A fresh machine installs the plugin from the private marketplace and runs `/baton-core:status` successfully with no manual file copying.
26. Enabling `baton-role-qa` on a machine makes that session run as the `qa` agent, with `Write` and `Edit` absent from its tool list.
27. `claude plugin validate ./plugins/baton-core --strict` passes in CI, and `claude plugin eval ./plugins/baton-role-qa --threshold 0.8` exits 0.
28. With `disableSideloadFlags` set in managed settings, `claude --plugin-dir ./anything` is rejected.

### Phase 9: multi-project
The `projects`, `project_plugins` and `project_mcp` tables, `baton sync`, and the release train of section 25.

**Acceptance**
29. Two repositories on one machine enable different role sets. Opening each gives Claude Code only that project's roles.
30. `baton sync` on a machine missing a project's role plugin installs it at project scope and reports no drift on a second run.
31. Bumping a role plugin's version and moving a project's marketplace `ref` results in the next spawned agent running the new version, with no manual step on the agent machine.
32. Reverting the `ref` and running `baton sync` returns the machine to the previous version.

---

## 19. Open decisions

| # | Decision | Default if unanswered |
|---|---|---|
| 1 | Repo layout: Baton in its own repo, or a folder in the product repo | Its own repo, `clane-ai/baton` |
| 2 | Supabase region | `eu-west-1` |
| 3 | Edge Functions vs a small Node service on a VM for the MCP face | Edge Functions |
| 4 | Permission mode for unattended roles | `dontAsk`, passed on the spawn line, with the role's `tools` list as the allowlist |
| 5 | Default lease length | 30 minutes, heartbeat every 10 |
| 6 | Default per-task budget | Set per role, `qa` lower than `backend-dev` |
| 7 | Whether GitHub Issues are used at all in v1 | Yes, but only for promoted items |
| 8 | Artefact schema format: JSON Schema, or Zod shared with the app | JSON Schema, language-neutral |
| 9 | Plugin granularity: one plugin with all roles, or core plus one plugin per role | Core plus one per role, so `settings.json` `agent` pins the machine to a role |
| 10 | Pretool gate behaviour when the server is unreachable | Fail closed. An agent machine cannot work offline |
| 11 | Distribution: private git marketplace, or claude.ai organisation settings | Private git marketplace, since the latter forbids a top-level `bin/` |
| 12 | CLI distribution: npm global install, or shipped in the plugin's `bin/` | npm, invoked through `npx` from the monitor |
| 13 | Does `baton sync` rewrite the project's committed `.claude/settings.json`, or only reconcile installs | Rewrite behind `--write-settings`, off by default |
| 14 | Do projects pin the marketplace by tag, or all track `main` | Pin by tag; only the Baton repo itself tracks `main` |
| 15 | Where `baton-core` is installed | Project scope everywhere, except a dedicated agent machine where user scope is simpler |

---

## 20. Product surface and repository layout

Baton is five things shipped together.

| Component | What it is | Where it runs |
|---|---|---|
| `baton-server` | Supabase project: migrations, functions, cron | Supabase, EU region |
| `baton-plugin` | Claude Code plugins: roles, gates, skills, MCP config, monitors | Every agent machine |
| `baton-cli` | Supervisor daemon and operator CLI | Every agent machine, and your terminal |
| `baton-dash` | Next.js dashboard | Vercel, or alongside the Supabase project |
| `baton-schemas` | JSON Schemas for every artefact kind | Shared by all four |

One repository, pnpm workspaces, with the private plugin marketplace in the same repo so a plugin change and a server change ship together.

```
baton/
  .claude-plugin/marketplace.json        # the private marketplace
  packages/
    server/
      supabase/migrations/*.sql
      supabase/functions/{mcp,hooks,gh,gate}/
    schemas/{task_spec,design_spec,api_contract,build,test_report}.json
    cli/                                  # @clane-ai/baton-cli
    dash/
  plugins/
    baton-core/                           # gates, MCP server, skills, monitors
    baton-role-analyst/
    baton-role-ui-designer/
    baton-role-frontend-dev/
    baton-role-backend-dev/
    baton-role-ai-dev/
    baton-role-qa/
    baton-role-reviewer/
```

**Why one plugin per role plus a core.** A plugin's root `settings.json` supports an `agent` key that activates one of the plugin's own agents as the **main thread**, applying its system prompt, tool restrictions and model. One role per plugin therefore means that enabling `baton-role-qa` on a machine makes that machine's Claude Code a QA agent by definition, rather than a general session that has been asked to behave like one. The role plugins declare `dependencies: ["baton-core"]`, so the gates, the MCP server and the protocol skill arrive with any role.

---

## 21. The Baton plugin

### 21.1 baton-core

```
plugins/baton-core/
  .claude-plugin/plugin.json
  settings.json                  # { "subagentStatusLine": true }
  .mcp.json                      # the Baton MCP server
  hooks/hooks.json               # the four gates of section 13.4
  skills/
    baton-protocol/SKILL.md      # the loop, model-invocable
    work/SKILL.md                # /baton-core:work
    take/SKILL.md                # /baton-core:take TSK-0042
    status/SKILL.md
  monitors/monitors.json         # inbox tail
```

Manifest, with the two values every machine needs supplied as user config rather than hardcoded:

```json
{
  "name": "baton-core",
  "displayName": "Baton Core",
  "version": "0.1.0",
  "description": "Coordination tools, protocol and enforcement gates for Baton agents.",
  "author": { "name": "Clane AI" },
  "userConfig": {
    "serverUrl":  { "type": "string", "description": "Baton server base URL", "required": true },
    "agentToken": { "type": "string", "description": "This machine's agent token", "required": true }
  }
}
```

`.mcp.json`, consuming that config:

```json
{
  "baton": {
    "type": "http",
    "url": "${user_config.serverUrl}/mcp",
    "headers": { "Authorization": "Bearer ${user_config.agentToken}" }
  }
}
```

This is the whole onboarding story. The operator installs the plugin, Claude Code asks for the two values, they are stored in that machine's `pluginConfigs`, and no token is ever committed. For rotating tokens, use `headersHelper` instead: a command that prints the headers as JSON and is re-run per request.

Plugin MCP tools are namespaced `mcp__plugin_baton-core_baton__<tool>`. Use that form in every allow list.

### 21.2 The gates

`hooks/hooks.json`, shipped with the plugin so the gates arrive with the install rather than by copying files:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [{ "type": "http",
                    "url": "${user_config.serverUrl}/gate/pretool",
                    "headers": { "Authorization": "Bearer ${user_config.agentToken}" },
                    "timeout": 10 }] }
    ],
    "SessionStart":     [{ "type": "http", "url": "${user_config.serverUrl}/hooks/session-start" }],
    "UserPromptSubmit": [{ "type": "http", "url": "${user_config.serverUrl}/hooks/prompt" }],
    "PostToolUse":      [{ "matcher": "Edit|Write|Bash",
                           "hooks": [{ "type": "http", "url": "${user_config.serverUrl}/hooks/tool" }] }],
    "Stop":             [{ "type": "http", "url": "${user_config.serverUrl}/hooks/turn-end" }],
    "SessionEnd":       [{ "type": "http", "url": "${user_config.serverUrl}/hooks/session-end" }]
  }
}
```

**The pretool gate fails closed.** If the server is unreachable it denies, because otherwise an agent could work unsupervised by unplugging the network. The consequence is that an agent machine cannot work offline, which for this system is correct rather than unfortunate.

### 21.3 Monitors as the push channel

```json
[
  { "name": "baton-inbox",
    "command": "npx -y @clane-ai/baton-cli inbox --follow",
    "description": "Baton inbox: questions, answers and priority changes",
    "when": "always" }
]
```

Every stdout line from a monitor reaches Claude as a notification during the session, and Claude Code starts it automatically when the plugin is active. That removes the need for an agent to poll its inbox, and it is how a priority change or an answer reaches an agent already mid-task.

Note the `bin/` restriction: a top-level `bin/` directory cannot be included in a plugin distributed through claude.ai organisation settings. Invoking the CLI through `npx` avoids the issue entirely, at the cost of requiring Node on the machine.

### 21.4 A role plugin

```
plugins/baton-role-qa/
  .claude-plugin/plugin.json     # dependencies: [{ "name": "baton-core", "version": "^0.1.0" }]
  settings.json                  # { "agent": "qa" }
  agents/qa.md
```

`agents/qa.md`:

```yaml
---
name: qa
description: Runs the test suite against a build artefact and produces a test_report.
model: sonnet
tools: Read, Grep, Glob, Bash(npm test *), Bash(npx playwright *), mcp__plugin_baton-core_baton
disallowedTools: Write, Edit, WebFetch
maxTurns: 60
skills: baton-protocol
color: green
---

You are the QA agent on a Baton team. You test what other agents built. You do not
fix code: a failure becomes a fix task for the role that produced the build.
```

**A constraint to design around.** Plugin-shipped agent definitions are documented as not honouring `hooks`, `mcpServers` or `permissionMode` in the agent file itself. That is exactly why the gates live in `hooks/hooks.json`, the MCP server lives in the plugin's `.mcp.json`, and the permission mode is passed by the supervisor on the command line. Confirm this against the plugins reference before relying on the opposite.

### 21.5 Permission mode for unattended roles

Use `dontAsk`: reads plus pre-approved tools only, and anything that would prompt is **denied** rather than left hanging for a human who is not there. `auto` is the alternative when a role needs more latitude, at the cost of classifier latency. Never `bypassPermissions` outside a container.

A project `.claude/settings.json` cannot set `auto` or `bypassPermissions` as the default mode; only user or managed settings can. So the supervisor passes `--permission-mode` explicitly on every spawn.

---

## 22. Distribution and enforcement

### 22.1 The private marketplace

`.claude-plugin/marketplace.json` at the repo root:

```json
{
  "name": "clane-ai",
  "owner": { "name": "Clane AI" },
  "description": "Clane AI internal Claude Code plugins",
  "metadata": { "pluginRoot": "plugins/" },
  "plugins": [
    { "name": "baton-core",              "source": "./plugins/baton-core" },
    { "name": "baton-role-analyst",      "source": "./plugins/baton-role-analyst" },
    { "name": "baton-role-ui-designer",  "source": "./plugins/baton-role-ui-designer" },
    { "name": "baton-role-frontend-dev", "source": "./plugins/baton-role-frontend-dev" },
    { "name": "baton-role-backend-dev",  "source": "./plugins/baton-role-backend-dev" },
    { "name": "baton-role-ai-dev",       "source": "./plugins/baton-role-ai-dev" },
    { "name": "baton-role-qa",           "source": "./plugins/baton-role-qa" },
    { "name": "baton-role-reviewer",     "source": "./plugins/baton-role-reviewer" }
  ]
}
```

Install on a machine:

```bash
/plugin marketplace add clane-ai/baton
/plugin install baton-role-qa@clane-ai
```

The repo stays private. Access uses SSH keys through `ssh-agent`, or HTTPS through a git credential helper. One trap: background auto-update does **not** use credential helpers for HTTPS private repos, so prefer SSH, or configure a git URL rewrite with a token, or set `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` so a failed refresh keeps the last known good copy.

### 22.2 Team-level enforcement, with no access to the machine

In the **product** repo's `.claude/settings.json`, committed:

```json
{
  "extraKnownMarketplaces": {
    "clane-ai": { "source": { "source": "github", "repo": "clane-ai/baton" } }
  },
  "enabledPlugins": { "baton-core@clane-ai": true }
}
```

Anyone who opens the product repo gets the marketplace registered and the core plugin with its gates enabled. This is the normal path, and it is enough for a two-person team that wants the process to hold.

### 22.3 Managed settings, when it must be non-removable

On a machine you own, `managed-settings.json` (`/etc/claude-code/` on Linux, `/Library/Application Support/ClaudeCode/` on macOS, `C:\Program Files\ClaudeCode\` on Windows):

```json
{
  "extraKnownMarketplaces": { "clane-ai": { "source": { "source": "github", "repo": "clane-ai/baton" } } },
  "enabledPlugins": { "baton-core@clane-ai": true },
  "strictKnownMarketplaces": ["clane-ai"],
  "disableSideloadFlags": true,
  "permissions": { "deny": ["SendMessage", "ListAgents"] }
}
```

`disableSideloadFlags` is the important one: it rejects `--plugin-dir`, `--plugin-url`, `--agents` and `--mcp-config`, which is how someone would otherwise start a session with the gates bypassed. Managed settings apply after every other source, and `--plugin-dir` cannot override a managed force-enable or force-disable.

Use this on infrastructure you control. On a contractor's own laptop it is a conversation, not a policy.

### 22.4 Versioning and release

- `version` in each `plugin.json` pins the plugin. Consumers update only when you bump it.
- `claude plugin tag --push` creates `{plugin-name}--v{version}` git tags, which is what dependency resolution reads.
- Role plugins pin the core with a range: `{ "name": "baton-core", "version": "^0.1.0" }`.
- `claude plugin validate ./plugins/<name> --strict` runs in CI on every PR.
- Changing the protocol means bumping `baton-core` and letting the role plugins pick it up, not messaging people to edit files.

### 22.5 Testing the roles like code

`claude plugin eval` runs a set of prompts several times with and without the plugin loaded, so you can measure what a role definition actually changes and catch a regression when you edit it or a new model ships.

```bash
claude plugin eval ./plugins/baton-role-qa \
  --trust-plugin --json results.json \
  --threshold 0.8 --max-cost-usd 20 \
  --model claude-sonnet-5 --no-publish
```

Exit 0 above the threshold, 1 below, 2 if the cost ceiling was hit with a partial result written. Gate CI on it. A role definition is a prompt, and prompts regress silently.

---

## 23. Onboarding a new agent machine

Start to first claimed task.

1. **Operator**, from anywhere: `baton agents add --name qa-01 --role qa --machine sabita-laptop`. Prints the token once.
2. **On the machine**: `npm i -g @clane-ai/baton-cli`.
3. `claude` in the product repo, then `/plugin marketplace add clane-ai/baton` and `/plugin install baton-role-qa@clane-ai`. Accept the trust prompt, which covers the plugin's whole codebase, so review it once as you would any dependency.
4. Claude Code asks for `serverUrl` and `agentToken`. Paste them. They are stored in that machine's `pluginConfigs`, not in the repo.
5. `baton doctor`: checks the server is reachable, the token is valid, the role matches the installed plugin, the gates are registered, and the MCP tools resolve.
6. `baton supervise --roles qa --install`: writes a systemd user unit or a Windows scheduled task, and starts it.
7. `baton seed --demo` from the operator side, then watch the dashboard.

Under ten minutes, and nothing copied by hand.

---

## 24. The CLI

`baton`, published as `@clane-ai/baton-cli`. Used by the supervisor daemon and by humans.

| Command | Purpose |
|---|---|
| `baton supervise --roles qa,frontend-dev` | The daemon. Polls `/work-available` and spawns an agent when there is work |
| `baton work --role qa --once` | Run a single task in the foreground, for debugging |
| `baton status` | Agents, current claims, lease countdowns, blocked tasks |
| `baton tasks ls\|show\|create\|prioritise\|cancel` | Queue operations |
| `baton answer <message-id> "<text>"` | Answer a blocked question without opening the dashboard |
| `baton agents add\|list\|revoke` | Token lifecycle |
| `baton inbox --follow` | The stream the monitor consumes |
| `baton logs --agent qa-01 --follow` | Tail the event stream |
| `baton prompt --role qa` | Emit the role's run prompt, used by the spawn line |
| `baton doctor` | Verify a machine's setup |
| `baton seed --demo` | Demo data for a first run |

The spawn line is where the unattended policy lives, because a plugin agent file cannot set it:

```bash
claude --agent qa -p "$(baton prompt --role qa)" \
  --permission-mode dontAsk \
  --max-turns 60 \
  --max-budget-usd 2.00 \
  --output-format stream-json
```

`claude --agent <name>` runs the whole session as that agent, and it works with `-p`. Exit codes the daemon must handle: 0 success, 1 error, 2 cost ceiling or auth failure, 130 interrupted, 143 terminated. The daemon maps 2 to a `task_release` with reason `budget`, and 1 to a release carrying the captured stderr.

---

## 25. Multiple projects: composition, pinning and updates

People work on several projects. Each one needs a different set of roles, different MCP servers, and sometimes a different version of Baton itself. This section is how that is expressed and how a change reaches every machine.

### 25.1 Scopes

Claude Code installs a plugin at one of three scopes, and the choice is the whole mechanism:

| Scope | Where it is written | Who gets it |
|---|---|---|
| **User** | `~/.claude/settings.json` | You, in every project |
| **Project** | `.claude/settings.json`, committed | Every collaborator on that repository |
| **Local** | `.claude/settings.local.json`, gitignored | You, in that repository only |

Baton uses **project scope** for everything except `baton-core`, which may sit at user scope on a dedicated agent machine. A role belongs to a project, not to a person.

### 25.2 A project declares its own team

The Packaging Portal repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "clane-ai": {
      "source": { "source": "github", "repo": "clane-ai/baton", "ref": "v0.3.0" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "baton-core@clane-ai": true,
    "baton-role-frontend-dev@clane-ai": true,
    "baton-role-backend-dev@clane-ai": true,
    "baton-role-qa@clane-ai": true
  },
  "enabledMcpjsonServers": ["baton", "supabase-packaging-portal"]
}
```

A different project, say the voice platform, enables `baton-role-ai-dev` and `baton-role-reviewer` instead and pins a different `ref`. Open a repo, get that repo's team. Nothing is global, and nobody carries seven roles they do not use, which also matters because every enabled plugin adds context cost on every turn.

### 25.3 The trap: enabling is not installing

Since v2.1.195, `extraKnownMarketplaces` registers the catalogue but **does not install** plugins that come from an external source. A plugin that only the project's `.claude/settings.json` enables, and whose source is a GitHub repo, does not load until that person installs it. Claude Code reports it as not installed and prints the `claude plugin install` command.

So a committed settings block is a **declaration of intent**, not a deployment. Something has to close the gap, and asking people to paste install commands does not survive the third project.

### 25.4 `baton sync`: desired state, reconciled

Baton holds the desired state per project and the CLI reconciles the machine to it.

```sql
create table projects (
  id           uuid primary key default gen_random_uuid(),
  key          text unique not null,          -- 'packaging-portal'
  name         text not null,
  repo         text not null,                 -- 'clane-ai/packaging-portal'
  marketplace_ref text not null default 'main',
  created_at   timestamptz not null default now()
);

create table project_plugins (
  project_id   uuid not null references projects(id),
  plugin       text not null,                 -- 'baton-role-qa'
  version      text,                          -- semver range, null = follow the ref
  scope        text not null default 'project',
  enabled      boolean not null default true,
  primary key (project_id, plugin)
);

create table project_mcp (
  project_id   uuid not null references projects(id),
  server       text not null,
  config       jsonb not null,
  primary key (project_id, server)
);
```

```bash
baton sync                 # reconcile this checkout against the server's profile
baton sync --dry-run       # print what would change
baton sync --write-settings # also rewrite the project's .claude/settings.json block
```

What it does, idempotently:

1. Reads the profile for the project it is standing in, keyed by the git remote.
2. Registers the marketplace at the project's pinned `ref` if it is missing.
3. Runs `claude plugin install <plugin>@clane-ai --scope project` for anything enabled but not installed.
4. Runs `claude plugin uninstall` or `disable` for anything installed but no longer in the profile.
5. Writes the `enabledPlugins` and `enabledMcpjsonServers` block into `.claude/settings.json` when asked, so the committed file and the server agree.
6. Reports drift to the server as an event, so the dashboard can show which machines are behind.

`baton doctor` calls `sync --dry-run` and fails loudly if the machine does not match the profile. The supervisor daemon calls `baton sync` before it spawns the first agent of the day. Changing a project's team is then a row in `project_plugins`, not a message to two people.

### 25.5 Which MCP servers live where

| Kind | Where it is declared | Example |
|---|---|---|
| Baton's own coordination server | `baton-core` plugin `.mcp.json` | `baton` |
| A product's own infrastructure | the project repo's `.mcp.json`, enabled by `enabledMcpjsonServers` | that project's Supabase, its Figma file |
| A role's tool of trade | the role plugin's `.mcp.json` | a Playwright server for `qa` |

The rule: if it follows the role, it ships in the role plugin. If it follows the product, it lives in the product repo. If it follows the coordination layer, it is in `baton-core`. Project-scoped MCP servers in `.mcp.json` need approval in an interactive session but load without prompting in `-p`, Agent SDK and cloud sessions, which is what makes unattended agents work.

### 25.6 How an update reaches every machine

The release train:

1. Change a role definition or a gate in the `baton` repo.
2. `claude plugin validate ./plugins/<name> --strict` and `claude plugin eval` in CI.
3. Bump `version` in that plugin's `plugin.json`. Consumers only move when this changes.
4. `claude plugin tag --push` writes the `{plugin}--v{version}` tag.
5. Move the `ref` a project points at, or leave the project on `main` to track continuously.

What happens on each machine:

- With auto-update on for the marketplace, Claude Code refreshes the catalogue and updates installed plugins **after session start, with a random delay of up to ten minutes**. The running session keeps the versions it launched with, and you get a notification to run `/reload-plugins`, or the new version loads on the next launch.
- Third-party and local marketplaces have **auto-update off by default**, so turn it on explicitly with `"autoUpdate": true` on the `extraKnownMarketplaces` entry, which also works from managed settings for a whole organisation.
- Installing by `plugin@marketplace` refreshes that marketplace first, even when auto-update is off.
- `/plugin marketplace update clane-ai` forces a refresh now.
- `DISABLE_AUTOUPDATER` turns updates off; pair it with `FORCE_AUTOUPDATE_PLUGINS=1` to keep plugin updates while pinning the Claude Code binary.

**Baton gets this almost free.** Agents are summoned per task and exit when they finish, so every new task starts a fresh session that loads whatever version is on disk. There is no reload dance and no long-lived session running last week's protocol. The only thing that needs care is the supervisor: have it call `baton sync` on a schedule, and restart itself after an update.

Note for interactive sessions: `/reload-plugins` works in `-p` and desktop sessions on v2.1.260 or later, but only when typed directly into the session, and it does **not** connect or disconnect plugin MCP servers there. Those changes wait for the next session.

### 25.7 Pinning and rollback

- A project pins the marketplace with `"ref": "v0.3.0"`. Another tracks `main`. The Packaging Portal can sit on a known-good protocol while you iterate on Baton elsewhere.
- Role plugins pin the core with a range, `{ "name": "baton-core", "version": "^0.1.0" }`, so a core fix reaches every role without touching seven manifests.
- Rollback is moving the project's `ref` back and running `baton sync`. No machine is touched by hand.
- Two traps: **removing a marketplace uninstalls every plugin installed from it**, so never script a remove as a fix. And if plugin skills stop appearing, the cure is `rm -rf ~/.claude/plugins/cache` then reinstall, not reinstalling Claude Code.

### 25.8 Hygiene

Claude Code's `/plugin` **Discover** tab shows each plugin's context cost, and the **Installed** tab flags plugins not used in two weeks across at least ten sessions. Review that list per project. A role enabled in a repo that never produces that role's tasks is pure context tax on every turn, and per-project composition exists precisely so that does not happen.

---

## 26. Naming

The name is Baton. Alternatives considered are below, kept for the record. Domain and trademark availability have not been checked.

**Recommended: Baton.**

The metaphor is exact rather than decorative, which matters because it is also the vocabulary the team will use daily. The lease *is* the baton. An agent holds it, and only the holder can write. Handing off an artefact is passing the baton to the next leg. An agent that dies drops the baton, and the reaper picks it up. `baton.dev` or `usebaton.*` are the likely domains. Terminology falls out naturally: hold, pass, drop, leg.

Alternatives:

| Name | Case | Against |
|---|---|---|
| **Criú** | Irish for crew, pronounced "kree-oo". Fits the EolasFlow and Clane naming family, and the system genuinely is a crew | The fada is awkward in a domain, a CLI and a package name |
| **Dispatch** | A dispatcher assigns jobs to a distributed crew, tracks them and reassigns when one fails. Describes the system precisely and needs no explanation | Common word, heavily used in software already |
| **Foreman** | Instantly understood: the person who runs a crew and hands out work | Existing tools carry the name, and it reads as hierarchy rather than coordination |

If this ever becomes a product rather than internal tooling, Baton is the one that survives a landing page. If it stays internal, Criú is the one that fits the rest of the estate.

If the name ever changes, it is a find and replace on `Baton`, the env var prefix `BATON_`, the MCP server key `baton`, the plugin names `baton-*`, and the command namespace `/baton-core:`. Do it before the first commit.

---

## 27. Glossary

- **Agent**: one Claude Code session running exactly one role.
- **Role**: a job description, defined once in `.claude/agents/`, reusable as a subagent or a teammate.
- **Task**: a unit of work with a spec, acceptance criteria, dependencies and declared artefacts.
- **Claim**: exclusive assignment of a task to an agent for a bounded time.
- **Lease**: the expiry on a claim. It is what makes agent death survivable.
- **Artefact**: a typed, validated deliverable that flows between roles.
- **Gate**: the server-side test that decides whether a task is done.
- **Promotion**: turning something that outlived a task into a GitHub Issue.

---

## 28. Naming decisions (22 September 2026)

- Organisation: **Clane AI**. GitHub org `clane-ai`, repository `clane-ai/baton`.
- npm scope `@clane-ai`, CLI package `@clane-ai/baton-cli`.
- Plugin marketplace name `clane-ai`, so plugins install as `baton-core@clane-ai`.
- Supabase: the existing Clane AI project (ref `yemmiowsudakdviqqlnt`, `eu-west-1`), all Baton objects in a dedicated `baton` schema. No new project.
- Publishing goes through the clane.sh website. Details to be agreed later.
