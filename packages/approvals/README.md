# Workflow operational screens — staging

The operational screens of Clane's **Workflow** section (Approvals, Runs,
Documents, Activity, Spend over the Baton engine), built here and landed in the
platform client on 2026-09-24. Workflow is a top-level section at
`/app/workflow` (Runs, Documents, Activity, Spend, Definitions hosting the
studio, work items); the inbox is `ApprovalsPanel` at the top of Home, below
the command centre header.

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

`WorkflowSection` (`operations/Section.tsx`) takes `opsEnabled` (the
`workflow-ops` module), `definitions` (the studio, never gated) and `onHome`,
and mounts its own router under `SECTION_MOUNT` (`/app/workflow`). The main
client's `spaRoute` owns `/app/workflow/<section>/<sub>`; everything deeper
belongs to this router. `ApprovalsPanel` is the one inbox, on the shared
`inboxStore`: after an action the item leaves the queue at once and the person
returns to Home. All server calls go through `operations/data/api.ts` to
`/api/workflow-ops`. All copy is in `catalog.workflow.js`.

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

## Source of truth

The platform tree (`C:\git\clane.ai\clane-client`) is the source of truth for
the section (ruling of 2026-09-24). This package is the build and verification
environment only, used while this session does not write to the platform.
Every change starts here, is verified with `platform-check`, and is applied to
the platform with `move.mjs --update`. After each landing `platform-check` must
report `0 new and 0 changed files`; any other difference not made here is a
defect in staging, to be resolved from the platform copy. The end state is that
this package goes away and the section is edited in the platform directly.

## Status

- Landed in the platform on 2026-09-24 in three groups (see `PATCHES.md`),
  gated by `platform-check`: tsc 0 added, Jest 195/195, 0 warnings.
- On the dev box the operational screens and the Home panel stay hidden until
  the server runs with `WORKFLOW_OPS_AREA=true`.
- Browser verification is with another session (clane-ai-9f); interface
  defects it finds come back here.
- Design-system owner: accessible shared Tabs, Input, FilterBar, ApprovalCard
  and Drawer would let the area-local versions go.

## UAT script

Run against a platform build with `WORKFLOW_OPS_AREA=true` and a Baton engine
with at least one procure-to-pay run.

1. Home shows "Waiting for you" below the command centre header, with the
   oldest items; "Show all" opens the whole list, where `j` and `k` move.
2. The rail shows Workflow; it opens on Runs, and Definitions shows the studio.
   `/app/build/workflows/<id>` redirects to `/app/workflow/definitions/<id>`.
3. Open a purchase-order approval. The requester email, the requisition PDF
   and the business document show side by side; a document not in the
   workspace is a disabled tab marked "Not uploaded".
4. Reject is disabled until a reason is typed. Approve once; you are back on
   Home with the item gone from the queue and the confirmation shown.
5. Refresh the browser on the item's URL; the same item opens.
6. Runs lists the run. Open it: the graph, eight steps with the branches not
   taken, the workspace chip, every artefact under its own number.
7. Documents finds the purchase order by number and opens it beside the list.
8. Activity filters by run and loads older events.
9. Spend shows totals, the day chart, and the most expensive steps.
10. Switch to dark mode; every screen stays legible.
11. With `WORKFLOW_OPS_AREA` unset, Home looks as before (no panel, no gap)
    and Workflow shows only Definitions.
