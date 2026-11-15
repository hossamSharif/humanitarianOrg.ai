'use client';

import { useTranslations } from 'next-intl';
import { useUnits } from '@/features/setup/api';
import { SetupPage } from '@/features/setup/setup-page';
import { UnitsTable } from '@/features/setup/units-table';

export default function UnitsSetupPage() {
  const t = useTranslations('setup.units');
  const units = useUnits();

  return (
    <SetupPage title={t('title')} intro={t('intro')} query={units}>
      {(page) => <UnitsTable units={page.data} />}
    </SetupPage>
  );
}
