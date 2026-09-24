# Workflow operational screens — staging

The operational screens of Clane's Workflow section (Approvals, Runs,
Documents, Activity, Spend over the Baton engine), staged here while the
platform worktree waits for approval. They join the workflow studio inside the
main client under `/app/build/workflows` (architect ruling, 2026-09-24). Plan:
`docs/superpowers/plans/2026-09-24-approvals-area.md`; spec:
`docs/superpowers/specs/2026-09-24-baton-app-in-clane.md`.

## Layout

`clane-client/**` mirrors the platform's `clane-client/` directory one-to-one, so
the move is a copy that keeps relative paths:

| Staging path | Platform path |
| --- | --- |
| `clane-client/src/components/workflows/operations/**` | same |
| `clane-client/src/ds/<Promoted>.jsx` + `.d.ts` | same (Task 2) |
| `clane-client/src/i18n/catalog.workflow.js` | same |

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
pnpm --filter @clane-ai/baton-approvals move -- <path to the platform worktree>
```

The move script (Task 9) copies everything except the stubs and prints the
`PATCHES.md` reminder. It never runs `git` in the target.
