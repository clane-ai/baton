import React from 'react';

import { Banner, Button } from '../../../../ds';
import { useT } from '../../../../i18n';

/**
 * Catches a screen that throws while rendering, so one bad engine row cannot
 * blank the whole app (rail included). The section's tab row stays, and the
 * person can try again or move to another screen. Keyed by location by the
 * caller, so navigating away clears the error.
 */
class Boundary extends React.Component<
  { title: string; body: string; retry: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Visible to whoever investigates; the screen shows plain words instead.
    console.error('[workflow] screen failed to render', error);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ padding: '24px 28px', display: 'grid', gap: 12, justifyItems: 'start' }}>
        <Banner tone="danger" title={this.props.title}>
          {this.props.body}
        </Banner>
        {/* A real button: the shared Banner's action is not keyboard-operable. */}
        <Button variant="secondary" size="sm" onClick={() => this.setState({ failed: false })}>
          {this.props.retry}
        </Button>
      </div>
    );
  }
}

export function ScreenBoundary({ children }: { children: React.ReactNode }): JSX.Element {
  const { t } = useT();
  return (
    <Boundary
      title={t('workflow.state.crash.title')}
      body={t('workflow.state.crash.body')}
      retry={t('workflow.state.error.retry')}
    >
      {children}
    </Boundary>
  );
}
