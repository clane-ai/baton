# Workflow operational screens — staging

The operational screens of Clane's **Workflow** section (Approvals, Runs,
Documents, Activity, Spend over the Baton engine), built here and handed to the
platform client's owner to move in. They join the
workflow studio inside the main client under `/app/build/workflows`
(architect ruling, 2026-09-24).

- Plan: `docs/superpowers/plans/2026-09-24-approvals-area.md`
- Spec: `docs/superpowers/specs/2026-09-24-baton-app-in-clane.md`
- Proxy contract (platform): `docs/api/workflow-ops-proxy.md` in the platform repo
- Edits to existing platform files: `PATCHES.md`

## Layout

`clane-client/**` mirrors the platform's `clane-client/` directory, so the move
keeps every relative path.

| Staging path | Moved to the platform |
| --- | --- |
| `clane-client/src/components/workflows/operations/**` | yes, the whole area |
| `clane-client/src/ds/<Promoted>.jsx` + `.d.ts` (15 components) | yes |
| `clane-client/src/ds/index.d.ts` | yes, new types for the shared barrel |
| `clane-client/src/i18n/catalog.workflow.js` | yes |
| `clane-client/src/lib/{api,base,auth}`, `src/i18n/index.tsx` | no, stubs |
| `clane-client/src/ds/index.js` and the verbatim shared components | no, stubs |

The stubs behave like the platform's own modules: the shared components are
verbatim copies, `useT()` echoes keys outside `I18nProvider`, `useAuth()` throws
outside `AuthProvider`. So a spec that passes here passes there.

## The section

`WorkflowOperations` (`operations/Section.tsx`) mounts its own router under
`SECTION_MOUNT` (`operations/paths.ts`, the one placement constant) with a tab
row for the five screens. The main client's `spaRoute` knows only
`/app/build/workflows/<segment>`; everything deeper belongs to this router.
All server calls go through `operations/data/api.ts` to `/api/workflow-ops`.
All copy is in `catalog.workflow.js` under `workflow.*`.

## Commands

```
pnpm --filter @clane-ai/baton-approvals typecheck
pnpm --filter @clane-ai/baton-approvals test            # Jest 30 + babel-jest, same config as clane-client
pnpm --filter @clane-ai/baton-approvals test:scripts    # move script tests
pnpm --filter @clane-ai/baton-approvals platform-check -- C:/git/clane.ai
pnpm --filter @clane-ai/baton-approvals move -- <platform worktree>
```

`platform-check` is read-only on the platform checkout. It copies the client
source to a temporary folder, moves the area in, applies the code edits from
`PATCHES.md`, and runs the platform's own `tsc` and Jest there. It passes when
the area adds no type error and every spec passes with no React warning.
Last run, 2026-09-24:

| Check | Result |
| --- | --- |
| `tsc --noEmit` errors, before and after | 8 and 8, none added (the 8 exist on main) |
| Jest suites and tests | 24 of 24, 161 of 161 |
| React warnings | 0 |

`move` copies the allowlist above into a platform checkout. It stops before
writing anything if a target file exists with different content, and it never
runs git. Stage and commit by explicit path afterwards.

## Waiting on others

- **No platform work from this session.** The user ruled on 2026-09-24 that
  this work stays out of `C:\git\clane.ai` entirely, worktrees included. The
  platform's client owner moves it with `scripts/move.mjs` and applies
  `PATCHES.md`; `platform-check` only reads the checkout and writes to a
  temporary folder.
- **Gateway agent (clane-ai-f5).** The final `SECTION_MOUNT` segment; the
  WorkflowsPage mount and `/api/config` `modules` check; `api.blob()` in
  `lib/api.ts`; the `spaRoute` replace guard for deep links. All in
  `PATCHES.md`.
- **Design-system owner.** Accessible shared Tabs, Input, FilterBar,
  ApprovalCard and Drawer would let the area-local versions go.

## UAT script

Run against a platform build with `WORKFLOW_OPS_AREA=true` and a Baton engine
with at least one procure-to-pay run.

1. Open Build, Workflows, then Approvals. The tab row shows the waiting count.
2. Approvals lists decisions, parked steps and questions. Search narrows it;
   `j`, `k` and `Enter` move and open.
3. Open a purchase-order approval. The requester email, the requisition PDF
   and the business document show side by side; a document not in the
   workspace is a disabled tab marked "Not uploaded".
4. Reject is disabled until a reason is typed. Approve once; the receipt names
   the next step and offers the next waiting item.
5. Refresh the browser on the item's URL; the same item opens.
6. Runs lists the run. Open it: the graph, eight steps with the branches not
   taken, the workspace chip, every artefact under its own number.
7. Documents finds the purchase order by number and opens it beside the list.
8. Activity filters by run and loads older events.
9. Spend shows totals, the day chart, and the most expensive steps.
10. Switch to dark mode; every screen stays legible.
11. With `WORKFLOW_OPS_AREA` unset, the Approvals entry is absent and the
    section URL does not open.
