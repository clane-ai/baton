# Baton app inside Clane: port plan

Author: clane-baton-f6. Written 24 September 2026 after the user's decision, in their words: "i think we should
make it part of Clane AI now so that it uses Clane Design system and fonts and everything." The monday.com theme
is dropped. The M2 app in `packages/dash` becomes the reference implementation; the product is the same screens
composed from the Clane design system and mounted in the Clane platform's web client.

Authoritative design source: the `clane-design` skill at `brand-guideline-review-for-clane/Brand_SKILL.md` in
the Clane monorepo, whose files live under `dist/clane-design-system/` (tokens, 83+ components as plain React
with inline token styles, `Reference.jsx`, `ui_kits/app/ComposedWorkspace.jsx` as the canonical page recipe).
Standing rulings that bind this plan (ARCHITECTURE.md section 1): Clane vocabulary only; no third-party fonts
fetched at runtime; the terminal look is the product for the agent thread (this app is a workspace surface, not
the thread, and follows the app-shell recipe); every async surface has loading, empty and error states.

## 1. What changes and what does not

Unchanged from the signed-off M1: the information architecture (Inbox, Item, Runs, Run, Documents, Activity,
Spend), the item screen's shape (sources left, artefact as a document right, decision at the bottom, history as
a tab), the engine contract (edge function v15: inbox, documents, decision, events by run, search, next steps,
answer by task key, provenance), the fixtures.

Changed: the visual language (Clane tokens and components, Space Grotesk display, IBM Plex Sans body, IBM Plex
Mono metadata, navy ink, blue for agent/selected, one orange CTA per view, status dots as the state language,
borders over shadows, dark mode via `data-theme`), the host (the Clane web client's workspace shell instead of a
standalone Next app), and the packaging (a framework-neutral React package with adapters for routing and data,
so the same screens mount in the Clane SPA and, for development, in the Next dev server).

## 2. Package layout

New package in `clane-ai/baton`: `packages/app-ui` (name `@clane-ai/baton-app-ui`), plain React 19, TypeScript,
no Next imports, no router import, no fetch calls.

```
packages/app-ui/
  design/                      copied from the clane-design skill, unmodified
    tokens/{typography,colors,spacing}.css   (typography.css without the Google Fonts @import; see fonts)
    styles.css                 imports the three token files and the keyframes the used components need
    components/<group>/<Name>.jsx + .d.ts   only the components this app uses (list in section 4)
    fonts/                     self-hosted woff2 for Space Grotesk 600, IBM Plex Sans 400/500/600, IBM Plex Mono 400/500,
                               with @font-face in fonts.css (ruling: no third-party fonts at runtime)
  src/
    adapters.ts                Host, Link, useRoute, Api interfaces (section 5)
    lib/                       theme, money, inbox, documents, policy, drafts: moved from packages/dash/lib, unchanged, tests with them
    screens/                   Inbox, Item, Runs, Run, Documents, Activity, Spend: one file each, composed from design/components
    parts/                     the components the library lacks (section 6), each with .jsx/.tsx + .d.ts + .prompt.md
    index.ts                   exports the screens, the adapters, the theme stylesheet path
  test/                        vitest for lib/ and for the new parts (render to string, no DOM library)
```

`packages/dash` stays as the Next host during the port (its pages import the screens through a Next adapter),
then is reduced to a dev harness or removed at M4 handover, the architect's call.

## 3. Information architecture inside the Clane workspace

The Clane app shell is `248px 1fr` with a white sidebar (`NavItem`, `NavGroupLabel`, `RecentItem`), an
`AppHeader` (mono breadcrumb, Space Grotesk title, `StatusChip` pills) on every screen, and an optional 360 px
right rail when a run context is open. The Baton screens fit that shell as follows.

