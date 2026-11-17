'use client';

// Read-only PR lines. After submission each line also shows the rate, rate date and source it
// was locked with and its amount in the grant currency (FR-028).
import { formatAmount, formatDate, type PrDetail, type PrLineSourcingStatus } from '@ngo/shared';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useOffices } from '@/features/grants/api';
import { useUnits } from '@/features/setup/api';
import { useGrantBudgetLines } from './api';
import { trimDecimal } from './form-model';
import { TotalsBar } from './pr-lines-table';

function SourcingStatusBadge({ status }: { status: PrLineSourcingStatus }) {
  const t = useTranslations('pr.lines.sourcing');
  const variant =
    status === 'ordered' ? 'default' : status === 'in_sourcing' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(status)}</Badge>;
}

export function PrLinesView({ pr }: { pr: PrDetail }) {
  const t = useTranslations('pr.lines');
  const locale = useLocale();
  const units = useUnits();
  const offices = useOffices();
  const budgetLines = useGrantBudgetLines(pr.grantId);
  const submitted = pr.submissionCycle > 0;
  // 002 (FR-038): once approved, each line shows whether it is being sourced or ordered
  const sourcing = ['approved', 'in_procurement', 'closed'].includes(pr.status);

  const unit = (id: string | null) => units.data?.data.find((u) => u.id === id)?.code ?? '—';
  const office = (id: string | null) => {
    const o = offices.data?.find((x) => x.id === id);
    return o ? (locale === 'ar' ? o.nameAr : o.nameEn) : '—';
  };
  const code = (id: string | null) => budgetLines.data?.data.find((b) => b.id === id)?.code ?? '—';

  return (
    <section aria-labelledby="pr-lines-view" className="space-y-3">
      <h2 id="pr-lines-view" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{t('description')}</TableHead>
              <TableHead className="text-end">{t('quantity')}</TableHead>
              <TableHead>{t('unit')}</TableHead>
              <TableHead className="text-end">{t('unitCost')}</TableHead>
              <TableHead className="text-end">{t('lineTotal')}</TableHead>
              <TableHead>{t('budgetLine')}</TableHead>
              <TableHead>{t('location')}</TableHead>
              {submitted ? <TableHead className="text-end">{t('amountGrant')}</TableHead> : null}
              {sourcing ? <TableHead>{t('sourcingStatus')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pr.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                <TableCell>
                  <span className="font-medium">{l.description ?? '—'}</span>
                  {l.specifications ? (
                    <span className="block whitespace-pre-line text-xs text-muted-foreground">
                      {l.specifications}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell dir="ltr" className="text-end tabular-nums">
                  {l.quantity ? trimDecimal(l.quantity) : '—'}
                </TableCell>
                <TableCell>{unit(l.unitId)}</TableCell>
                <TableCell dir="ltr" className="text-end tabular-nums">
                  {l.unitCost ? formatAmount({ amount: l.unitCost, currency: l.currency }) : '—'}
                </TableCell>
                <TableCell dir="ltr" className="text-end font-medium tabular-nums">
                  {l.lineTotal ? formatAmount({ amount: l.lineTotal, currency: l.currency }) : '—'}
                </TableCell>
                <TableCell dir="ltr">{code(l.budgetLineId)}</TableCell>
                <TableCell>{office(l.locationOfficeId)}</TableCell>
                {submitted ? (
                  <TableCell className="text-end">
                    {l.amountGrant && pr.grantCurrency ? (
                      <>
                        <span dir="ltr" className="block tabular-nums">
                          {formatAmount({ amount: l.amountGrant, currency: pr.grantCurrency })}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {l.rateSource === 'base'
                            ? t('baseCurrency')
                            : t('lockedRate', {
                                rate: l.rateToBase ?? '',
                                date: formatDate(l.rateDate),
                                source: l.rateSource ?? '',
                              })}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                ) : null}
                {sourcing ? (
                  <TableCell>
                    <SourcingStatusBadge status={l.sourcingStatus ?? 'not_sourced'} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TotalsBar totals={pr.totals} />
    </section>
  );
}
