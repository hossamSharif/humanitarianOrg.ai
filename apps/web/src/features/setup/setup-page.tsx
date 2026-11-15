'use client';

import { PERMISSIONS } from '@ngo/shared';
import { Button } from '@ngo/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';

/** Frame of every settings page: back link, title, permission gate, loading and error states. */
export function SetupPage<T>({
  title,
  intro,
  query,
  children,
}: {
  title: string;
  intro?: string;
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const t = useTranslations('setup');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const apiError = useApiError();
  const can = useHasPermission();

  let body: ReactNode;
  if (!can(PERMISSIONS.SETTINGS_MANAGE)) {
    body = (
      <p role="alert" className="text-sm text-destructive">
        {tErrors('FORBIDDEN')}
      </p>
    );
  } else if (query.isPending) {
    body = <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  } else if (query.isError) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {apiError(query.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  } else {
    body = children(query.data);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/setup"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          {t('title')}
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      </div>
      {body}
    </div>
  );
}
