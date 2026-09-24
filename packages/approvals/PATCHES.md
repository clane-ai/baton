# Edits to existing platform files

Everything under `clane-client/**` in this package is a **new** file that copies
onto the platform branch unchanged (except the staging stubs listed in
`README.md`). This file holds the edits to files that already exist in the
platform, as diffs to apply by hand on `feat/clane-workflow-module`.

**Placement (architect ruling, 2026-09-24).** The operational screens join the
workflow studio inside the main client, nested under `/app/build/workflows`
and matched before the workflow `<id>` segment. There is no separate build, so
there is no entry HTML, Vite config, build script, dev mount, area-switcher
entry, static mount or deep-link fallback. The mount segment lives in one
constant, `SECTION_MOUNT` in `src/components/workflows/operations/paths.ts`;
the gateway agent picks its final value.

## `clane-client/src/i18n/catalog.js` — merge the area's copy

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

## `clane-client/src/ds/index.js` — promoted components

Twelve components move from `src/hr/ds/components` to `src/ds` (Task 2 of the
plan) for the Workflow screens. The hr files stay where they are for now; a follow-up can point hr at the
shared copies. Append to the barrel:

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

## `clane-client/src/lib/api.ts` — `api.blob()` for PDF documents

Text documents need nothing new: `request()` already returns non-JSON bodies
as text, so `getDocumentText` uses `api.get`. PDFs are the gap. An
`<iframe src>` cannot send the bearer token, and `api.download` saves to disk
instead of returning the bytes. The viewer needs the bytes as a Blob to show an
object URL, with the same auth, 401 refresh and error handling as `get`.
Additive, about fifteen lines, beside `download`:

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

The staging stub in this package declares the same `api.blob(path)` signature.

## `clane-client/src/components/workflows/WorkflowsPage.jsx` — mount the section

Written in Task 5 once the section component exists; the gateway agent confirms
the segment. The rule it follows: when `parseLocation()` gives
`{ route: 'build', section: 'workflows', sub: '<segment>' }`, WorkflowsPage
renders the operations section instead of treating `<segment>` as a workflow
id. Nothing in `lib/spaRoute.js` changes: the sub-segment slot already carries
it, and deeper paths are owned by the section's own router.