| M2 screen | In Clane | Sidebar | AppHeader breadcrumb · title | Right rail |
|---|---|---|---|---|
| Inbox | a workspace section "Needs you" | `NavItem` "Needs you" with a count, under the process group | `NEEDS YOU · 3 WAITING` · "What needs a decision." | none |
| Item | the same route with a key | Recents shows the last five items as `RecentItem` (dot blue = waiting, green = decided) | `RUN P2P-121 · TSK-0919` · "Purchase order PO-2026-101" | 360 px rail: `ProgressSteps` of the run with this step highlighted, `FileRow` list of the sources |
| Runs | "Runs" | `NavItem` "Runs" | `RUNS · 16` · "Every run of the process." | none |
| Run | the run route | `RecentItem` per recent run | `RUN P2P-121` · "Procure to pay" | rail: `ProgressSteps` + cost `StatusChip`s |
| Documents | "Documents" | `NavItem` | `DOCUMENTS · PURCHASE ORDERS` · "Find a document." | `Drawer` for the selected document |
| Activity | "Activity" | `NavItem` | `ACTIVITY` · "What the agents did." | none |
| Spend | "Spend" | `NavItem` | `SPEND · SEPTEMBER` · "What the work cost." | none |
| Operations (Now, Board, Flow, Attention) | not ported; the operator console stays in `packages/dash` for operators | | | |

Vocabulary: the sidebar and headers use Clane's words. "Inbox" becomes "Needs you" (the platform's phrase for
human-in-the-loop). "Task" is never shown; a Baton task is a "step" of a "run" of a "workflow". "Operator"
becomes "you". Agent names stay as they are (they are roles). No engine ids in copy; keys like `TSK-0919` appear
only as mono metadata in the breadcrumb.

Routing is the host's: the package exposes screens that take a `route` object and call `host.navigate(to)`;
the Clane client registers the routes where the architect places them. Deep links keep working because every
screen is a pure function of its route parameters.

## 4. Screen by screen: which Clane components

**Inbox ("Needs you")**
- Tiles: `StatCard` × 4 (label mono microlabel, value in Space Grotesk, `valueColor` orange when the count needs a person, green when zero).
- Filters and search: `FilterBar` with `Chip`s (dot colours: blue needs-you, red stuck, blue info) plus `SearchInput` (groups: steps, documents, runs).
- Groups and rows: `SortableTable` per group (Approvals, Parked, Questions) with columns item, run, document, counterparty, amount (mono, right), policy (a `StatusChip` per flag), waiting (mono), and an action column with a `Button` secondary "Review" / "Retry" / "Answer". `pageSize` 25, `footer` mono count.
- Empty: `EmptyState` per group ("Nothing needs you." with no action). Loading: `Skeleton` rows. Error: `Banner` danger with the API message.
- Keyboard `j`/`k`/`Enter`: kept, implemented on the table rows through the adapter's `navigate`.

**Item**
- Header: `AppHeader` (breadcrumb `RUN P2P-121 · TSK-0919`, title "Purchase order PO-2026-101", right: `StatusChip status="needsYou" pulse` "waiting 34 s", `StatusChip` "5,520.00 EUR", `StatusChip` deadline).
- Next line: `Eyebrow` sm with dot ("Next · Send PO to supplier if approved · Rework note if rejected").
- Left column: new `DocumentViewer` (section 6) inside `Card app`: `Tabs` per source, email body, PDF, text.
- Right column: `Tabs` (Document, Policy, Activity). Document tab: policy summary as `Banner` (tone success/attention/danger, one sentence), then the new `ArtefactDocument` (section 6). Policy tab: the step's spec in `CodeBlock`-style mono panel? No: prose in a `Card app` (spec text is prose, not code). Activity tab: `Timeline` (status dot per event kind, title = the sentence, meta = mono `hh:mm:ss · agent · $0.19`).
- Decision: the new `DecisionBar` (section 6) built on `ApprovalCard`'s language: for an approval, `ApprovalCard` with rows (document, counterparty, amount, policy) and Approve (orange, the one CTA) / Reject / editLabel "Save draft"; a `RichTextEditor`? No: a plain textarea part (`ReasonField`) because the library's only textarea is `InlineEdit`. For a parked step: `ErrorCard` (title "Parked after 3 of 3 attempts", message the last failure sentence, Retry primary, secondary "Raise budget…"). For a question: `Composer`-shaped `AnswerField` (single-line send) with the question in a `StatusStrip`. Decided: `ApprovalCard resolved`.
- Provenance markers: mono `Eyebrow` sm beside a field ("email · 96%") when present.

**Runs**: `StatCard` row (runs, needs you, running, done today) + `SortableTable` (run, process, status as `StatusChip`, progress as `ProgressBar` with `label` "6 / 8", cost mono, started, finished) + `Pagination`.

