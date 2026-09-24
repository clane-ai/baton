import React from 'react';

import { Banner, Button, EmptyState, Skeleton } from '../../../../ds';
import { ApiError } from '../../../../lib/api';
import { useT } from '../../../../i18n';
import { errorText } from '../data/api';

/** Placeholder rows while a list or page loads. */
export function Loading({ rows = 4 }: { rows?: number }): JSX.Element {
  const { t } = useT();
  return (
    <div role="status" aria-label={t('workflow.state.loading')} style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={44} radius={10} />
      ))}
    </div>
  );
}

/**
 * A failed load, in plain words. A 503 from the proxy means this server has no
 * engine configured, which is an admin matter rather than a transient error,
 * so it gets its own title and no retry.
 */
export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  const { t } = useT();
  const unconfigured = error instanceof ApiError && error.status === 503;
  if (unconfigured) {
    return (
      <Banner tone="attention" title={t('workflow.state.unconfigured.title')}>
        {t('workflow.state.unconfigured.body')}
      </Banner>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
      <Banner tone="danger" title={t('workflow.state.error.title')}>
        {errorText(error)}
      </Banner>
      {/* A real button: the shared Banner's action is not keyboard-operable. */}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('workflow.state.error.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** An empty list: say what would appear here, and offer the next step if there is one. */
export function NothingHere({
  title,
  hint,
  action,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}): JSX.Element {
  return <EmptyState title={title} description={hint} action={action} />;
}
