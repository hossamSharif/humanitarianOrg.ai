'use client';

import { useTranslations } from 'next-intl';
import { useOffices } from '@/features/setup/api';
import { OfficesTable } from '@/features/setup/offices-table';
import { SetupPage } from '@/features/setup/setup-page';

export default function OfficesSetupPage() {
  const t = useTranslations('setup.offices');
  const offices = useOffices();

  return (
    <SetupPage title={t('title')} intro={t('intro')} query={offices}>
      {(page) => <OfficesTable offices={page.data} />}
    </SetupPage>
  );
}
