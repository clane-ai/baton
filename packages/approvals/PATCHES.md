# Edits to existing platform files

The Workflow section is a top-level section of the main client at
`/app/workflow` (rulings of 2026-09-24): Runs, Documents, Activity, Spend,
Definitions (the studio, ungated) and work items at `/items/<key>`. The inbox
is `ApprovalsPanel`, mounted on Home at the top, below the command centre
header and above the Agenda. `SECTION_MOUNT` in
`src/components/workflows/operations/paths.ts` is `/app/workflow`.

Everything under `clane-client/**` in this package is a new file that
`scripts/move.mjs` copies in; the staging stubs listed in `README.md` are never
copied. The edits below go to files that already exist on the platform. They
land as three commits, in this order, and `scripts/platform-check.mjs` is the
gate before landing.

On the dev box the section is dark until `WORKFLOW_OPS_AREA=true` is set: a
wildcard licence no longer enables an area that is still in the unlock table.
Nothing visible after landing means check that variable first.

## Group 1 — independent fixes (land first; correct on their own)

### `clane-client/src/lib/api.ts` — `api.blob()` for PDF documents

An `<iframe src>` cannot send the bearer, and `api.download` saves to disk; the
viewer needs the bytes as a Blob, with the same auth, 401 refresh and errors
as `get`.

```diff
+/** GET a response as a Blob (bearer, one refresh on 401, ApiError on failure). */
+async function blob(path: string, retryOn401 = true): Promise<Blob> {
+  const base = getApiBase();
+  const url = base ? `${base}${path}` : path;
+  const res = await fetch(url, { headers: buildHeaders({}), credentials: 'include' });
+  if (res.status === 401 && retryOn401) {
+    const fresh = await refreshToken();
+    if (fresh) return blob(path, false);
+    forceLogoutAndRedirect();
+    throw new ApiError(401, 'Unauthorized', null);
+  }
+  if (!res.ok) {
+    const body = await parseBody(res);
+    throw new ApiError(res.status, `HTTP ${res.status}`, body);
+  }
+  return res.blob();
+}
 ...
 export const api = {
   get: <T>(path: string) => request<T>(path, { method: 'GET' }),
+  /** GET a binary response as a Blob, e.g. to show a PDF from an object URL. */
+  blob,
   /** GET a binary response and save it to disk. */
   download,
```

### `clane-client/src/lib/spaRoute.js` — a replace never truncates a deeper path

On mount App.jsx normalises the URL with a *replace*. Without this guard a
hard refresh on `/app/workflow/items/TSK-0927` is cut to the section root, and
the next refresh lands elsewhere. Pushes are unchanged.

```diff
   const target = `${BASE}${seg}${trailing}`;

   // Don't push a no-op entry when the URL already matches - common
   // case is mount-time resolveInitialRoute() returned the same value
   // we got from the URL. Avoids a phantom history entry on first load.
   if (window.location.pathname === target) return;
+  // A replace (mount-time normalisation) must not truncate a deeper path
+  // owned by a nested router, e.g. /app/workflow/items/<key>.
+  if (opts.replace && window.location.pathname.startsWith(`${target}/`)) return;
```

Specs for `src/lib/__tests__/spaRoute.build.spec.js`:

```js
it('keeps a deeper nested path on a replace', () => {
  window.history.replaceState(null, '', '/app/build/skills/skill-id-42/versions/3');
  writeRouteToUrl('build', { section: 'skills', sub: 'skill-id-42', replace: true });
  expect(window.location.pathname).toBe('/app/build/skills/skill-id-42/versions/3');
});
it('still pushes the shorter address when navigating', () => {
  window.history.replaceState(null, '', '/app/build/skills/skill-id-42/versions/3');
  writeRouteToUrl('build', { section: 'skills' });
  expect(window.location.pathname).toBe('/app/build/skills');
});
```

## Group 2 — new files (additive and inert)

1. `node scripts/move.mjs <platform checkout>`: the area, the 15 promoted
   design-system components, `src/ds/index.d.ts` (types for the shared barrel;
   the build runs `tsc --noEmit`, and the untyped `.jsx` make every
   destructured prop required) and `src/i18n/catalog.workflow.js`.
2. `clane-client/src/ds/index.js`, append:

```js
// Promoted from src/hr/ds/components for the Workflow screens (2026-09).
export { Drawer } from './Drawer.jsx';
export { Timeline } from './Timeline.jsx';
export { SortableTable } from './SortableTable.jsx';
export { Chip, FilterBar } from './FilterBar.jsx';
export { DataTable } from './DataTable.jsx';
export { AuditLogRow } from './AuditLogRow.jsx';
export { ProgressBar } from './ProgressBar.jsx';
export { Toast, ToastStack } from './Toast.jsx';
export { Banner } from './Banner.jsx';
export { Breadcrumbs } from './Breadcrumbs.jsx';
export { Pagination } from './Pagination.jsx';
export { BarChart } from './BarChart.jsx';
export { ApprovalCard } from './ApprovalCard.jsx';
export { Spinner, TypingDots, Skeleton } from './Loading.jsx';
export { AppHeader } from './AppHeader.jsx';
```

3. `clane-client/src/i18n/catalog.js`, merge the copy:

