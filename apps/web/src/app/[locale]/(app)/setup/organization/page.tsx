'use client';

import { useTranslations } from 'next-intl';
import { useTenantProfile } from '@/features/setup/api';
import { OrganizationForm } from '@/features/setup/organization-form';
import { SetupPage } from '@/features/setup/setup-page';

export default function OrganizationSetupPage() {
  const t = useTranslations('setup.organization');
  const profile = useTenantProfile();

  return (
    <SetupPage title={t('title')} intro={t('intro')} query={profile}>
      {(data) => <OrganizationForm key={data.id} profile={data} />}
    </SetupPage>
  );
}
