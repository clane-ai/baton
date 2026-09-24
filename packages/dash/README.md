# Baton app

The human-facing app over Baton's data: what needs a person, the evidence to decide it, and where every
run of a process stands. Next.js 15, React 19, no UI library. Design: `docs/superpowers/specs/2026-09-24-baton-app-m1-design.md`;
build plan: `docs/superpowers/plans/2026-09-24-baton-app-m2.md`; contract with the engine: `docs/ui-brief.md`.

## Screens

| Route | Screen |
|---|---|
| `/inbox` | Inbox: approvals, parked steps and agent questions, with tiles, filters and `j`/`k`/`Enter` |
| `/inbox/[key]` | Item: source documents left, the artefact as a business document right, policy summary, activity, decision bar |
| `/runs`, `/runs/[key]` | Runs and one run: steps, artefacts, activity, the swimlane graph |
| `/documents` | Artefacts by kind with search and a detail sheet |
| `/activity` | Events with run, step, agent and type filters |
| `/spend` | Cost by run, role, day and step |
| `/ops/now`, `/ops/board`, `/ops/flow`, `/ops/attention` | The operator console, unchanged |

## Running

```
pnpm install
pnpm --filter @clane-ai/baton-dash dev     # http://localhost:3210
pnpm --filter @clane-ai/baton-dash test    # vitest over lib/
pnpm --filter @clane-ai/baton-dash exec tsc --noEmit
```

Environment (from the repo-root `.env` in development, the host in deployment):

- `BATON_URL`: the edge function, `…/functions/v1/baton`
- `BATON_OPERATOR_TOKEN`: the operator token the proxy uses; the app itself has no login
- `BATON_WORKSPACE`: the folder whose documents `/api/workspace` serves (the P2P run workspace in development)

## How it talks to the engine

Every screen reads the operator API through the route handlers under `app/api/*`, which proxy with the server-side
token (`lib/baton.ts`). Decisions post to `/api/tasks/[id]/action` (approve, reject, retry, cancel, prioritise,
force-release) and `/api/answer`. Workspace documents come from `/api/workspace?path=`.

Engine endpoints the app relies on (edge function v15): `GET /admin/inbox`, `GET /admin/tasks/:key/documents`,
`decision` and `questions` on `GET /admin/tasks/:key`, `GET /admin/events?workflow_run=`, `GET /admin/tasks?q=`,
`next[]` on run steps, `POST /admin/answer {task_key}`, and optional `_provenance` on artefacts (rendered as source
markers when present). `/api/inbox` builds its own rows from task details if `/admin/inbox` is unavailable.

## Layout

- `lib/` pure helpers, unit-tested: `theme` (state to colour tone), `money`, `inbox` (grouping, tiles, summaries),
  `documents` (email parsing, workspace conventions), `policy` (one-sentence verdicts), `drafts` (browser-local reasons)
- `components/shell` rail and app shell; `components/inbox`, `components/item`, `components/runs`, `components/documents`,
  `components/activity`, `components/spend` one folder per screen; the operator views stay at `components/*View.tsx`
- `app/globals.css` the theme tokens and every component style; the old operator classes are mapped onto the tokens

## Not in this build

Editing artefact fields before approval, server-side drafts, approver authority and identity, AutoPilot, escalation,
notifications, a phone layout, dark theme, export. Provenance markers render only when the engine sends `_provenance`.