```diff
 import { EXTRACTED } from './catalog.extracted.js';
+import { WORKFLOW } from './catalog.workflow.js';
 ...
-  en: { ...BASE.en, ...BATCH1.en, ...BATCH2.en, ...EXTRACTED.en },
-  de: { ...BASE.de, ...BATCH1.de, ...BATCH2.de, ...EXTRACTED.de },
-  fr: { ...BASE.fr, ...BATCH1.fr, ...BATCH2.fr, ...EXTRACTED.fr },
-  es: { ...BASE.es, ...BATCH1.es, ...BATCH2.es, ...EXTRACTED.es },
-  hi: { ...BASE.hi, ...BATCH1.hi, ...BATCH2.hi, ...EXTRACTED.hi },
+  en: { ...BASE.en, ...BATCH1.en, ...BATCH2.en, ...EXTRACTED.en, ...WORKFLOW.en },
+  de: { ...BASE.de, ...BATCH1.de, ...BATCH2.de, ...EXTRACTED.de, ...(WORKFLOW.de || {}) },
+  fr: { ...BASE.fr, ...BATCH1.fr, ...BATCH2.fr, ...EXTRACTED.fr, ...(WORKFLOW.fr || {}) },
+  es: { ...BASE.es, ...BATCH1.es, ...BATCH2.es, ...EXTRACTED.es, ...(WORKFLOW.es || {}) },
+  hi: { ...BASE.hi, ...BATCH1.hi, ...BATCH2.hi, ...EXTRACTED.hi, ...(WORKFLOW.hi || {}) },
```

## Group 3 — shell wiring (turns it on; the revertable commit)

1. **`lib/spaRoute.js`**: add `'workflow'` to `KNOWN_ROUTES`;
   `SUB_SECTIONS.workflow = ['runs', 'documents', 'activity', 'spend', 'items', 'definitions']`;
   remove `'workflows'` from `SUB_SECTIONS.build`. In `parseLocation`, before the
   build branch, alias `/app/build/workflows[/<id>]` to
   `{ route: 'workflow', section: 'definitions', sub: <id> }`: a redirect to
   one canonical address, never a second route that renders the studio.
2. **`lib/__tests__/spaRoute.build.spec.js`**: the "does the same for
   workflows" case now expects the alias. Add a spec that visits
   `/app/build/workflows/abc-123` through App's mount normalisation and asserts
   the address becomes `/app/workflow/definitions/abc-123`; the id must survive.
3. **`components/workflows/WorkflowsPage.jsx`** (lines 30, 746, 751): read the
   open id from, and write it to, `('workflow', { section: 'definitions', sub })`.
4. **`lib/config.ts`**: cache `config.modules` (authenticated payload only;
   absent before sign-in) and export `useModules()`.
5. **`App.jsx`**:
   - lazy-import `WorkflowSection` (`components/workflows/operations/Section`)
     and `ApprovalsPanel`;
   - `route === 'workflow'` renders
     `<WorkflowSection opsEnabled={modules.includes('workflow-ops')} definitions={<WorkflowStudio />} onHome={() => setRoute('home')} />`;
     delete the build `'workflows'` branch;
   - opening an item from Home: `setRoute('workflow')` writes the bare
     `/app/workflow`, which would overwrite a pushed item path. Keep a one-shot
     ref `{ section: 'items', sub: key }` that `setRoute` uses for `'workflow'`:
     `openWorkflowItem = (key) => { ref.current = { section: 'items', sub: key }; setRoute('workflow'); }`;
   - the mount normaliser writes `'workflow'` with
     `{ section: getSectionFromPath('workflow'), sub: getSubSegmentFromPath() }`,
     so the legacy alias keeps its id;
   - Home: pass
     `inbox={modules.includes('workflow-ops') ? <ApprovalsPanel onOpenItem={openWorkflowItem} /> : null}`
     to `CommandCenter`.
6. **`components/OtherRoutes.jsx` `CommandCenter`**: take an optional `inbox`
   node and render `{inbox ? <div style={{ marginBottom: 28 }}>{inbox}</div> : null}`
   directly after the `<header>` and before the Agenda `<section>`. Spec: with
   the module off, Home renders exactly as today (the header's next sibling is
   still the Agenda; no inbox region), plus an App-level case with a module list
   that lacks `workflow-ops`.
7. **`components/Shell.jsx`**: work rail entry
   `{ id: 'workflow', label: tr('shell.work.workflow'), icon: I.Share }` (ungated:
   the studio ships to everyone); add `'workflow'` to `WORK_ROUTES`; remove
   `'workflows'` from the Build rail. **`components/BuildHub.jsx`**: remove the
   workflows tile. The copy key `'shell.work.workflow'` is in `catalog.workflow.js`.

The `workflow-ops` module gates only the Baton-backed screens and the Home
panel; the studio is never gated.

## Findings for the design-system owner (no edit requested)

The shared `Tabs.jsx`, and the promoted `FilterBar.jsx` (`Chip`, whose "Clear
all" is hard-coded English), `ApprovalCard.jsx` and `Drawer.jsx`, are built from
clickable `<span>`s that a keyboard or screen reader cannot operate. `Input.jsx`
renders a `<label>` not tied to its field. `Button.jsx` primary uses a literal
`#fff`. The Workflow screens use area-local `TabBar`, `TextField`, toggle chips,
`LinkButton` and `DecisionBar`, which keep the shared look and add the
semantics.
