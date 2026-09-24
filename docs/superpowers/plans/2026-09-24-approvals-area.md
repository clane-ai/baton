# Approvals Area (Clane client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Approvals feature area of the Clane web client (inbox, item, runs, run, documents, activity, spend) on the Clane design system, against the platform's `/api/approvals` proxy, staged in `clane-ai/baton` so it copies onto the platform branch unchanged.

**Architecture:** A separate Vite build (`approvals.html` → `src/approvals/main.tsx`) like `hr`, with React Router under `withBase('/approvals')`, a `Shell` of shared `src/ds` primitives, pages composed from `src/ds` (with twelve components promoted from `src/hr/ds`) and area-local components, a `data/api.ts` facade over `lib/api` that names every `/api/approvals` route, and `useAsync`/`usePoll`/`usePaged` hooks. Pure helpers move from `packages/dash/lib` with their tests. Staging: `packages/approvals/` in this repo mirrors `clane-client/` paths; stubs for `lib/api`, `lib/base`, `lib/auth`, `i18n` and the existing shared `ds` exports let `tsc` and vitest run here.

**Tech Stack:** React 18.3 (no React 19 APIs), react-router-dom 6, TypeScript strict (`jsx: react-jsx`, `moduleResolution: bundler`, `~/*` alias), plain `.jsx` for promoted ds components, vitest (globals on, jsdom) standing in for the platform's Jest + RTL (specs use only `describe/it/expect` globals and `@testing-library/react`, so they run under both).

