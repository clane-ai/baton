import React, { useMemo } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import { withBase } from '../../../lib/base';
import { useT } from '../../../i18n';
import { SectionContext, type SectionShell } from './context';
import { SECTION_MOUNT, paths } from './paths';
import { Item } from './pages/Item';
import { Runs } from './pages/Runs';
import { Run } from './pages/Run';
import { Documents } from './pages/Documents';
import { Activity } from './pages/Activity';
import { Spend } from './pages/Spend';
import { NothingHere } from './components/States';

/** Opt in to react-router v7 behaviour now (the platform runs 6.30, which warns otherwise). */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export type WorkflowSectionProps = {
  /**
   * The `workflow-ops` module is on (`/api/config` `modules` lists it). Only
   * the Baton-backed screens depend on it; Definitions (the studio) never does.
   */
  opsEnabled?: boolean;
  /** The workflow studio, rendered by the shell under Definitions. Ungated. */
  definitions?: React.ReactNode;
  /** Navigate to Home, where the inbox lives. */
  onHome?: () => void;
};

type Tab = { to: string; label: string };

/**
 * The section's own navigation: one underlined tab per screen, the design
 * system's Tabs look, built on NavLink so each tab is a real link with
 * aria-current and a URL.
 */
function SectionNav({ tabs }: { tabs: Tab[] }): JSX.Element {
  const { t } = useT();
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
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The Workflow section: runs, a single run, documents, activity, spend and
 * the workflow definitions (the studio). The inbox is not here; it lives on
 * Home (ApprovalsPanel). A work item opened from Home lives here, at
 * /items/<key>, and returns the person to Home after they act.
 *
 * The main client routes with lib/spaRoute (`/app/workflow/<section>/<sub>`);
 * this router owns everything under SECTION_MOUNT. The basename is derived at
 * runtime from the injected deployment base, so one build works at /app/… and
 * /clane/app/….
 */
export function WorkflowSection({ opsEnabled = true, definitions, onHome }: WorkflowSectionProps): JSX.Element {
  const { t } = useT();
  const shell = useMemo<SectionShell>(() => ({ opsEnabled, onHome }), [opsEnabled, onHome]);
  const tabs: Tab[] = [
    ...(opsEnabled
      ? [
          { to: paths.runs(), label: t('workflow.nav.runs') },
          { to: paths.documents(), label: t('workflow.nav.documents') },
          { to: paths.activity(), label: t('workflow.nav.activity') },
          { to: paths.spend(), label: t('workflow.nav.spend') },
        ]
      : []),
    { to: paths.definitions(), label: t('workflow.nav.definitions') },
  ];
  const home = opsEnabled ? paths.runs() : paths.definitions();
  const studio = definitions ?? (
    <div style={{ padding: 28 }}>
      <NothingHere title={t('workflow.definitions.missing.title')} hint={t('workflow.definitions.missing.hint')} />
    </div>
  );

  return (
    <SectionContext.Provider value={shell}>
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
        <BrowserRouter basename={withBase(SECTION_MOUNT)} future={ROUTER_FUTURE}>
          <SectionNav tabs={tabs} />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <Routes>
              <Route path="/definitions/*" element={studio} />
              {opsEnabled ? (
                <>
                  <Route path="/runs" element={<Runs />} />
                  <Route path="/runs/:key" element={<Run />} />
                  <Route path="/items/:key" element={<Item />} />
                  <Route path="/documents" element={<Documents />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/spend" element={<Spend />} />
                </>
              ) : null}
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </div>
        </BrowserRouter>
      </div>
    </SectionContext.Provider>
  );
}

export default WorkflowSection;
