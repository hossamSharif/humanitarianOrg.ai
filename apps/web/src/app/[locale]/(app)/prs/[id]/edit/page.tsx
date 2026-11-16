'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { usePr } from '@/features/pr/api';
import { PrEditor } from '@/features/pr/pr-editor';
import { useTenantProfile } from '@/features/setup/api';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';

/** Draft / returned PR editor; anyone else, or any other status, goes to the read-only page. */
export default function EditPrPage({ params }: { params: { id: string } }) {
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const pr = usePr(params.id);
  const me = useMe();
  const tenant = useTenantProfile();
  const editable = pr.data?.availableActions.includes('update') ?? false;

  useEffect(() => {
    if (pr.data && !editable) router.replace(`/prs/${params.id}`);
  }, [pr.data, editable, params.id, router]);

  if (pr.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiError(pr.error)}
      </p>
    );
  }
  if (!pr.data || !me.data || !tenant.data || !editable) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }
  return (
    <PrEditor
      key={pr.data.id}
      pr={pr.data}
      userId={me.data.user.id}
      baseCurrency={tenant.data.baseCurrency}
    />
  );
}
