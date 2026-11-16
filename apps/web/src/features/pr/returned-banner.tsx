'use client';

// Why a PR was returned (US5-5); on the edit screen it also says that resubmitting keeps the
// number and restarts the approvals.
import { useTranslations } from 'next-intl';

export function ReturnedBanner({
  reason,
  resubmit = false,
}: {
  reason: string;
  resubmit?: boolean;
}) {
  const t = useTranslations('pr.actions');
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">{t('returnedTitle')}</p>
      <p dir="auto">{reason}</p>
      {resubmit ? <p className="mt-1 text-xs">{t('resubmitHint')}</p> : null}
    </div>
  );
}