**Spec:** `docs/superpowers/specs/2026-09-24-baton-app-in-clane.md` (sections 3 to 8, with the architect's six picks: separate build; promote twelve components to `src/ds`; `useAsync` + `usePoll`; `useT()` + `catalog.approvals.js`; gate `isModuleLicensed('approvals') || isEnabled(APPROVALS_AREA)`; new components area-local). Platform contract: `C:\git\clane.ai\docs\api\approvals-proxy.md` (read-only; the allowlist is copied into Task 4). Engine captures: `docs/examples/api/*.json`.

## Global Constraints

- Write only under `C:\git\clane-baton\packages\approvals\**` and `docs/**`. Never write into `C:\git\clane.ai` (read-only) until the user confirms the branch.
- Staging layout equals target layout: `packages/approvals/clane-client/<path>` is exactly `clane-client/<path>`; `PATCHES.md` lists every edit to an existing platform file as a unified diff.
- Design system: shared `src/ds` + promoted components only; tokens through `var(--…)`; no CSS files in components, no `:hover` (hover via state), no new dependencies; dark mode on `html[data-mode="dark"] .cl-ds` (the shared tokens' selector); every page subtree inside `<div className="cl-ds">`.
- Fonts: none shipped; `src/styles/fonts.css` is loaded by `main.tsx`.
- Copy: Clane vocabulary (Approvals, item, step, run, workflow, you); sentence case; mono middle-dot metadata; no emoji; every user-facing string through `t('approvals.…')` with English in `catalog.approvals.js`.
- Data: all reads through `data/api.ts` → `api.get/post` from `lib/api`; no `fetch` in components; `next_cursor` → `nextCursor` in the facade; documents by id only; no path-addressed document call anywhere.
- Every async surface: `Skeleton` while loading, `EmptyState` when empty, `Banner tone="danger"` on error, `Toast` after a decision.
- Vocabulary of states: tone map from `lib/theme.ts` → design-system status names: done→`done`, needs_human→`needsYou`, in_progress/review/blocked→`running`, failed→`failed`, ready/draft→`attention`? No: ready/draft→`var(--text-tertiary)` (neutral), cancelled→`var(--text-faint)`.
- One orange CTA per view (`Button variant="primary"`): Approve on an item; Retry on a parked item; Send on a question; none on lists.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A document with `available: false`: rendered as a disabled tab with the label and "not uploaded", never a link that streams an error (`DocumentViewer`, Task 6 test).
2. `workspace: "default"` on a run or documents list: shown as the workspace name, not as an error or "missing" (`Run` page, Task 8 test via `RunHeader` helper).
3. The proxy's 503/502/504 envelopes (`{ok:false, error:"Baton is not configured…"}`, a string, not an object): the error banner shows the string; nothing crashes on `error.message` being undefined (`data/api.ts` `errorText()`, Task 4 test).
4. Decision double-submit and empty reason: one request, "Add a reason to reject." (Task 6 `DecisionBar` spec).
5. A `next_cursor` present: "Load more" appends without duplicating rows; absent: the button is hidden (`usePaged`, Task 4 test).

---

## File structure (staging = target)

```
packages/approvals/                          staging package in clane-ai/baton
  package.json, tsconfig.json, vitest.config.ts, README.md, PATCHES.md
  stubs/                                     lib/api, lib/base, lib/auth, i18n, ds-shared (type-only + minimal impl for tests)
  clane-client/
    approvals.html
    vite.approvals.config.ts
    src/ds/                                  PROMOTED: Drawer, Timeline, SortableTable, FilterBar (+Chip), DataTable, AuditLogRow,
                                             ProgressBar, Toast (+ToastStack), Banner, Breadcrumbs, Pagination, BarChart, ApprovalCard,
                                             Loading (Spinner, TypingDots, Skeleton), AppHeader   — .jsx + .d.ts each; index.js additions in PATCHES.md
    src/i18n/catalog.approvals.js
    src/approvals/
      main.tsx  App.tsx  Shell.tsx  theme.ts  icons.tsx  format.ts
      data/{types.ts, api.ts, hook.ts}
      lib/{theme.ts, money.ts, inbox.ts, documents.ts, policy.ts, drafts.ts}
      lib/__tests__/*.spec.ts
      components/{page.tsx, FieldGrid.tsx, ArtefactDocument.tsx, DocumentViewer.tsx, ReasonField.tsx, DecisionBar.tsx, ActivityList.tsx, RunGraph.tsx, States.tsx}
      components/__tests__/{DocumentViewer.spec.tsx, DecisionBar.spec.tsx}
      pages/{Inbox.tsx, Item.tsx, Runs.tsx, Run.tsx, Documents.tsx, Activity.tsx, Spend.tsx}
      __tests__/App.spec.tsx
```

---

### Task 1: Staging package, stubs and type-check harness

**Files:**
- Create: `packages/approvals/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `PATCHES.md`
- Create: `packages/approvals/stubs/lib/api.ts`, `stubs/lib/base.ts`, `stubs/lib/auth.tsx`, `stubs/i18n/index.tsx`, `stubs/ds/index.d.ts` (+ `stubs/ds/index.js` minimal renderers for tests)
- Create: `packages/approvals/clane-client/approvals.html`, `vite.approvals.config.ts`
- Create: `packages/approvals/clane-client/src/approvals/theme.ts`, `format.ts`, `icons.tsx`

**Interfaces:**
- Produces: path aliases so that inside `clane-client/src/approvals/**` the imports `../../lib/api`, `../../lib/base`, `../../lib/auth`, `../../i18n`, `../../ds` resolve to the stubs in staging and to the real modules in the platform (same relative paths). `tsconfig.paths`: `"../../lib/api": ["../stubs/lib/api.ts"]` is not how TS paths work; instead the staging `tsconfig` sets `baseUrl: "clane-client/src"` and the stubs live at `packages/approvals/clane-client/src/{lib,i18n,ds}` **as files excluded from the move** (listed in `README.md` as "do not copy"). So relative imports are literally the target's.
- Stub contracts (match the platform): `api.get<T>(path): Promise<T>`, `api.post<T>(path, body?)`, `class ApiError extends Error { status: number; body: unknown }`, `refreshToken(): Promise<string|null>`, `withBase(path)`, `AuthProvider`, `useAuth(): { user: {id,name?,email?} | null; logout(): Promise<void> }`, `useT(): { t(key, vars?), lang, setLang }`, `I18nProvider`, and `ds` exports `Tabs, StatCard, Card, EmptyState, Button, FileRow, BadgeTile, StatusChip, StatusDot, Eyebrow, Menu, MenuItem, MenuDivider, Input, Modal, Avatar, Logo, Header` with the prop shapes from the survey.

- [ ] **Step 1: package.json** with `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@6.26.2`, dev `typescript@5`, `vitest@3`, `jsdom`, `@testing-library/react@16`, `@testing-library/jest-dom`, `@vitejs/plugin-react`; scripts `test: vitest run`, `typecheck: tsc --noEmit`.
- [ ] **Step 2: tsconfig.json** copied from the platform's (strict, `jsx: react-jsx`, `moduleResolution: bundler`, `allowJs`, `baseUrl: clane-client/src`, `paths: {"~/*": ["*"]}`), `include: ["clane-client/src"]`, `exclude` specs.
- [ ] **Step 3: vitest.config.ts**: `environment: jsdom`, `globals: true`, `setupFiles: ["./vitest.setup.ts"]` (imports `@testing-library/jest-dom/vitest`), `css: false`, include `clane-client/src/**/*.spec.{ts,tsx}`.
- [ ] **Step 4: stubs** under `clane-client/src/lib/api.ts` (in-memory `api` that throws `ApiError(404)` by default; tests replace it with `vi.mock`), `lib/base.ts` (`withBase` reading `window.__CLANE_BASE__`), `lib/auth.tsx` (context with a fixed user `{ id: 'user-1', name: 'Abhishek Jha' }`), `i18n/index.tsx` (identity `t` reading `catalog.approvals.js` en table), `ds/index.js` + `index.d.ts` (minimal but real DOM output for the 18 existing exports, tokens only, so tests can find text).
- [ ] **Step 5: approvals.html** = `hr.html` with title "Clane Approvals", storage key `clane-approvals:theme`, and `data-mode` instead of `data-theme` (the shared tokens' dark selector); script src `/src/approvals/main.tsx`.
- [ ] **Step 6: vite.approvals.config.ts** = `vite.hr.config.ts` with `/approvals`, `dist-approvals`, `approvals.html`, plugin names `serve-approvals-entry` / `rename-approvals-html`.
- [ ] **Step 7: theme.ts** (as hr's but `data-mode`, key `clane-approvals:theme`), **format.ts** (`shortDate`, `hhmmss`, `dateTime`, `count(n, one, many)`), **icons.tsx** (Lucide-style inline: Inbox, Route, FileText, Activity, CircleDollarSign, Sun, Moon, ArrowLeft, ExternalLink, Paperclip, X, Check).
- [ ] **Step 8: PATCHES.md** with the diffs for `vite.dev.config.ts` (MOUNTS entry), `package.json` (`dev:approvals` port 3096, `build:approvals`, `build:all`), `src/components/header/areas.js` (entry `{ key: 'approvals', label: 'Approvals', desc: 'Decisions waiting for you', path: '/approvals', icon: 'Check' }` plus a `hidden` filter fed by `/api/config` `modules`), `src/i18n/catalog.js` (import and spread `APPROVALS`), `src/ds/index.js` (exports), and the two `nexa-server.js` blocks for `dist-approvals` (documented for f5, not applied by us).
- [ ] **Step 9: Verify** `pnpm --filter @clane-ai/baton-approvals typecheck` passes on the empty tree and `pnpm … test` reports no tests. **Commit** `feat(approvals): staging package, stubs, entry and vite config`

---

### Task 2: Promote twelve design-system components

**Files:**
- Create: `clane-client/src/ds/{Drawer,Timeline,SortableTable,FilterBar,DataTable,AuditLogRow,ProgressBar,Toast,Banner,Breadcrumbs,Pagination,BarChart,ApprovalCard,Loading,AppHeader}.jsx` + `.d.ts`
- Modify: `PATCHES.md` (the `src/ds/index.js` export lines)
- Create: `clane-client/src/ds/__tests__/promoted.spec.tsx`

**Interfaces:** props exactly as the `.d.ts` files in `C:\git\clane.ai\clane-client\src\hr\ds\components\**` (read-only source). Imports rewritten from `'../feedback/StatusDot.jsx'` to `'./StatusDot.jsx'` (the shared one). `FilterBar.jsx` exports `Chip` and `FilterBar`; `Toast.jsx` exports `Toast` and `ToastStack`; `Loading.jsx` exports `Spinner`, `TypingDots`, `Skeleton`.

- [ ] **Step 1: Failing test**

```tsx
// clane-client/src/ds/__tests__/promoted.spec.tsx
import { render, screen } from "@testing-library/react";
import { Timeline } from "../Timeline.jsx";
import { Banner } from "../Banner.jsx";
import { FilterBar } from "../FilterBar.jsx";
import { SortableTable } from "../SortableTable.jsx";

it("renders a timeline item title and meta", () => {
  render(<Timeline items={[{ status: "done", title: "Passed its gate", meta: "09:19:04 · buyer" }]} />);
  expect(screen.getByText("Passed its gate")).toBeInTheDocument();
  expect(screen.getByText("09:19:04 · buyer")).toBeInTheDocument();
});
it("renders a danger banner with its text", () => {
  render(<Banner tone="danger" title="Baton is unreachable">Try again.</Banner>);
  expect(screen.getByText("Baton is unreachable")).toBeInTheDocument();
});
it("filter bar toggles an id", () => {
  const seen: string[][] = [];
  render(<FilterBar filters={[{ id: "a", label: "Approvals" }]} active={[]} onChange={(x) => seen.push(x)} />);
  screen.getByText("Approvals").click();
  expect(seen[0]).toEqual(["a"]);
});
it("sortable table shows rows", () => {
  render(<SortableTable columns={[{ key: "k", label: "Key" }]} rows={[{ k: "TSK-1" }]} />);
  expect(screen.getByText("TSK-1")).toBeInTheDocument();
});
```
- [ ] **Step 2: Run → FAIL (modules missing).**
- [ ] **Step 3: Copy** each `.jsx` and `.d.ts` from the hr sources with a script (`node scripts/promote.mjs` in staging reading the platform path read-only, rewriting the sibling import path), commit the script too.
- [ ] **Step 4: Run → PASS. Commit** `feat(ds): promote twelve components from hr/ds for the approvals area`

---

### Task 3: Move the pure helpers and their tests

**Files:**
- Create: `clane-client/src/approvals/lib/{theme,money,inbox,documents,policy,drafts}.ts` from `packages/dash/lib/*` (unchanged logic; `theme.ts` gains `dsStatus(state): 'done'|'needsYou'|'running'|'failed'|'attention'|string`)
- Create: `clane-client/src/approvals/lib/__tests__/*.spec.ts` from `packages/dash/lib/__tests__/*.test.ts` (imports from `vitest` removed; globals)

- [ ] **Step 1: Copy tests first**, run → FAIL. **Step 2: copy modules**, add `dsStatus` with a test (`needs_human→needsYou`, `in_progress→running`, `failed→failed`, `done→done`, `cancelled→var(--text-faint)`), run → PASS (41 + 1). **Commit** `feat(approvals): pure helpers and tests moved from the reference app`

---

### Task 4: Data layer: types, facade, hooks

**Files:**
- Create: `clane-client/src/approvals/data/types.ts` (from `packages/dash/lib/types.ts` plus `DocumentRef` v16 fields `{id, available, content_type, bytes, updated_at}`, `RunArtifact`, `Paged<T> = { items: T[]; nextCursor: string | null }`)
- Create: `data/api.ts`, `data/hook.ts`, `data/__tests__/api.spec.ts`, `data/__tests__/hook.spec.tsx`

**Interfaces (Produces):**
```ts
// data/api.ts — every platform route the area uses (docs/api/approvals-proxy.md allowlist)
export const BASE = '/api/approvals';
export function errorText(e: unknown): string;                 // ApiError body {error: string | {message}} | message
export function getInbox(cursor?: string | null, limit = 50): Promise<InboxResponse & { nextCursor: string | null }>;
export function getItem(key: string): Promise<TaskDetailResponse | undefined>;   // 404 → undefined
export function getItemDocuments(key: string): Promise<{ workspace: string; documents: DocumentRef[] }>;
export function documentUrl(key: string, id: string): string;  // withBase(`${BASE}/items/${key}/documents/${id}`)
export function getDocumentText(key: string, id: string): Promise<string>;       // fetch the stream as text via api? No: lib/api returns JSON; use a raw fetch with credentials from lib/api's request()? Platform: add `api.text(path)`? Not available. Decision: use `fetch(documentUrl(), { headers: authHeaders() })` where authHeaders comes from lib/auth-store — stubbed; recorded in PATCHES.md as "needs api.text() in lib/api or auth header helper".
export function decide(key: string, verdict: 'approve'|'reject', reason: string | null): Promise<unknown>;
export function retry(key: string, o: { reason?: string|null; budget_usd?: number; deadline?: string; reset_attempts?: boolean }): Promise<unknown>;
export function answer(key: string, body: string): Promise<unknown>;
export function getRuns(cursor?: string|null, limit = 50): Promise<{ runs: WorkflowRun[]; total?: number; nextCursor: string|null }>;
export function getRun(key: string): Promise<WorkflowRun | undefined>;
export function getRunArtifacts(key: string): Promise<{ run: string; workspace: string; artifacts: RunArtifact[] }>;
export function getEvents(q: { workflow_run?: string; task?: string; agent?: string; type?: string; limit?: number; cursor?: string|null }): Promise<{ events: StreamEvent[]; nextCursor: string|null }>;
export function getArtifacts(q: { kind?: string; task?: string }): Promise<Artifact[]>;
export function searchItems(q: { q?: string; state?: string; workflow_run?: string; cursor?: string|null; limit?: number }): Promise<{ tasks: Task[]; total: number; nextCursor: string|null }>;
export function getSpend(): Promise<SpendResponse>;
export function getStatus(): Promise<StatusResponse>;
// data/hook.ts
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): { data: T | undefined; loading: boolean; error?: Error; reload(): void };
export function usePoll<T>(load: () => Promise<T>, deps: DependencyList, ms: number): same shape + `updatedAt`;
export function usePaged<T>(loadPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, deps: DependencyList): { items: T[]; loading: boolean; error?: Error; hasMore: boolean; loadMore(): void; reload(): void };
```
- [ ] **Step 1: Tests** for `errorText` (string error, `{message}` error, plain Error), for `getInbox` mapping `next_cursor`→`nextCursor` (mock `api.get`), for `documentUrl`, for `usePaged` (two pages, no duplicates, `hasMore` false at the end) and `usePoll` (reloads on interval with fake timers).
- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN. Commit** `feat(approvals): data facade over /api/approvals and the async hooks`

---

### Task 5: Page frame, states and i18n catalogue

**Files:**
- Create: `components/page.tsx` (from hr: `Page`, `SectionTitle`, `Meta`, using the promoted `AppHeader`), `components/States.tsx` (`Loading` rows of `Skeleton`, `ErrorBanner({error})`, `NothingHere({title, hint})` on `EmptyState`), `src/i18n/catalog.approvals.js` (all keys, English), `Shell.tsx`, `App.tsx`, `main.tsx`
- Create: `__tests__/App.spec.tsx` (skeleton: mounts, `MODULE_MOUNT === '/approvals'`, base-path routing)

- [ ] **Step 1: App.spec** with the hr pattern (mock `../data/api` with the captures from `docs/examples/api` copied to `src/approvals/data/__fixtures__/*.json`), asserting the Inbox heading renders and the mount regex. RED. **Step 2:** write `App.tsx` (routes `/`, `/items/:key`, `/runs`, `/runs/:key`, `/documents`, `/activity`, `/spend`, `*`→`/`), `Shell.tsx` (sidebar with `Logo`+"Approvals", `NavItem`s with icons and the waiting count from `usePoll(getStatus)`, account menu as hr, `<div className="cl-ds">` wrapper, `<Outlet/>`), `main.tsx` (`refreshToken`, `I18nProvider`, `fonts.css`, `ds/tokens.css`), `page.tsx`, `States.tsx`, catalogue. Pages are placeholders rendering their titles for now. GREEN. **Commit** `feat(approvals): app, shell, routes, page frame, states and the catalogue`

---

### Task 6: Area components: FieldGrid, ArtefactDocument, DocumentViewer, ReasonField, DecisionBar, ActivityList, RunGraph

**Files:** `components/*.tsx` + `components/__tests__/DocumentViewer.spec.tsx`, `DecisionBar.spec.tsx`, `ArtefactDocument.spec.tsx`

- [ ] **DocumentViewer spec (RED first):** given docs `[{id:'d1', label:'Requester email', type:'email', available:true}, {id:'d2', label:'Requisition', type:'pdf', available:false}]` and `textOf` resolving an `.eml` string: the first tab shows the parsed Subject; the second tab is disabled and shows "Not uploaded"; clicking an unavailable tab does not call `textOf`.
- [ ] **DecisionBar spec (RED first):** approval mode: Reject disabled with an empty reason; typing a reason enables it; clicking Approve twice calls `onApprove` once (busy guard); after resolve the receipt shows "Approved". Parked mode shows Retry; question mode shows the question body and Send.
- [ ] **ArtefactDocument spec:** a purchase order renders PO number, both lines and the total "5,520.00 EUR"; `_provenance` on `vendor` renders "email · 96%".
- [ ] **Implement:** `FieldGrid` (two columns, mono option, source slot), `ArtefactDocument` (port of `packages/dash/components/item/DocumentPane.tsx` onto `FieldGrid`, lines table with `DataTable`, `StatusChip` for policy), `DocumentViewer` (tabs via `Tabs`; email via `parseEml`; pdf `<iframe src={url}>`; text `<pre>`; unavailable → disabled tab + `EmptyState` body "Not uploaded to the workspace"), `ReasonField` (label, textarea, helper), `DecisionBar` (port of `packages/dash/components/item/DecisionBar.tsx`: `ApprovalCard` face for approval with `editLabel` "Save draft"; `Button` primary Retry; question mode; `resolved` receipt), `ActivityList` (sentence map from `packages/dash/components/item/ActivityLog.tsx` → `Timeline` items; `showKeys`), `RunGraph` (port of `packages/dash/components/RunGraph.tsx` with token colours via `dsStatus`). GREEN. **Commit** `feat(approvals): area components with specs`

---

### Task 7: Inbox and Item pages

**Files:** `pages/Inbox.tsx`, `pages/Item.tsx`, `__tests__/App.spec.tsx` (extend)

- [ ] **Spec first:** with the inbox fixture, `/approvals` shows the tiles and a row for each item key; `/approvals/items/TSK-0919` shows the PO number heading and the decided receipt.
- [ ] **Inbox:** `Page` (breadcrumb `t('approvals.inbox.breadcrumb')`, title); `StatCard` × 4; `FilterBar` (kind chips with dots) + `Input` search; three `SortableTable`s or one `ItemTable`-like list per group built from `SortableTable` (columns item, run, document, counterparty, amount mono right, policy `StatusChip`s, waiting mono, action `Button secondary`); rows navigate on click; `usePaged(getInbox)` with "Load more"; `j/k/Enter`; states.
- [ ] **Item:** `usePoll(getItem, 8000)`, `useAsync(getItemDocuments)`, `usePoll(getInbox)` for next/next-waiting; header `Page` with `StatusChip`s; `Eyebrow` next line; two `Card`s: `DocumentViewer` left, `Tabs` right (Document with `Banner` summary + `ArtefactDocument`s; Policy prose; Activity `ActivityList`); `DecisionBar` at the card's foot; `Toast` on success; `decision.by` shown as a person: `user:<id>` → the platform user's name if it is the signed-in user (`useAuth`), else the label from the decision event payload, else "a colleague"; never the raw id.
- [ ] GREEN. **Commit** `feat(approvals): inbox and item pages`

---

### Task 8: Runs, Run, Documents, Activity, Spend pages

**Files:** `pages/Runs.tsx`, `Run.tsx`, `Documents.tsx`, `Activity.tsx`, `Spend.tsx`, spec extensions

- [ ] **Spec first:** `/approvals/runs/p2p-121` renders eight steps, two with "not taken", the workspace name, and the artefact numbers from `run-artifacts.json`; `/approvals/runs` lists the run key with a status chip.
- [ ] **Runs:** `StatCard` row; `SortableTable` (run mono, process, status `StatusChip`, progress `ProgressBar label`, cost mono, started, finished); `usePaged(getRuns)`.
- [ ] **Run:** `getRun` + `getRunArtifacts` (one call) + `getEvents({workflow_run})`; `Page` with workspace `StatusChip` ("workspace · default"); `Tabs` Steps (`Timeline` items with `Button ghost` Open; not taken as `var(--text-faint)` dots), Artefacts (`ArtefactDocument` per row, collapsible), Activity; right `Card` with `RunGraph`.
- [ ] **Documents:** `FilterBar` kinds + search; `SortableTable`; `Drawer` with `ArtefactDocument` and "Open item".
- [ ] **Activity:** filters + `AuditLogRow` list; `usePaged(getEvents)`.
- [ ] **Spend:** `StatCard` × 3, `BarChart` by day, `DataTable`s by run/role/step.
- [ ] GREEN. **Commit** `feat(approvals): runs, run, documents, activity and spend pages`

---

### Task 9: README, PATCHES, move script, final check

- [ ] `README.md`: what the package is, how to run `typecheck`/`test`, the move (`node scripts/move.mjs <clane-client path>` copies `clane-client/**` except the stub folders and prints the PATCHES to apply), what waits on f5 (server static mount, `api.text()` for document text if the platform's `lib/api` lacks it), UAT script over the fixtures.
- [ ] `scripts/move.mjs` (copies; refuses to overwrite an existing target file that differs).
- [ ] `pnpm typecheck && pnpm test` clean. **Commit** `docs(approvals): README, move script and patch list`

## UAT script (M2 exit in the platform)
1 open /approvals, see counts and rows; 2 open an approval, read email and PDF, the order and the verdict banner, approve with a reason, see the toast and the next item; 3 reject with a reason; 4 retry a parked step; 5 answer a question; 6 open a run, read steps and the graph, open a step; 7 find a PO in Documents; 8 filter Activity by run; 9 Spend by run; 10 dark mode on every page.
