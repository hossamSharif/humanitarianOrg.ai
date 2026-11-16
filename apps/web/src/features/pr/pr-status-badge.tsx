'use client';

import type { PrStatus } from '@ngo/shared';
import { Badge, cn } from '@ngo/ui';
import { useTranslations } from 'next-intl';

const TONE: Record<PrStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_finance_check: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  pending_approval: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  returned: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export function PrStatusBadge({ status, className }: { status: PrStatus; className?: string }) {
  const t = useTranslations('status');
  return (
    <Badge variant="outline" className={cn('border-transparent', TONE[status], className)}>
      {t(status)}
    </Badge>
  );
}
