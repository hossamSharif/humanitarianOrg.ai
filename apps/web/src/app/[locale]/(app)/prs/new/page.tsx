'use client';

// Starts a PR: creates the draft on the server right away (research R10) with today's date in the
// organization's timezone, the user's first office and "goods", then opens it for editing.
import { calendarDateInTimeZone } from '@ngo/shared';
import { Button } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useCreatePr } from '@/features/pr/api';
import { useTenantProfile } from '@/features/setup/api';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';

export default function NewPrPage() {
  const t = useTranslations('pr.form');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const me = useMe();
  const tenant = useTenantProfile();
  const create = useCreatePr();
  const started = useRef(false);

  function start() {
    if (!me.data || !tenant.data) return;
    started.current = true;
    const officeId = me.data.offices.find((o) => o.isActive)?.id ?? null;
    create.mutate(
      {
        header: {
          prDate: calendarDateInTimeZone(new Date(), tenant.data.timezone),
          requestingOfficeId: officeId,
          deliverToOfficeId: officeId,
          prType: 'goods',
        },
      },
      { onSuccess: (created) => router.replace(`/prs/${created.id}/edit`) }
    );
  }

  // once, as soon as the user and organization are known
  useEffect(() => {
    if (!started.current) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data, tenant.data]);

  if (create.error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {apiError(create.error)}
        </p>
        <Button onClick={start}>{tc('retry')}</Button>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{t('creating')}</p>;
}
