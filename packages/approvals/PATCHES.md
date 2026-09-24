# Edits to existing platform files

Everything under `clane-client/**` in this package is a **new** file that copies
onto the platform branch unchanged (except the staging stubs listed in
`README.md`). This file holds the edits to files that already exist in
`C:\git\clane.ai`, as diffs to apply by hand on the feature branch. Nothing here
has been applied yet; `nexa-server.js` is listed for completeness only and is
not ours to change.

## `clane-client/vite.dev.config.ts` — mount for the dev proxy

```diff
 const MOUNTS: { prefix: string; html: string }[] = [
   { prefix: '/m', html: '/mobile.html' },
   { prefix: '/platform', html: '/admin.html' },
   { prefix: '/hr', html: '/hr.html' },
   { prefix: '/studio', html: '/studio.html' },
   { prefix: '/projects', html: '/projects.html' },
+  { prefix: '/approvals', html: '/approvals.html' },
   { prefix: '/app', html: '/index.html' },
```

## `clane-client/package.json` — scripts

`build:approvals` is the name the server's warning points at
(`run \`cd clane-client && npm run build:approvals\``), so it must exist under
exactly that name. Port 3096 follows hr 3093, studio 3094, projects 3095.

```diff
     "dev:projects": "vite --config vite.projects.config.ts --port 3095",
+    "dev:approvals": "vite --config vite.approvals.config.ts --port 3096",
 ...
     "build:projects": "tsc --noEmit && vite build --config vite.projects.config.ts",
+    "build:approvals": "tsc --noEmit && vite build --config vite.approvals.config.ts",
-    "build:all": "tsc --noEmit && vite build && vite build --config vite.mobile.config.ts && vite build --config vite.admin.config.ts && vite build --config vite.hr.config.ts && vite build --config vite.studio.config.ts && vite build --config vite.projects.config.ts",
+    "build:all": "tsc --noEmit && vite build && vite build --config vite.mobile.config.ts && vite build --config vite.admin.config.ts && vite build --config vite.hr.config.ts && vite build --config vite.studio.config.ts && vite build --config vite.projects.config.ts && vite build --config vite.approvals.config.ts",
```

Build output is `clane-client/dist-approvals` (set in
`vite.approvals.config.ts`), which is the directory the server already mounts.

## `clane-client/src/components/header/areas.js` — switcher entry

The entry sits between Hire and Studio. It is hidden when the area is off
(`APPROVALS_AREA` false and no `approvals` module licence), so a user never sees
a link to a 404. The switcher learns that from `/api/config`, which today does
not say which modules are on; the smallest addition is a `modules` array on the
config payload (`api/server/routes/config.js`, owner f5) that lists the enabled
optional areas, e.g. `modules: ['approvals']`. Until that lands, `hidden`
defaults to true for `approvals` so the entry stays out of the menu.

```diff
   { key: 'hr', label: 'Hire', desc: 'Recruitment', path: '/hr', icon: 'Users' },
+  {
+    key: 'approvals',
+    label: 'Approvals',
+    desc: 'Decisions waiting for you',
+    path: '/approvals',
+    icon: 'Check',
+    module: 'approvals',
+  },
   { key: 'studio', label: 'Studio', desc: 'Skills & tools', path: '/studio', icon: 'Beaker' },
 ...
-// Pure: resolve the visible areas and mark the current one. `base` is the
-// deployment sub-path prefix (appBase()); `pathname` is window.location.pathname.
-export function buildAreaMenu({ pathname, base = '', isAdmin = false }) {
-  return AREAS.filter((a) => !a.adminOnly || isAdmin).map((a) => {
+// Pure: resolve the visible areas and mark the current one. `base` is the
+// deployment sub-path prefix (appBase()); `pathname` is window.location.pathname;
+// `modules` is the list of enabled optional areas from /api/config — an area
+// that names a `module` is shown only when that module is enabled.
+export function buildAreaMenu({ pathname, base = '', isAdmin = false, modules = [] }) {
+  return AREAS.filter((a) => !a.adminOnly || isAdmin)
+    .filter((a) => !a.module || modules.includes(a.module))
+    .map((a) => {
```

`AreaSwitcher.jsx` passes `modules` from the cached config (`src/lib/config.ts`
gains a `cachedModules` alongside `cachedLicense`, read from `config.modules`).
Add to `__tests__/areas.spec.js`:

```js
it('hides a module-gated area unless the module is enabled', () => {
  const off = buildAreaMenu({ pathname: '/app', isAdmin: false });
  expect(off.some((r) => r.key === 'approvals')).toBe(false);
  const on = buildAreaMenu({ pathname: '/app', isAdmin: false, modules: ['approvals'] });
  expect(on.some((r) => r.key === 'approvals')).toBe(true);
});
```

`Check` already exists in `src/components/Icons.jsx`.

## `clane-client/src/i18n/catalog.js` — merge the area's copy

```diff
 import { EXTRACTED } from './catalog.extracted.js';
+import { APPROVALS } from './catalog.approvals.js';
 ...
-  en: { ...BASE.en, ...BATCH1.en, ...BATCH2.en, ...EXTRACTED.en },
-  de: { ...BASE.de, ...BATCH1.de, ...BATCH2.de, ...EXTRACTED.de },
-  fr: { ...BASE.fr, ...BATCH1.fr, ...BATCH2.fr, ...EXTRACTED.fr },
-  es: { ...BASE.es, ...BATCH1.es, ...BATCH2.es, ...EXTRACTED.es },
-  hi: { ...BASE.hi, ...BATCH1.hi, ...BATCH2.hi, ...EXTRACTED.hi },
+  en: { ...BASE.en, ...BATCH1.en, ...BATCH2.en, ...EXTRACTED.en, ...APPROVALS.en },
+  de: { ...BASE.de, ...BATCH1.de, ...BATCH2.de, ...EXTRACTED.de, ...(APPROVALS.de || {}) },
+  fr: { ...BASE.fr, ...BATCH1.fr, ...BATCH2.fr, ...EXTRACTED.fr, ...(APPROVALS.fr || {}) },
+  es: { ...BASE.es, ...BATCH1.es, ...BATCH2.es, ...EXTRACTED.es, ...(APPROVALS.es || {}) },
+  hi: { ...BASE.hi, ...BATCH1.hi, ...BATCH2.hi, ...EXTRACTED.hi, ...(APPROVALS.hi || {}) },
```

## `clane-client/src/ds/index.js` — promoted components

Twelve components move from `src/hr/ds/components` to `src/ds` (Task 2 of the
plan). The hr files stay where they are for now; a follow-up can point hr at the
shared copies. Append to the barrel:

```js
// Promoted from src/hr/ds/components for the Approvals area (2026-09).
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

## `api/server/nexa-server.js` — already in place (not ours)

Verified on 2026-09-24 (read-only): the server resolves
`clane-client/dist-approvals` (line 487), computes
`approvalsEnabled = license.isModuleLicensed('approvals') || isEnabled(process.env.APPROVALS_AREA)`
(line 510), mounts `/approvals` with `staticCache` when the build exists and the
gate is on, and warns with the `build:approvals` hint otherwise. The HTML
fallback with `injectBase` for deep links is the proxy owner's; the `/api/approvals`
router is mounted behind the same gate. Nothing to apply from this package.
