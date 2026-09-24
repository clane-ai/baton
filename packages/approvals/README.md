# Approvals area — staging

The Approvals feature area of the Clane web client (the Baton engine's screens:
Inbox, Work, Runs, Documents, Activity, Spend), staged here until the platform
branch and write access are confirmed. Plan:
`docs/superpowers/plans/2026-09-24-approvals-area.md`; spec:
`docs/superpowers/specs/2026-09-24-baton-app-in-clane.md`.

## Layout

`clane-client/**` mirrors the platform's `clane-client/` directory one-to-one, so
the move is a copy that keeps relative paths:

| Staging path | Platform path |
| --- | --- |
| `clane-client/approvals.html` | `clane-client/approvals.html` |
| `clane-client/vite.approvals.config.ts` | `clane-client/vite.approvals.config.ts` |
| `clane-client/src/approvals/**` | `clane-client/src/approvals/**` |
| `clane-client/src/ds/<Promoted>.jsx` + `.d.ts` | `clane-client/src/ds/…` (Task 2) |
| `clane-client/src/i18n/catalog.approvals.js` | `clane-client/src/i18n/catalog.approvals.js` |

## Do not copy (staging stubs)

These stand in for platform modules so the area type-checks and its specs run
here. The platform has the real ones at the same relative paths.

- `clane-client/src/lib/api.ts`, `lib/base.ts`, `lib/auth.tsx`
- `clane-client/src/i18n/index.tsx`
- `clane-client/src/ds/index.js`, `ds/index.d.ts`, `ds/StatusDot.jsx` (the promoted component files
  next to them **are** copied)

Edits to files that already exist on the platform are in `PATCHES.md`.

## Commands

```
pnpm --filter @clane-ai/baton-approvals typecheck
pnpm --filter @clane-ai/baton-approvals test      # Jest 30 + babel-jest, same config as clane-client
pnpm --filter @clane-ai/baton-approvals move -- <path to clane.ai checkout>
```

The move script (Task 9) copies everything except the stubs and prints the
`PATCHES.md` reminder. It never runs `git` in the target.
