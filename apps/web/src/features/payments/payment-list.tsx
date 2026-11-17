'use client';

// Payment requests against orders (002 US11): status filter, the computed net and the match.
import { PAYMENT_REQUEST_STATUSES } from '@ngo/shared';
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
import { Amount, ErrorText, useLocalizedName } from '@/features/grants/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { usePaymentRequests } from './api';

const ALL = '__all';

export function PaymentRequestList() {
  const t = useTranslations('payments');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const localized = useLocalizedName();
  const [status, setStatus] = useState<string | undefined>();
  const { data, error, isPending } = usePaymentRequests({ page: 1, status });

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
          {PAYMENT_REQUEST_STATUSES.map((s) => (
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
                <TableHead className="w-32">{t('kindLabel')}</TableHead>
                <TableHead className="w-40">{t('po')}</TableHead>
                <TableHead>{t('payee')}</TableHead>
                <TableHead className="w-44 text-end">{t('net')}</TableHead>
                <TableHead className="w-32">{t('matchLabel')}</TableHead>
                <TableHead className="w-36">{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/finance/payment-requests/${r.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/finance/payment-requests/${r.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.number ?? t('draftNumber')}
                    </Link>
                  </TableCell>
                  <TableCell>{t(`kind.${r.isAdvance ? 'advance' : r.kind}`)}</TableCell>
                  <TableCell dir="ltr">{r.poNumber}</TableCell>
                  <TableCell>
                    {localized({ nameAr: r.payeeNameAr, nameEn: r.payeeNameEn })}
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={r.net} currency={r.currency} />
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={r.matchStatus} namespace="payments.match" />
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={r.status} namespace="payments.status" />
                  </TableCell>
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
