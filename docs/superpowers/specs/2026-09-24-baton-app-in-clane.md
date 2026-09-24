# Approvals area in Clane: port plan

Author: clane-baton-f6. Written 24 September 2026 after the user's decision, in their words: "i think we should
make it part of Clane AI now so that it uses Clane Design system and fonts and everything", and the Clane
architect's placement (relayed by clane-baton-ba the same evening). The M2 app in `packages/dash` is the
reference implementation; the product is the same screens as a feature area of the Clane platform's web client.

Sources read, read-only: `C:\git\clane.ai\ARCHITECTURE.md` sections 1 and 2; the `clane-design` skill at
`brand-guideline-review-for-clane/Brand_SKILL.md` and its `dist/clane-design-system` (tokens, components,
`ui_kits/app/ComposedWorkspace.jsx`); `clane-client/src/{ds,components/ui,hr,projects,studio,lib,i18n}`;
the monorepo `CLAUDE.md` frontend rules. Nothing in that repo was changed.

## 1. Placement, as the architect ruled and as the repo is built

The architect's ruling: a feature area `clane-client/src/<area>/` with its own pages, an area `ds/` only for
area-specific bits, reusing the shared `src/ds/` and `src/components/ui/`; studied against `src/hr/`,
`src/projects/`, `src/studio/`; Clane vocabulary; mounted into the existing workspace shell; feature-flagged;
localised; React Query for data; ARIA and cursor pagination on the lists; the client never holds the operator
token; a Baton module in `packages/api` proxies the operator API with the platform session user as actor.

What the three template areas actually are (survey of 24 September):

