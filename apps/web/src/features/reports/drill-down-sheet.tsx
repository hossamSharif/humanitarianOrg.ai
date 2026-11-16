'use client';

// Drill-down (US8-2): the PRs reserving or committing one budget line, with links to each PR.
// A PR outside the caller's offices still counts in the amounts but shows no number or link.
import { formatAmount, formatDate } from '@ngo/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { PrStatusBadge } from '@/features/pr/pr-status-badge';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useBudgetDrillDown } from './api';

export interface DrillDownTarget {
  budgetLineId: string;
  code: string;
  status: 'reserved' | 'committed' | null;
}

export function DrillDownSheet({
  target,
  onClose,
}: {
  target: DrillDownTarget | null;
  onClose: () => void;
}) {
  const t = useTranslations('reports.drillDown');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const { data, error, isPending } = useBudgetDrillDown(
    target?.budgetLineId ?? null,
    target?.status ?? null
  );

  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="end" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t(target?.status ?? 'all', { code: target?.code ?? '' })}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {apiError(error)}
            </p>
          ) : isPending ? (
            <p className="text-sm text-muted-foreground">{tc('loading')}</p>
          ) : data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('number')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('prDate')}</TableHead>
                  <TableHead>{t('office')}</TableHead>
                  <TableHead className="text-end">{t('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((row) => (
                  <TableRow key={row.commitmentId}>
                    <TableCell>
                      {row.number ? (
                        <Link href={`/prs/${row.prId}`} className="text-primary hover:underline">
                          <bdi dir="ltr">{row.number}</bdi>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t('restricted')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.prStatus ? <PrStatusBadge status={row.prStatus} /> : '—'}
                    </TableCell>
                    <TableCell>
                      <span dir="ltr" className="tabular-nums">
                        {formatDate(row.prDate) || '—'}
                      </span>
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {row.officeCode ?? '—'}
                    </TableCell>
                    <TableCell className="text-end">
                      <span dir="ltr" className="tabular-nums">
                        {formatAmount({ amount: row.amount, currency: row.currency })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-medium">
                    {t('total')}
                  </TableCell>
                  <TableCell className="text-end font-medium">
                    <span dir="ltr" className="tabular-nums">
                      {formatAmount({ amount: data.total, currency: data.budgetLine.currency })}
                    </span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
