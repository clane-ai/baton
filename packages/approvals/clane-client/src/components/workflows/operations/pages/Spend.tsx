import React from 'react';

import { useT } from '../../../../i18n';
import { Page } from '../components/page';

/** Placeholder until the screen is built (plan Task 7/8). */
export function Spend(): JSX.Element {
  const { t } = useT();
  return (
    <Page breadcrumb={t('workflow.breadcrumb')} title={t('workflow.nav.spend')}>
      {null}
    </Page>
  );
}
