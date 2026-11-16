'use client';

// Entry point for purchase requisitions; the searchable list replaces the intro in US8 (T153).
import { PERMISSIONS } from '@ngo/shared';
import { Button } from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useHasPermission } from '@/lib/use-me';

export default function PrsPage() {
  const t = useTranslations('pr.list');
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
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
    </div>
  );
}
