'use client';

// Supplier invoice page (002 US11): the invoiced lines against the order's quantities and prices,
// and the payment request built from it.
import { formatDate } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { Amount, ErrorText, useLocalizedName } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useInvoice } from './api';

export function InvoiceDetailView({ id }: { id: string }) {
  const t = useTranslations('invoices');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const { data: invoice, error, isPending } = useInvoice(id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !invoice)
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {invoice.number}
            </h1>
            <DocStatusBadge status={invoice.status} namespace="invoices.status" />
          </div>
          <p className="text-muted-foreground">
            {localized({ nameAr: invoice.supplierNameAr, nameEn: invoice.supplierNameEn })}
            {' · '}
            <Link href={`/procurement/pos/${invoice.poId}`} className="hover:underline" dir="ltr">
              {invoice.poNumber}
            </Link>
          </p>
        </div>
        {invoice.availableActions.includes('create_payment_request') ? (
          <Button asChild>
            <Link href={`/finance/payment-requests/new?po=${invoice.poId}&invoice=${invoice.id}`}>
              {t('createPaymentRequest')}
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">{t('supplierInvoiceNo')}</p>
            <p dir="ltr">{invoice.supplierInvoiceNo}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('invoiceDate')}</p>
            <p dir="ltr">{formatDate(invoice.invoiceDate)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('amount')}</p>
            <Amount value={invoice.amount} currency={invoice.currency} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('create.lines')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t('create.description')}</TableHead>
                <TableHead className="w-28 text-end">{t('create.ordered')}</TableHead>
                <TableHead className="w-28 text-end">{t('create.accepted')}</TableHead>
                <TableHead className="w-28 text-end">{t('create.quantity')}</TableHead>
                <TableHead className="w-36 text-end">{t('create.poPrice')}</TableHead>
                <TableHead className="w-36 text-end">{t('create.unitPrice')}</TableHead>
                <TableHead className="w-40 text-end">{t('create.lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell dir="ltr">{l.lineNo}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {l.orderedQty}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {l.acceptedQty}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {l.quantity}
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.poPrice} currency={invoice.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.unitPrice} currency={invoice.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.lineTotal} currency={invoice.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {invoice.paymentRequest ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('paymentRequest')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Link
              href={`/finance/payment-requests/${invoice.paymentRequest.id}`}
              className="hover:underline"
              dir="ltr"
            >
              {invoice.paymentRequest.number ?? t('draftNumber')}
            </Link>
            <DocStatusBadge status={invoice.paymentRequest.status} namespace="payments.status" />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
