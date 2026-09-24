import React from 'react';

import { useT } from '../../../../i18n';
import { Page } from '../components/page';

/** Placeholder until the screen is built (plan Task 7/8). */
export function Approvals(): JSX.Element {
  const { t } = useT();
  return (
    <Page breadcrumb={t('workflow.breadcrumb')} title={t('workflow.nav.approvals')}>
      {null}
    </Page>
  );
}
