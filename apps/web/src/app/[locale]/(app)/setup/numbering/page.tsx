'use client';

import { useTranslations } from 'next-intl';
import { useNumbering } from '@/features/setup/api';
import { NumberingForm } from '@/features/setup/numbering-form';
import { SetupPage } from '@/features/setup/setup-page';

export default function NumberingSetupPage() {
  const t = useTranslations('setup.numbering');
  const numbering = useNumbering('PR');

  return (
    <SetupPage title={t('title')} intro={t('intro')} query={numbering}>
      {(config) => <NumberingForm config={config} />}
    </SetupPage>
  );
}