**Run**: `AppHeader` + `Tabs` (Steps, Artefacts, Activity). Steps: `ProgressSteps`? No, it has only done/blocked/todo. Use `Timeline` items (status from the step state, title the step label, meta `role · key · 09:19:04 · $0.19`, body the artefact numbers) with a `Button ghost` "Open". Not-taken branches as items with `attention`? No: they are neither. Use a neutral dot colour `var(--text-faint)` with meta "not taken · needed yes". Artefacts: `Accordion` of `ArtefactDocument`s. Activity: `Timeline`. Right rail: the swimlane graph as the new `RunGraph` part (ported SVG, tokens only).

**Documents**: `FilterBar` (kinds as chips with counts) + `SearchInput` + `SortableTable` (document mono, kind chip, counterparty, amount, flags, step, created) + `Drawer` (width 640) holding `ArtefactDocument` and a `Button` secondary "Open step".

**Activity**: `FilterBar` (types) + `Input`s for run, step, agent (mono) + `Switch` "show routine events" + `Timeline`; expanded payload in `CodeBlock lang="json"`. Alternative considered: `AuditLogRow` (actor, action, target, status, time) fits the audit use exactly; use `AuditLogRow` for the list and `Timeline` on the item and run tabs. Decision: `AuditLogRow` for Activity.

**Spend**: `StatCard` × 3 (total USD, credits, runs) + `BarChart` by day + `DataTable`s by run, by role, by step (mono numerics right-aligned, over-budget cells in `--red-500`).

## 5. Adapters: how the same screens mount anywhere

```ts
export type Route = { name: "inbox" | "item" | "runs" | "run" | "documents" | "activity" | "spend"; params: Record<string, string> };
export interface Host {
  route: Route;
  navigate(to: Route): void;
  Link: React.ComponentType<{ to: Route; className?: string; children: React.ReactNode }>;
  api: Api;                       // every call the screens make; the host decides proxy vs direct
  now(): number;                  // for tests
  storage: DraftStore | null;     // browser-local drafts
}
export interface Api {
  inbox(): Promise<InboxResponse>;
  task(key: string): Promise<TaskDetailResponse>;
  taskDocuments(key: string): Promise<DocumentsResponse>;
  documentUrl(path: string): string;          // where the PDF iframe points
  documentText(path: string): Promise<string>;
  runs(): Promise<WorkflowRunsResponse>;
  run(key: string): Promise<WorkflowRunResponse>;
  events(q: { workflow_run?: string; task?: string; agent?: string; type?: string; limit?: number }): Promise<EventsResponse>;
  artifacts(q: { kind?: string; task?: string }): Promise<{ ok: true; artifacts: Artifact[] }>;
  artifactsByTasks(keys: string[]): Promise<{ ok: true; artifacts: (Artifact & { task_key: string })[] }>;
  spend(): Promise<SpendResponse>;
  status(): Promise<StatusResponse>;
  decide(taskId: string, action: "approve" | "reject", reason: string | null): Promise<unknown>;
  retry(taskId: string, o: { reason?: string | null; budget_usd?: number; deadline?: string }): Promise<unknown>;
  answer(taskKey: string, body: string): Promise<unknown>;
}
```

Two hosts: `packages/dash` implements `Api` over its existing `/api/*` proxies (unchanged), and the Clane client
implements it over whatever the architect decides (server-side proxy in the platform's API with the operator
token, or a connector with a bearer token). Polling stays in the screens (a `usePoll(fn, ms)` hook over the
`Api` promise) so both hosts behave the same; if the Clane client has a query library, the adapter can wrap it
without touching the screens.

## 6. What the library lacks: parts to add

Each is a new `<Name>.jsx` (TypeScript in our package, `.jsx` copy for the library) with `.d.ts` and `.prompt.md`,
tokens only, both themes, added to `Reference.jsx` by the architect's reviewer.

