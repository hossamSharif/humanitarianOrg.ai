'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { BudgetStatusTable } from '@/features/reports/budget-status-table';

export default function BudgetStatusPage() {
  const t = useTranslations('reports');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {/* useSearchParams needs a Suspense boundary in the app router */}
      <Suspense>
        <BudgetStatusTable />
      </Suspense>
    </div>
  );
}
