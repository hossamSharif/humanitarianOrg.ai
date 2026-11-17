'use client';

// Vouchers (002 US13): every BPV / CPV / BRV / CRV / JV / TRF with type and status filters.
import { VOUCHER_STATUSES, VOUCHER_TYPES, formatDate } from '@ngo/shared';
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
import { useVouchers } from './api';

const ALL = '__all';

export function VoucherList() {
  const t = useTranslations('vouchers');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const [status, setStatus] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const { data, error, isPending } = useVouchers({ page: 1, status, type });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Select value={type ?? ALL} onValueChange={(v) => setType(v === ALL ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('typeFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allTypes')}</SelectItem>
            {VOUCHER_TYPES.map((x) => (
              <SelectItem key={x} value={x}>
                {t(`type.${x}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('statusFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {VOUCHER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
      {data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">{t('number')}</TableHead>
                <TableHead className="w-20">{t('typeLabel')}</TableHead>
                <TableHead className="w-32">{t('date')}</TableHead>
                <TableHead>{t('payee')}</TableHead>
                <TableHead className="w-48">{t('moneyAccount')}</TableHead>
                <TableHead className="w-44 text-end">{t('amount')}</TableHead>
                <TableHead className="w-32">{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((v) => (
                <TableRow
                  key={v.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/finance/vouchers/${v.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/finance/vouchers/${v.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {v.number ?? t('draftNumber')}
                    </Link>
                    {v.reversalOfId ? (
                      <span className="ms-2 text-xs text-muted-foreground">{t('reversal')}</span>
                    ) : null}
                  </TableCell>
                  <TableCell dir="ltr">{v.type}</TableCell>
                  <TableCell dir="ltr">{formatDate(v.voucherDate)}</TableCell>
                  <TableCell>{v.payeeName}</TableCell>
                  <TableCell>{v.moneyAccountName}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={v.amount} currency={v.currency} />
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={v.status} namespace="vouchers.status" />
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