| Part | Group | Why the library has no equivalent | Props (from the `.d.ts`) |
|---|---|---|---|
| `DocumentViewer` | data | nothing renders an email (headers, decoded text, attachments), a PDF or a text extract with tabs | `{ documents: { label, path, type }[]; urlOf(path): string; textOf(path): Promise<string>; active?: string; onActive?(path) }` |
| `ArtefactDocument` | data | `DataTable` shows rows, not a document with header fields, lines, totals, policy chips and per-field provenance | `{ kind: string; content: unknown; provenance?: Provenance }` |
| `FieldGrid` / `Field` | data | the two-column read-only field rhythm with a source marker slot (used by ArtefactDocument; reusable for any record view) | `{ fields: { label, value, mono?, source?, confidence? }[]; columns?: 1|2 }` |
| `DecisionBar` | chat | `ApprovalCard` has no reason field, no draft, no busy state, and no retry or answer modes | `{ mode: "approval"|"parked"|"question"|"decided"; reason; onReason; onApprove; onReject; onRetry(o); onAnswer(text); busy?; decision?; next? }` |
| `ReasonField` | forms | the only textarea is `InlineEdit`; approvals need a labelled multi-line field with a draft note | `{ label; value; onChange; placeholder?; note?; rows? }` |
| `RunGraph` | charts | no swimlane or graph component; the BPMN-style run graph is ported from M2 with token colours | `{ run: WorkflowRun }` |
| `KeyboardHint` | core | `Kbd` exists; the "j k move · Enter open" line is a composition, kept local, no library change | local |

