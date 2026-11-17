'use client';

// Register a supplier invoice against a purchase order (002 US11): the supplier and currency are
// the order's, never typed; each invoiced line names a line of the order with its quantity and
// price, and the scan is chosen from the order's attachments.
import type { InvoiceLineInput } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
  Input,
  Label,
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
import { useDocAttachments } from '@/features/documents/api';
import { Amount, ErrorText, useLocalizedName } from '@/features/grants/shared';
import { poSlug, usePurchaseOrder } from '@/features/orders/api';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useRegisterInvoice } from './api';

const NONE = '__none';

interface LineDraft {
  include: boolean;
  quantity: string;
  unitPrice: string;
}

export function InvoiceCreate({ poId }: { poId: string }) {
  const t = useTranslations('invoices.create');
  const ti = useTranslations('invoices');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const router = useRouter();
  const { data: po, error, isPending } = usePurchaseOrder(poId);
  const attachments = useDocAttachments(po ? poSlug(po) : 'pos', poId);
  const register = useRegisterInvoice(poId);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string | null>(null);
  const [attachmentId, setAttachmentId] = useState<string>(NONE);
  const [lines, setLines] = useState<Record<string, LineDraft>>({});

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !po) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const draftOf = (l: (typeof po.lines)[number]): LineDraft =>
    lines[l.id] ?? { include: true, quantity: l.quantity, unitPrice: l.unitPrice };
  const update = (l: (typeof po.lines)[number], patch: Partial<LineDraft>) =>
    setLines((cur) => ({ ...cur, [l.id]: { ...draftOf(l), ...patch } }));

  const chosen: InvoiceLineInput[] = po.lines.flatMap((l) => {
    const d = draftOf(l);
    return d.include && Number(d.quantity) > 0
      ? [{ poLineId: l.id, quantity: d.quantity, unitPrice: d.unitPrice }]
      : [];
  });
  const total = chosen.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
  const uploaded = (attachments.data ?? []).filter((a) => a.uploadedAt !== null);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">
          <span dir="ltr">{po.number}</span> ·{' '}
          {localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })} ·{' '}
          <span dir="ltr">{po.currency}</span>
        </p>
        <p className="text-sm text-muted-foreground">{t('inherited')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('header')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="inv-no">{ti('supplierInvoiceNo')}</Label>
            <Input
              id="inv-no"
              dir="ltr"
              value={supplierInvoiceNo}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-date">{ti('invoiceDate')}</Label>
            <DateInput id="inv-date" value={invoiceDate} onChange={setInvoiceDate} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-scan">{t('scan')}</Label>
            <Select value={attachmentId} onValueChange={setAttachmentId}>
              <SelectTrigger id="inv-scan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noScan')}</SelectItem>
                {uploaded.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('scanHint')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('lines')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="w-28 text-end">{t('ordered')}</TableHead>
                <TableHead className="w-28 text-end">{t('accepted')}</TableHead>
                <TableHead className="w-32">{t('quantity')}</TableHead>
                <TableHead className="w-36">{t('unitPrice')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((l) => {
                const d = draftOf(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={t('include')}
                        checked={d.include}
                        onCheckedChange={(v) => update(l, { include: v === true })}
                      />
                    </TableCell>
                    <TableCell dir="ltr">{l.lineNo}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {l.quantity}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {l.acceptedQty}
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={t('quantity')}
                        value={d.quantity}
                        disabled={!d.include}
                        onChange={(e) => update(l, { quantity: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={t('unitPrice')}
                        value={d.unitPrice}
                        disabled={!d.include}
                        onChange={(e) => update(l, { unitPrice: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-sm">
            {t('total')}: <Amount value={total.toFixed(2)} currency={po.currency} />
          </p>
        </CardContent>
      </Card>

      {register.error ? <ErrorText>{apiError(register.error)}</ErrorText> : null}
      <div className="flex gap-2">
        <Button
          disabled={
            register.isPending || !invoiceDate || !supplierInvoiceNo.trim() || chosen.length === 0
          }
          onClick={() =>
            register.mutate(
              {
                supplierInvoiceNo: supplierInvoiceNo.trim(),
                invoiceDate: invoiceDate!,
                currency: po.currency,
                lines: chosen,
                ...(attachmentId !== NONE ? { attachmentId } : {}),
              },
              { onSuccess: (invoice) => router.push(`/finance/invoices/${invoice.id}`) }
            )
          }
        >
          {t('submit')}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}
