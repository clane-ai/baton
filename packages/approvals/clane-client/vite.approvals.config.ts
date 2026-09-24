import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { renameSync, existsSync } from 'node:fs';

import type { Plugin } from 'vite';

// Approvals build of the clane-client workspace: the Baton engine's screens
// (inbox, work items, runs, documents, activity, spend), served under the
// /approvals module namespace. Outputs to dist-approvals/ so it never clobbers
// dist/, dist-mobile/, dist-admin/, dist-hr/, dist-studio/ or dist-projects/.
//
// Same shape as vite.hr.config.ts, and for the same reasons: `base: './'` keeps
// the artifact deployment-agnostic; the server injects `<base href>` per request
// and the router derives its basename from window.__CLANE_BASE__, so ONE build
// serves /approvals and /clane/approvals alike. The whole area is gated
// server-side by APPROVALS_AREA (or the `approvals` module licence): with the
// flag off nothing under /approvals is served, and that 404 is intended.
const APPROVALS_MOUNT = '/approvals';

const renameApprovalsHtml: Plugin = {
  name: 'rename-approvals-html',
  writeBundle() {
    const dir = resolve(__dirname, 'dist-approvals');
    const from = resolve(dir, 'approvals.html');
    const to = resolve(dir, 'index.html');
    if (existsSync(from)) renameSync(from, to);
  },
};

// Dev-only parity with production serving (see vite.hr.config.ts for the full
// account): rewrite extension-less, non-internal paths to approvals.html, and
// inject the same <base href> the server injects in production.
const serveApprovalsEntry: Plugin = {
  name: 'serve-approvals-entry',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '/').split('?')[0];
      const isInternal =
        path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/');
      const hasExtension = path.split('/').pop()?.includes('.') ?? false;
      if (!isInternal && !hasExtension) {
        req.url = '/approvals.html';
      }
      next();
    });
  },
  transformIndexHtml(html) {
    return html.replace('<head>', `<head>\n    <base href="${APPROVALS_MOUNT}/" />`);
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), serveApprovalsEntry, renameApprovalsHtml],
  build: {
    outDir: 'dist-approvals',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'approvals.html'),
    },
  },
});