Not added: a PDF renderer (the browser's viewer in an iframe is enough), a chart library (BarChart exists),
a data grid (SortableTable exists).

## 7. Fonts

`tokens/typography.css` imports Google Fonts. The ruling forbids a runtime fetch to a third party, so the package
ships `design/fonts/` with the woff2 files and `fonts.css` with `@font-face` for the exact weights used, and
its `styles.css` imports `fonts.css` instead of the Google line. The host loads one stylesheet. The desktop
already self-hosts two families for the same reason; the same files can be reused if the architect points at them.

## 8. Estimate and order

| Step | Work | Days |
|---|---|---|
| 1 | Package scaffold, tokens and fonts self-hosted, copy the used components, adapters, `usePoll` over `Api`, move `lib/` with tests | 1 |
| 2 | Parts: FieldGrid, ArtefactDocument (port DocumentPane), DocumentViewer (port Sources), ReasonField, DecisionBar, with `.d.ts` and `.prompt.md` | 1.5 |
| 3 | Screens: Inbox, Item | 1.5 |
| 4 | Screens: Runs, Run (RunGraph port), Documents, Activity, Spend | 1.5 |
| 5 | Next host adapter in `packages/dash` (so the fixtures and UAT script keep working); dark mode pass; loading, empty, error on every surface | 1 |
| 6 | `clane-client` host: `src/lib/baton.ts` over `api.ts`, `spaRoute` ids, `Shell.jsx` nav items, `NeedsYouRoute`/`NeedsYouDetail`/`RunsRoute`/`RunDetail`/`DocumentsRoute`/`ActivityRoute`/`SpendRoute` wrappers, Jest + RTL smoke tests per route; the `packages/api` route for the operator API (engine owner or platform team); review with the architect's reviewer; library additions submitted | 1.5 (+ review time) |

About 8 working days to UAT-ready in the Clane client, assuming the architect's placement and API-access
answers arrive by step 5. Steps 1 to 5 need no answer from the architect and start now.

## 9. The host: `clane-client`, not `packages/client`

Read-only survey of the Clane monorepo, 24 September 2026. `packages/client` there is the upstream stack's
component library (`@librechat/client`, Rollup, Radix and Tailwind, no routes, no shell); the monorepo's
`CLAUDE.md` says the legacy `/client` is being deleted and `clane-client` is "the real frontend going forward".
Nothing in `clane-client/src` imports `@librechat/client`. The port targets `clane-client`, subject to the
architect's confirmation.

What `clane-client` is, and what it means for the package:

| Fact | Consequence for `packages/app-ui` |
|---|---|
| React 18.3, Vite 5, mostly `.jsx` with some `.tsx`; `build` runs `tsc --noEmit` first; one `src/` feeds six builds (main, mobile, admin, hr, studio, projects) | the package targets React 18 and 19 (no React 19-only APIs: no `use()`, no form actions); ships TypeScript source that Vite compiles; no Next imports |
| Routing is hand-rolled: `src/lib/spaRoute.js` (`KNOWN_ROUTES`, `SUB_SECTIONS`, `/app/<route>/<sub>`, `history.pushState`) and `src/App.jsx` renders `{route === 'x' && <XRoute/>}` with lazy imports; nav items live in `src/components/Shell.jsx` (LeftRail `items`) | the `Host.route`/`navigate` adapter maps onto `spaRoute`: one route id (proposed `needs-you`, `runs`, `documents`, `activity`, `spend`) with the key as the sub-section; `XxxRoute.jsx` files per convention wrap our screens |
| Data fetching is hand-rolled `fetch` + `useState` by stated convention (`src/lib/*.ts`); `src/lib/api.ts` is a thin wrapper that sends the platform bearer, refreshes once on 401, resolves the base from `src/lib/base.ts` | the `Api` adapter is a `src/lib/baton.ts` module over `api.get/post` against a new platform route (see open question 2); no query library is introduced |
| Styling: plain CSS with tokens (`src/styles/tokens.css`, dark mode on `[data-mode="dark"]`), inline-style DS components in `src/ds/` (Button, Input, Tabs, Card, StatCard, StatusChip, StatusDot, EmptyState, Modal, Menu, Stepper, TreeView, FileRow, BadgeTile, Eyebrow, Avatar, Header), a fuller kit under `src/hr/ds/components/` with `.jsx` + `.d.ts` + `.prompt.md` (charts, ProgressBar, Toast, Banner, Drawer, Tooltip, Popover, Breadcrumbs, Tabs, Pagination, DataTable, SortableTable, Timeline, AuditLogRow, FilterBar, Segmented, Select, SearchInput, DatePicker), and Tailwind 3 mapped onto the same variables | the client already carries the skill's components; the package should import them from the client's `ds` and `hr/ds` barrels when mounted there, and from its own `design/` copy when mounted in the Next harness. Dark mode: the skill uses `data-theme="dark"`, the client `data-mode="dark"`; the package's stylesheet honours both selectors |
| Fonts are already self-hosted in `src/styles/fonts.css` (Space Grotesk, IBM Plex Sans, IBM Plex Mono among others, "no fonts.gstatic.com dependency" since May 2026) | no font files ship with the package when hosted in `clane-client`; the Next harness keeps its own self-hosted copies |
| Tests: Jest 30 with jsdom and `@testing-library/react`, co-located `__tests__/*.spec.jsx`; lint ignores `clane-client/**`, type-check only | the package's `lib/` tests stay in vitest inside `clane-ai/baton`; screen tests written for the client follow its Jest + RTL layout |
| Vocabulary: "Nexa" / "Clane" only; "Workspace" is the run sandbox and "Project" the tracked body of work | Baton runs attach to a Project; the queue is "Needs you" (the client already has `PendingApprovalsBody.jsx` and `ApprovalCard.jsx` for the same idea; ours extend, not duplicate) |
| Closest existing list + detail pattern: `ScheduleRoute.jsx` → `/app/schedule/<id>` → `ScheduleDetail.jsx`; also `AllTasksRoute.jsx`, `workspace/WorkspacePage.jsx` + `WorkspaceDetail.jsx`, `ActionsTimeline.jsx` | Inbox and Item follow the Schedule pattern: `NeedsYouRoute.jsx` (list) and `NeedsYouDetail.jsx` (item) |
| No browser-side proxy to an external API with a stored bearer exists; connector machinery is `packages/api/src/mcpProxy` and `userTools` (server-side) | the operator API is reached through a new server route in `packages/api` (proposed `/api/baton/*` forwarding to the edge function with a per-organisation operator token), never from the browser with the token |

Graph libraries present in the client (`@xyflow/react`, `elkjs`, `d3`) are not used by the port: the run
graph stays the small token-styled SVG, which needs no dependency and matches the terminal-look ruling.

## 10. Open with the architect

1. Placement: confirm `clane-client` (not `packages/client`), the route ids, the LeftRail group, and which of the
   six Vite builds carry the screens; Baton runs attach to a Project.
2. API access: a server route in `packages/api` (`/api/baton/*`) forwarding to the edge function with a
   per-organisation operator token, so identity (who approved) is the Clane user, not `operator:<name>`; the
   edge function would take the actor name from a header the platform sets.
3. Fonts: `clane-client` already self-hosts the three families; confirm the package ships none when hosted there.
4. Library additions: the six parts in section 6 go to the architect's reviewer as `.jsx` + `.d.ts` + `.prompt.md`.
5. Vocabulary: "Needs you" for the queue, "step" and "run" for tasks and workflow runs; confirm.