| The ruling says | The repo does | This plan follows |
|---|---|---|
| "mount into the existing workspace shell and side-rail nav the way hr/projects/studio do" | hr, projects and studio are **separate Vite builds** (`hr.html`, `vite.hr.config.ts`, `dev:hr` on its own port, `dist-hr`), served by `api/server/nexa-server.js` under `/hr`, `/projects`, `/studio`, with their own `Shell.tsx` (React Router `BrowserRouter basename={withBase(MODULE_MOUNT)}`, `NavItem`s, `<Outlet/>`), and reached from the main SPA through the area switcher in `src/components/header/areas.js`. None of them has a `KNOWN_ROUTES` entry, an `App.jsx` branch or a LeftRail item. | the same: a separate build `approvals.html` + `vite.approvals.config.ts`, `src/approvals/` with `App.tsx`, `Shell.tsx`, `main.tsx`, an `AREAS` entry `{ key: 'approvals', label: 'Approvals', desc: 'Decisions waiting for you', path: '/approvals' }`, server mount in `nexa-server.js` beside `/hr`. If the architect meant the main SPA's LeftRail instead, the pages are the same and only `App.tsx`/`Shell.tsx` change to `spaRoute` entries; say which. |
| "reuse `src/ds/` and `src/components/ui/`" | the shared `src/ds` has 19 components (Tabs, StatCard, Card, EmptyState, Button, FileRow, BadgeTile, StatusChip, StatusDot, Eyebrow, Menu/MenuItem/MenuDivider, TreeView, Stepper, Input, Modal, Avatar, Logo, Header, Footer); `src/components/ui` has PageHeader, Button, NavItem, StatusDot/Pill/Badge, Eyebrow, Chip/FileChip/RefChip, Avatar, CodeBlock, ProgressStepper, QuickReply, Card/SectionHeading, BrandMark, Logo, and `Select.jsx` (Radix, not in the barrel); `components/table/ItemTable.jsx` (sortable, `onRowClick`, `ariaLabel`) and `components/detailUi.jsx` (StatTile, DetailTabs with `role="tablist"`). The fuller kit (Drawer, Timeline, SortableTable, FilterBar, DataTable, AuditLogRow, ProgressBar, Toast, Banner, Breadcrumbs, Pagination, BarChart, ApprovalCard) exists only as **per-area vendored copies** under `src/hr/ds/components`, `src/projects/ds`, `src/studio/ds`, already diverged from each other, with no barrel, alias or package export. | reuse the shared sets first; for Drawer, Timeline, FilterBar, DataTable/SortableTable, AuditLogRow, ProgressBar, Banner, Toast, Pagination, BarChart take the `hr/ds` copies into `src/approvals/ds/components/` the way hr and projects did (that is the repo's pattern, however unlovely), and ask the architect whether these ten should be promoted to `src/ds` instead: promoting them is one afternoon and stops the fourth divergence. |
| "React Query for data" | `@tanstack/react-query` is **not installed** in `clane-client`; every area uses a hand-rolled `useAsync(load, deps) -> {data, loading, error}` (`src/hr/data/hook.ts`, `src/projects/data/hook.ts`) over `src/lib/api.ts` (`api.get/post`, bearer from `auth-store`, one refresh on 401, base from `lib/base.ts`); the root `CLAUDE.md` React Query line applies to the legacy `client/`. | `src/approvals/data/hook.ts` with the same `useAsync` shape plus `usePoll(load, deps, ms)` for the live screens; `src/approvals/data/api.ts` as the one file that names the platform routes. If the architect wants React Query added to `clane-client`, the hook is the only file that changes. |
| "localisation through the platform i18n and useLocalize with English keys" | `useLocalize` does not exist in `clane-client`; the main SPA uses `useT()` from `src/i18n/index.jsx` with a flat dotted catalogue (`src/i18n/catalog.js`, `en` as source, `{{var}}` placeholders, `components_<File>.<key>` naming), and `I18nProvider` is mounted only in `src/main.tsx`; hr, projects and studio hard-code English. | mount `I18nProvider` in `src/approvals/main.tsx` and use `useT()`; keys under `approvals.*` in a new `src/i18n/catalog.approvals.js` merged into the catalogue (English only; other languages fall back). This makes approvals the first area that is localised, which the architect should confirm is wanted. |
| "feature-flag the area with the repo's isEnabled()-style pattern" | `isEnabled` in `packages/api/src/utils/common.ts` parses env strings; there is **no client flag system**; areas are gated server-side by licensing (`license.isModuleLicensed('studio')` guards the static mount and the HTML fallback in `nexa-server.js`), and `buildAreaMenu` filters only `adminOnly`. | gate server-side: `isModuleLicensed('approvals') || isEnabled(process.env.APPROVALS_AREA)` on the mount and on the `/api/approvals/*` routes; client-side hide the switcher entry when `/api/config` does not list the module (one new field, `modules: string[]`, in `lib/config.ts`). Flag name `APPROVALS_AREA`; licence module `approvals`. |
| "ARIA and cursor pagination per the frontend rules" | the rule (`CLAUDE.md` L254) is cursor pagination; the one live consumer (`src/lib/webhooks.ts`) uses `?cursor=` in and `nextCursor` out with a "Load more" button; nobody uses a Pagination component. `ItemTable` and `DetailTabs` carry ARIA roles; `ds/Tabs`, `Menu`, `StatusChip`, `NavItem` do not. | the inbox and runs lists use `?cursor=`/`nextCursor` (engine adds it, see section 6) with "Load more"; tables through `ItemTable` (`ariaLabel`, `onRowClick`), tabs through `DetailTabs`; own roles on anything composed by hand. |
| "the client never holds the operator token" | true today: `src/lib/api.ts` sends the platform bearer only; `packages/api/src/mcpProxy` and `userTools` hold connector tokens server-side. | all data through `/api/approvals/*` on `packages/api` (section 6); the actor is `req.user`. |

The terminal-look ruling is, per the architect, for the desktop CLI only; these are web screens on the web design
system.

## 2. What survives from M2 unchanged

The information architecture, the item screen's shape, the engine contract (v15 plus cursor), the pure helpers
(`theme`, `money`, `inbox`, `documents`, `policy`, `drafts`, `inboxFallback` minus the fallback itself) with
their 41 tests, the artefact-as-document renderers, the email parser, the UAT script over p2p-101..122. The
Next app in `packages/dash` stays as the engine owner's operator console and as the reference until M4.

## 3. Area layout

```
clane-client/
  approvals.html                          entry (copy of hr.html: theme pre-paint keyed on clane-approvals:theme)
  vite.approvals.config.ts                copy of vite.hr.config.ts with /approvals, dist-approvals
  vite.dev.config.ts                      MOUNTS += { prefix: '/approvals', html: '/approvals.html' }
  package.json                            dev:approvals (port 3094), build:approvals, build:all chain
  src/components/header/areas.js          AREAS += approvals entry (hidden when the module is not enabled)
  src/i18n/catalog.approvals.js           approvals.* keys, English
  src/approvals/
    main.tsx                              refreshToken(), I18nProvider, createRoot(<App/>)
    App.tsx                               MODULE_MOUNT = '/approvals'; BrowserRouter; routes (section 4)
    Shell.tsx                             ds Header + primaryNav NavItems + <Outlet/>; theme toggle as hr
    theme.ts, icons.tsx, format.ts        as hr
    data/api.ts                           the platform routes, typed; the only place URLs live
    data/hook.ts                          useAsync, usePoll
    data/types.ts                         InboxItem, TaskDetail, Run, Artifact, DocumentRef, Decision… (moved from packages/dash/lib/types.ts)
    lib/                                  theme, money, inbox, documents, policy, drafts (moved; tests moved to __tests__ as *.spec.ts under Jest)
    ds/components/{overlay,data,forms,feedback,charts}/   the ten vendored kit pieces (or imports from src/ds if promoted)
    components/
      page.tsx                            Page, SectionTitle, Meta (as hr)
      DocumentViewer.tsx                  new (section 5)
      ArtefactDocument.tsx, FieldGrid.tsx new
      DecisionBar.tsx, ReasonField.tsx    new
      ActivityList.tsx                    Timeline/AuditLogRow wrapper with the sentence map
      RunGraph.tsx                        ported SVG, tokens only
    pages/
      Inbox.tsx, Item.tsx, Runs.tsx, Run.tsx, Documents.tsx, Activity.tsx, Spend.tsx
    __tests__/App.spec.tsx                as hr: mock data/api, pushState, render, assert MODULE_MOUNT
```

## 4. Pages and routes

`App.tsx` routes under `withBase('/approvals')`:

| Route | Page | Header (`Page breadcrumb title actions`) | Nav |
|---|---|---|---|
| `/` | Inbox | `APPROVALS · 3 WAITING` · "What needs a decision." · Refresh | Approvals (count) |
| `/items/:key` | Item | `RUN P2P-121 · TSK-0919` · "Purchase order PO-2026-101" · (none: the decision bar holds the CTA) | |
| `/runs` | Runs | `RUNS · 16` · "Every run of the process." | Runs |
| `/runs/:key` | Run | `RUN P2P-121` · "Procure to pay" | |
| `/documents` | Documents | `DOCUMENTS` · "Find a document." | Documents |
| `/activity` | Activity | `ACTIVITY` · "What the agents did." | Activity |
| `/spend` | Spend | `SPEND` · "What the work cost." | Spend |

Copy is Clane's: "Approvals" for the queue, "step" and "run" for tasks and workflow runs, "you" for the
operator, agent role names as they are, engine keys only as mono metadata. Every string goes through
`t('approvals.<page>.<key>')`.

Components per page (shared first, area `ds/` second, new third):

- **Inbox**: `StatCard` × 4; `FilterBar` (area ds) with status-dot chips; `Input` as search; three `ItemTable`s
  (Approvals, Parked, Questions) with columns item, run, document, counterparty, amount (mono right), policy
  (`StatusPill` per flag), waiting (mono), action (`Button` secondary); `EmptyState` per group; `Skeleton`
  rows while loading; `Banner` danger on error; "Load more" from `nextCursor`; `j`/`k`/`Enter`.
- **Item**: `Page` header with `StatusPill`s (waiting, amount, deadline); `Eyebrow` "Next · …"; left `Card`
  with `DocumentViewer`; right `Card` with `DetailTabs` (Document, Policy, Activity): `Banner` (tone from
  `policySummary`) + `ArtefactDocument`; spec prose; `ActivityList`; `DecisionBar` fixed at the bottom of the
  card (`ApprovalCard` from the area ds for the approve/reject face, extended with `ReasonField`, draft note,
  busy state; `ErrorCard`-style Retry for parked; a send row for questions; the resolved receipt when decided).
- **Runs**: `StatCard` row; `ItemTable` with `StatusPill` and `ProgressBar` cells; "Load more".
- **Run**: `DetailTabs` (Steps, Artefacts, Activity): `Timeline` items with `Button` ghost "Open"; `Accordion`
  of `ArtefactDocument`; `ActivityList`; right column `RunGraph`.
- **Documents**: `FilterBar` (kinds) + search + `ItemTable`; `Drawer` (area ds, width 640) with `ArtefactDocument`.
- **Activity**: filters + `AuditLogRow` list; expanded payload in `CodeBlock`.
- **Spend**: `StatCard` × 3; `BarChart` by day; `DataTable`s by run, role, step.

Loading, empty and error states on every page from `Skeleton`, `EmptyState`, `Banner`; toasts through the
area's `Toast` for decisions ("Approved." / "Rejected." / "Back in the queue.").

## 5. What must be added, with a note each

For `src/components/ui/` (shared, since nothing area-specific is in them) or, if the architect prefers, the
area's `components/`:

| Addition | Note |
|---|---|
| `DocumentViewer` | tabs over a list of `{label, path, type}`; email (headers, decoded text, attachment chips) via the ported parser, PDF in an iframe from a URL the data layer provides, text in a mono panel; per-tab error text; nothing in the kit shows a source document. |
| `FieldGrid` | two-column labelled read-only values with an optional mono source marker and confidence; the kit's `DataTable` shows rows, not a record. Reusable for any record view. |
| `ArtefactDocument` | one renderer per artefact kind (purchase order, goods receipt, invoice, delivery note, three-way match, payment, review, handoff; key/value fallback) built on `FieldGrid` + a lines table with totals + `StatusPill` policy chips; reads `_provenance` when present. |
| `ReasonField` | a labelled multi-line field with a helper line ("Draft saved" / "Add a reason to reject"); the only textarea in the kit is `InlineEdit`. |
| `DecisionBar` | the four modes (approval, parked, question, decided) with one orange CTA, busy and done states, local drafts; wraps the area ds `ApprovalCard` rather than duplicating its face. |
| `RunGraph` | swimlane SVG per role with gateway diamonds; tokens only; no graph library (the client has `@xyflow`, `elkjs`, `d3`, none needed for eight nodes). |

Promotion candidates from `hr/ds` to `src/ds` (decision for the architect, not required for the port):
Drawer, Timeline, SortableTable, FilterBar, DataTable, AuditLogRow, ProgressBar, Toast, Banner, Pagination,
BarChart, ApprovalCard.

## 6. `packages/api` routes the client expects

Owner f5. A `packages/api/src/approvals/` module holding the operator token per organisation the way `mcpProxy`
holds connector tokens, forwarding to Baton's edge function and adding `X-Baton-Actor: <req.user display name>`
(the edge function records it as the decision's `by`). All behind `requireAuth` and the `approvals` gate.

| Client call (`src/approvals/data/api.ts`) | Platform route | Forwards to |
|---|---|---|
| `getInbox(cursor?)` | `GET /api/approvals/inbox?cursor=&limit=` | `GET /admin/inbox` |
| `getItem(key)` | `GET /api/approvals/items/:key` | `GET /admin/tasks/:key` |
| `getItemDocuments(key)` | `GET /api/approvals/items/:key/documents` | `GET /admin/tasks/:key/documents` |
| `documentUrl(path)`, `getDocumentText(path)` | `GET /api/approvals/documents?path=` | the run workspace (the platform's workspace file service, or a Baton document route the engine owner adds; the Next app's `/api/workspace` guard is the reference) |
| `decide(key, verdict, reason)` | `POST /api/approvals/items/:key/decision` | `POST /admin/tasks/:key/approve` |
| `retry(key, o)` | `POST /api/approvals/items/:key/retry` | `POST /admin/tasks/:key/retry` |
| `answer(key, body)` | `POST /api/approvals/items/:key/answer` | `POST /admin/answer {task_key}` |
| `getRuns(cursor?)`, `getRun(key)` | `GET /api/approvals/runs`, `GET /api/approvals/runs/:key` | `/admin/workflow-runs`, `/admin/workflow-runs/:key` |
| `getRunArtifacts(key)` | `GET /api/approvals/runs/:key/artifacts` | new engine route artefacts-by-run (until then the proxy fans out task details) |
| `getEvents(q)` | `GET /api/approvals/events?workflow_run=&task=&agent=&type=&cursor=` | `GET /admin/events` |
| `getArtifacts(q)` | `GET /api/approvals/artifacts?kind=&task=&q=` | `GET /admin/artifacts`, `GET /admin/tasks?q=` |
| `getSpend()` | `GET /api/approvals/spend` | `GET /admin/spend` |
| `getStatus()` | `GET /api/approvals/status` | `GET /admin/status` |

Cursor: engine-side, opaque, `cursor` in and `next_cursor` out on `/admin/inbox`, `/admin/tasks`,
`/admin/workflow-runs` and `/admin/events`; the platform route renames nothing except the JSON field to
`nextCursor` to match the client's one existing consumer.

Until the routes exist, `data/api.ts` can point at the Next app's `/api/*` with a base-URL switch, so pages
can be built and tested against the fixtures now.

## 7. Estimate and order

| Step | Work | Days |
|---|---|---|
| 1 | Area scaffold: entry, Vite config, mounts, `AREAS` entry, server mount and gate, `Shell`, `App`, `main`, i18n provider and key file, `data/hook.ts`, `data/api.ts` against the Next app | 1 |
| 2 | Move `lib/` and its tests to Jest; vendored kit pieces into `ds/components`; `FieldGrid`, `ArtefactDocument`, `DocumentViewer`, `ReasonField`, `DecisionBar` with specs | 2 |
| 3 | Inbox and Item pages, keyboard, states, `App.spec.tsx` | 1.5 |
| 4 | Runs, Run (`RunGraph`), Documents, Activity, Spend | 1.5 |
| 5 | Switch `data/api.ts` to `/api/approvals/*` when f5 ships them; actor header; dark mode pass; UAT script rerun on the fixtures | 1 |
| 6 | Fit review with the architect (clane-ai-30), fixes; promotion of kit pieces if agreed | 1 (+ review) |

About 8 working days to UAT-ready, on a branch in `clane-ai/clane-platform` (`feature/approvals-area`, name
to be confirmed by the user), PRs reviewed by clane-ai-30 for fit and f5 for the API module. Steps 1 to 4 start
as soon as write access on the branch is confirmed; they do not wait for the API module.

## 8. Decisions requested from the architect

1. Separate build under `/approvals` (the hr pattern, as surveyed) or routes inside the main SPA (as the ruling's
   wording suggests)? The pages are the same either way.
2. Promote the ten kit pieces from `hr/ds` to `src/ds`, or vendor a fourth copy into `src/approvals/ds`?
3. Data layer: keep the repo's `useAsync` pattern, or add React Query to `clane-client` for this area?
4. i18n: mount `I18nProvider` in the area (first localised area) with `useT()`, or hard-code English like hr?
5. Gate: `isModuleLicensed('approvals')` plus `APPROVALS_AREA` env, exposed as `modules[]` in `/api/config`?
6. Where the new components live: `src/components/ui/` (shared) or `src/approvals/components/`?
