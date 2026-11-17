'use client';

// Purchase orders and contracts (002 US6): every PO with its supplier, award, status and total.
import { PURCHASE_ORDER_STATUSES, formatDate } from '@ngo/shared';
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
import { usePurchaseOrders } from './api';

const ALL = '__all';

export function PoList() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const localized = useLocalizedName();
  const [status, setStatus] = useState<string | undefined>();
  const { data, error, isPending } = usePurchaseOrders({ page: 1, status });

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
          {PURCHASE_ORDER_STATUSES.map((s) => (
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
                <TableHead>{t('supplier')}</TableHead>
                <TableHead className="w-40">{t('analysis')}</TableHead>
                <TableHead className="w-36">{t('statusLabel')}</TableHead>
                <TableHead className="w-44 text-end">{t('total')}</TableHead>
                <TableHead className="w-32">{t('poDate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((po) => (
                <TableRow
                  key={po.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/procurement/pos/${po.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/procurement/pos/${po.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {po.number ?? t('draftNumber')}
                    </Link>
                    {po.kind === 'contract' ? (
                      <span className="ms-2 text-xs text-muted-foreground">{t('kind.contract')}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}
                  </TableCell>
                  <TableCell dir="ltr">{po.analysisNumber ?? '—'}</TableCell>
                  <TableCell>
                    <DocStatusBadge status={po.status} namespace="orders.status" />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={po.totalWithAmendments} currency={po.currency} />
                  </TableCell>
                  <TableCell dir="ltr">{po.poDate ? formatDate(po.poDate) : '—'}</TableCell>
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
