'use client';

// Purchase requisitions list (US8, FR-046): filters and search in the URL, server-side paging.
import { PERMISSIONS } from '@ngo/shared';
import { Button } from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { PrListFiltersBar } from '@/features/pr/pr-list-filters';
import { PrListTable } from '@/features/pr/pr-list-table';
import { Link } from '@/i18n/routing';
import { useHasPermission } from '@/lib/use-me';

export default function PrsPage() {
  const t = useTranslations('prList');
  const can = useHasPermission();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {can(PERMISSIONS.PR_CREATE) ? (
          <Button asChild>
            <Link href="/prs/new">
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('new')}
            </Link>
          </Button>
        ) : null}
      </div>
      {/* useSearchParams needs a Suspense boundary in the app router */}
      <Suspense>
        <PrListFiltersBar />
        <PrListTable />
      </Suspense>
    </div>
  );
}
