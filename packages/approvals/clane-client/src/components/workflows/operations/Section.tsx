import React from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import { withBase } from '../../../lib/base';
import { useT } from '../../../i18n';
import { getStatus } from './data/api';
import { usePoll } from './data/hook';
import { SECTION_MOUNT, paths } from './paths';
import { Approvals } from './pages/Approvals';
import { Item } from './pages/Item';
import { Runs } from './pages/Runs';
import { Run } from './pages/Run';
import { Documents } from './pages/Documents';
import { Activity } from './pages/Activity';
import { Spend } from './pages/Spend';

/** How often the waiting count on the Approvals tab refreshes. */
const STATUS_POLL_MS = 15000;

function WaitingCount(): JSX.Element | null {
  const { t } = useT();
  const status = usePoll(getStatus, [], STATUS_POLL_MS);
  const n = status.data?.counts?.needs_human ?? 0;
  if (!n) return null;
  return (
    <span
      aria-label={t('workflow.nav.waiting', { n })}
      style={{
        marginLeft: 7,
        minWidth: 18,
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--orange-500)',
        color: '#fff',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      {n}
    </span>
  );
}

/**
 * The section's own navigation: one underlined tab per screen, the design
 * system's Tabs look, built on NavLink so each tab is a real link with
 * aria-current and a URL.
 */
function SectionNav(): JSX.Element {
  const { t } = useT();
  const tabs: { to: string; label: string; end?: boolean; count?: boolean }[] = [
    { to: paths.approvals(), label: t('workflow.nav.approvals'), end: true, count: true },
    { to: paths.runs(), label: t('workflow.nav.runs') },
    { to: paths.documents(), label: t('workflow.nav.documents') },
    { to: paths.activity(), label: t('workflow.nav.activity') },
    { to: paths.spend(), label: t('workflow.nav.spend') },
  ];
  return (
    <nav
      aria-label={t('workflow.nav.label')}
      style={{
        display: 'flex',
        gap: 4,
        padding: '0 22px',
        borderBottom: '1px solid var(--border-app)',
        background: 'var(--surface-card)',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          style={({ isActive }) => ({
            display: 'inline-flex',
            alignItems: 'center',
            padding: '12px 10px 10px',
            borderBottom: `2px solid ${isActive ? 'var(--blue-500)' : 'transparent'}`,
            color: isActive ? 'var(--ink)' : 'var(--text-secondary)',
            fontWeight: isActive ? 600 : 500,
            fontSize: 13.5,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          })}
        >
          {tab.label}
          {tab.count ? <WaitingCount /> : null}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The Workflow section's operational screens: approvals, runs, documents,
 * activity and spend. Rendered by the workflows page when the URL is under
 * SECTION_MOUNT. The main client routes with lib/spaRoute, which knows only
 * /app/build/workflows/<segment>; everything deeper belongs to this router.
 * The basename is derived at runtime from the injected deployment base, so the
 * same build works at /app/… and /clane/app/….
 */
export function WorkflowOperations(): JSX.Element {
  return (
    <div
      className="cl-ds"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-app)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <BrowserRouter basename={withBase(SECTION_MOUNT)}>
        <SectionNav />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/" element={<Approvals />} />
            <Route path="/items/:key" element={<Item />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:key" element={<Run />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/spend" element={<Spend />} />
            <Route path="*" element={<Navigate to={paths.approvals()} replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </div>
  );
}

export default WorkflowOperations;
