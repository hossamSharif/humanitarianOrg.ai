'use client';

import { useTranslations } from 'next-intl';
import { useGrant } from '@/features/grants/api';
import { BudgetLinesTable } from '@/features/grants/budget-lines-table';
import { GrantStatusBadge } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';

export default function GrantBudgetLinesPage({ params }: { params: { id: string } }) {
  const t = useTranslations('budgetLines');
  const { data: grant } = useGrant(params.id);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href={`/grants/${params.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t('backToGrant')}
        </Link>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
          {t('title')}
          {grant ? (
            <>
              <span dir="ltr" className="text-muted-foreground">
                {grant.code}
              </span>
              <GrantStatusBadge status={grant.status} />
            </>
          ) : null}
        </h1>
      </div>
      <BudgetLinesTable grantId={params.id} />
    </div>
  );
}
