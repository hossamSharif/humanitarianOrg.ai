'use client';

// Status chip for any document (002 data-model §12): one tone per kind of state, the label from
// the given messages namespace (`documents.status` by default; PRs use `status`).
import { Badge, cn } from '@ngo/ui';
import { useTranslations } from 'next-intl';

const WAITING = 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
const DONE = 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
const BACK = 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200';
const STOPPED = 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200';
const CLOSED = 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
const DRAFT = 'bg-muted text-muted-foreground';

const TONE: Record<string, string> = {
  draft: DRAFT,
  open: DRAFT,
  pending_finance_check: WAITING,
  pending_approval: WAITING,
  pending_check: WAITING,
  issued: WAITING,
  scoring: WAITING,
  signing: WAITING,
  checked: WAITING,
  partially_received: WAITING,
  partially_settled: WAITING,
  in_procurement: WAITING,
  approved: DONE,
  acknowledged: DONE,
  opened: DONE,
  evaluated: DONE,
  awarded: DONE,
  completed: DONE,
  fully_received: DONE,
  paid: DONE,
  settled: DONE,
  posted: DONE,
  signed_off: DONE,
  returned: BACK,
  rejected: STOPPED,
  cancelled: CLOSED,
  closed: CLOSED,
};

export function DocStatusBadge({
  status,
  namespace = 'documents.status',
  className,
}: {
  status: string;
  namespace?: string;
  className?: string;
}) {
  const t = useTranslations(namespace);
  return (
    <Badge variant="outline" className={cn('border-transparent', TONE[status] ?? DRAFT, className)}>
      {t(status)}
    </Badge>
  );
}
