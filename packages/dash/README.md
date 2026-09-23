# @clane-ai/baton-dash

Operator dashboard for Baton. One page, five views (Now, Board, Stream, Attention, Spend), polling every 5 seconds. Next.js 15 App Router, React 19, TypeScript, plain CSS. No Supabase client, no Supabase Auth, no Realtime.

## How it gets data

The browser never talks to Baton directly and never sees the operator token. It calls route handlers under `/api/*`, which proxy to the edge function's operator API (`/admin/*`) with `Authorization: Bearer <BATON_OPERATOR_TOKEN>` from the server environment and return the upstream JSON and status unchanged.

| Route handler | Upstream |
|---|---|
| `GET /api/status` | `GET /admin/status` |
| `GET /api/tasks?state=&role=` | `GET /admin/tasks` |
| `GET /api/tasks/:id` | `GET /admin/tasks/:id` |
| `POST /api/tasks/:id/action` `{action: "prioritise", priority}` / `{action: "cancel", reason}` / `{action: "force-release"}` | `POST /admin/tasks/:id/{prioritise,cancel,force-release}` |
| `POST /api/answer` `{message_id, body}` | `POST /admin/answer` |
| `GET /api/events?agent=&task=&type=&limit=&since=` | `GET /admin/events` |
| `GET /api/spend` | `GET /admin/spend` |
| `GET /api/roles` | `GET /admin/roles` |

Polling pauses while the browser tab is hidden and resumes on return. The top bar shows how old the data is.

## Environment

| Variable | Purpose |
|---|---|
| `BATON_URL` | Base URL of the `baton` edge function, e.g. `https://<project>.supabase.co/functions/v1/baton` |
| `BATON_OPERATOR_TOKEN` | An operator token (`btn_...`). Server-side only. |

For local development both are read from the repo-root `../../.env` (the same file the CLI and server tests use). The `dev` and `start` scripts pass `--env-file=../../.env` to Node, so nothing needs to be copied into this package and no `.env.local` should be committed. In deployment, set the two variables in the host's environment.

## Run

From the repo root:

```
pnpm install
pnpm --filter @clane-ai/baton-dash dev      # http://localhost:3210
```

Production:

```
pnpm --filter @clane-ai/baton-dash build
pnpm --filter @clane-ai/baton-dash start    # also port 3210, also reads ../../.env
```

Quick check that the proxy and token work:

```
curl http://localhost:3210/api/status
```

## Views and actions

- **Now**: every agent with role, machine, status, last seen, current task and a live lease countdown (red under five minutes).
- **Board**: tasks by state, filterable by role. Click a card for the detail drawer: spec, acceptance, dependency chain, artefacts (with pretty JSON for stored content), claims, messages, events, and the actions.
- **Stream**: the last 200 events, newest first, filterable by agent, task key and type. Click a row to expand the payload. `transcript_path` is shown as text; it is a path on the agent's machine.
- **Attention**: tasks in `needs_human` or `blocked`, unanswered questions first, with an answer box.
- **Spend**: total, by task, by role, by day.

The only supervisor actions are **reprioritise**, **cancel**, **force-release** (in the task drawer) and **answer** (on the Attention view). There is no create-task UI.
