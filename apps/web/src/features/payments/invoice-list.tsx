'use client';

// Supplier invoices (002 US11): the registered invoices, and the open orders an invoice can be
// registered against.
import { PERMISSIONS_002, SUPPLIER_INVOICE_STATUSES, formatDate } from '@ngo/shared';
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
import { Amount, ErrorText, useLocalizedName } from '@/features/grants/shared';
import { usePurchaseOrders } from '@/features/orders/api';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useInvoices } from './api';

const ALL = '__all';
const OPEN = new Set(['approved', 'acknowledged', 'partially_received', 'fully_received']);

function OpenOrders() {
  const t = useTranslations('invoices.openOrders');
  const localized = useLocalizedName();
  const has = useHasPermission();
  const { data } = usePurchaseOrders({ page: 1 });
  const canRegister = has(PERMISSIONS_002.INVOICE_REGISTER);
  const open = data?.data.filter((po) => OPEN.has(po.status)) ?? [];
  if (!canRegister || open.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.map((po) => (
          <div key={po.id} className="flex flex-wrap items-center gap-3">
            <Link href={`/procurement/pos/${po.id}`} className="hover:underline" dir="ltr">
              {po.number}
            </Link>
            <span>{localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}</span>
            <Amount value={po.totalWithAmendments} currency={po.currency} />
            <DocStatusBadge status={po.status} namespace="orders.status" />
            <Button asChild size="sm" variant="outline">
              <Link href={`/finance/invoices/new?po=${po.id}`}>{t('register')}</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function InvoiceList() {
  const t = useTranslations('invoices');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const localized = useLocalizedName();
  const [status, setStatus] = useState<string | undefined>();
  const { data, error, isPending } = useInvoices({ page: 1, status });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <OpenOrders />
      <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t('statusFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
          {SUPPLIER_INVOICE_STATUSES.map((s) => (
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
                <TableHead className="w-40">{t('number')}</TableHead>
                <TableHead className="w-40">{t('supplierInvoiceNo')}</TableHead>
                <TableHead className="w-40">{t('po')}</TableHead>
                <TableHead>{t('supplier')}</TableHead>
                <TableHead className="w-32">{t('invoiceDate')}</TableHead>
                <TableHead className="w-44 text-end">{t('amount')}</TableHead>
                <TableHead className="w-32">{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((i) => (
                <TableRow
                  key={i.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/finance/invoices/${i.id}`)}
                >
                  <TableCell dir="ltr">
                    <Link
                      href={`/finance/invoices/${i.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {i.number}
                    </Link>
                  </TableCell>
                  <TableCell dir="ltr">{i.supplierInvoiceNo}</TableCell>
                  <TableCell dir="ltr">{i.poNumber}</TableCell>
                  <TableCell>
                    {localized({ nameAr: i.supplierNameAr, nameEn: i.supplierNameEn })}
                  </TableCell>
                  <TableCell dir="ltr">{formatDate(i.invoiceDate)}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={i.amount} currency={i.currency} />
                  </TableCell>
                  <TableCell>
                    <DocStatusBadge status={i.status} namespace="invoices.status" />
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
