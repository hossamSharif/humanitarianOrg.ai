'use client';

// Quotation analyses (002 US5): every analysis with its RFQ, status and awarded amount.
import { BID_ANALYSIS_STATUSES, formatDate } from '@ngo/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { Amount, ErrorText } from '@/features/grants/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useAnalyses } from './api';

const ALL = '__all';

export function AnalysesList() {
  const t = useTranslations('analysis');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const [status, setStatus] = useState<string | undefined>();
  const { data, error, isPending } = useAnalyses({ page: 1, status });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t('statusFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
          {BID_ANALYSIS_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
      {data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">{t('number')}</TableHead>
                <TableHead>{t('rfq')}</TableHead>
                <TableHead className="w-36">{t('statusLabel')}</TableHead>
                <TableHead className="w-44 text-end">{t('awardedAmount')}</TableHead>
                <TableHead className="w-32">{t('createdAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/procurement/analyses/${a.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/procurement/analyses/${a.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.number ?? t('draftNumber')}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span dir="ltr" className="me-2">
                      {a.eventNumber}
                    </span>
                    {a.eventTitle}
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={a.status} namespace="analysis.status" />
                  </TableCell>
                  <TableCell className="text-end">
                    {a.awardedAmount ? (
                      <Amount value={a.awardedAmount} currency={a.eventCurrency} />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell dir="ltr">{formatDate(a.createdAt.slice(0, 10))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
