'use client';

// Receiving (002 US7): the GRNs, and the purchase orders waiting for goods.
import { RECEIPT_STATUSES, formatDate } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { usePurchaseOrders } from '@/features/orders/api';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useGrns } from './api';

const ALL = '__all';

function ToReceive() {
  const t = useTranslations('receiving.toReceive');
  const localized = useLocalizedName();
  const { data } = usePurchaseOrders({ page: 1, receivable: true });
  if (!data || data.data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.data.map((po) => (
          <div key={po.id} className="flex flex-wrap items-center gap-3">
            <Link href={`/procurement/pos/${po.id}`} className="hover:underline" dir="ltr">
              {po.number}
            </Link>
            <span>{localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}</span>
            <DocStatusBadge status={po.status} namespace="orders.status" />
            <Button asChild size="sm" variant="outline">
              <Link href={`/procurement/receiving/new?po=${po.id}`}>{t('receive')}</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function GrnList() {
  const t = useTranslations('receiving');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const localized = useLocalizedName();
  const [status, setStatus] = useState<string | undefined>();
  const { data, error, isPending } = useGrns({ page: 1, status });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <ToReceive />
      <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t('statusFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
          {RECEIPT_STATUSES.map((s) => (
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
                <TableHead className="w-44">{t('po')}</TableHead>
                <TableHead>{t('supplier')}</TableHead>
                <TableHead className="w-32">{t('statusLabel')}</TableHead>
                <TableHead className="w-32">{t('receivedDate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((g) => (
                <TableRow
                  key={g.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/procurement/receiving/${g.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/procurement/receiving/${g.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {g.number}
                    </Link>
                  </TableCell>
                  <TableCell dir="ltr">{g.poNumber}</TableCell>
                  <TableCell>
                    {localized({ nameAr: g.supplierNameAr, nameEn: g.supplierNameEn })}
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={g.status} namespace="receiving.status" />
                  </TableCell>
                  <TableCell dir="ltr">{formatDate(g.receivedDate)}</TableCell>
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
