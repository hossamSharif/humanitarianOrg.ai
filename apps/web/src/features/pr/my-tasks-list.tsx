'use client';

// "My tasks" (FR-047): PRs whose current step the caller may sign now, oldest wait first.
import { formatAmount, formatDateTime } from '@ngo/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useLocalizedName } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useMyTasks } from './api';

export function MyTasksList() {
  const t = useTranslations('myTasks');
  const tKind = useTranslations('pr.steps.kind');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const timeZone = useTenantTimeZone();
  const { data, error, isPending } = useMyTasks();

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiError(error)}
      </p>
    );
  }
  if (isPending) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  if (data.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.step')}</TableHead>
            <TableHead>{t('columns.number')}</TableHead>
            <TableHead>{t('columns.office')}</TableHead>
            <TableHead>{t('columns.requester')}</TableHead>
            <TableHead className="text-end">{t('columns.amount')}</TableHead>
            <TableHead>{t('columns.waitingSince')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((task) => (
            <TableRow key={task.stepId}>
              <TableCell className="font-medium">{tKind(task.stepKind)}</TableCell>
              <TableCell>
                <Link href={`/prs/${task.prId}`} className="text-primary hover:underline">
                  <bdi dir="ltr">{task.number ?? '—'}</bdi>
                </Link>
              </TableCell>
              <TableCell>{task.office ? localized(task.office) : '—'}</TableCell>
              <TableCell>{localized(task.requester)}</TableCell>
              <TableCell className="text-end">
                <span dir="ltr" className="tabular-nums">
                  {task.totalGrantCurrency ? formatAmount(task.totalGrantCurrency) : '—'}
                </span>
              </TableCell>
              <TableCell>
                <span dir="ltr" className="tabular-nums">
                  {formatDateTime(task.waitingSince, timeZone)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
