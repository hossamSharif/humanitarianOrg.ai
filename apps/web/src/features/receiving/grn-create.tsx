'use client';

// Receive against a purchase order (002 US7): the PO's supplier and number are shown, never
// typed; each line shows what is still to receive, and delivered = accepted + rejected, with a
// reason for anything rejected and the Asset flag.
import { SHIPMENT_TYPES, type GrnLineInput, type ShipmentType } from '@ngo/shared';
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
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { usePurchaseOrder } from '@/features/orders/api';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useCreateGrn } from './api';

interface LineDraft {
  include: boolean;
  delivered: string;
  rejected: string;
  rejectReason: string;
  conditionRemarks: string;
  isAsset: boolean;
}

/** accepted = delivered − rejected, kept to 3 decimals. */
function accepted(l: LineDraft): string {
  const value = Number(l.delivered || 0) - Number(l.rejected || 0);
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

export function GrnCreate({ poId }: { poId: string }) {
  const t = useTranslations('receiving.create');
  const tr = useTranslations('receiving');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const router = useRouter();
  const { data: po, error, isPending } = usePurchaseOrder(poId);
  const create = useCreateGrn(poId);
  const [receivedDate, setReceivedDate] = useState<string | null>(null);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [shipmentType, setShipmentType] = useState<ShipmentType>('partial');
  const [lines, setLines] = useState<Record<string, LineDraft>>({});

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !po) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const draftOf = (id: string, remaining: string): LineDraft =>
    lines[id] ?? {
      include: Number(remaining) > 0,
      delivered: remaining,
      rejected: '0',
      rejectReason: '',
      conditionRemarks: '',
      isAsset: false,
    };
  const update = (id: string, remaining: string, patch: Partial<LineDraft>) =>
    setLines((cur) => ({ ...cur, [id]: { ...draftOf(id, remaining), ...patch } }));

  const chosen: GrnLineInput[] = po.lines.flatMap((l) => {
    const d = draftOf(l.id, l.remainingQty);
    if (!d.include || Number(d.delivered) <= 0) return [];
    return [
      {
        poLineId: l.id,
        deliveredQty: d.delivered,
        acceptedQty: accepted(d),
        rejectedQty: d.rejected || '0',
        ...(d.rejectReason.trim() ? { rejectReason: d.rejectReason.trim() } : {}),
        ...(d.conditionRemarks.trim() ? { conditionRemarks: d.conditionRemarks.trim() } : {}),
        isAsset: d.isAsset,
      },
    ];
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">
          <span dir="ltr">{po.number}</span> ·{' '}
          {localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}
        </p>
        <p className="text-sm text-muted-foreground">{t('inherited')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('delivery')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="grn-date">{tr('receivedDate')}</Label>
            <DateInput id="grn-date" value={receivedDate} onChange={setReceivedDate} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grn-dn">{t('deliveryNoteNo')}</Label>
            <Input
              id="grn-dn"
              dir="ltr"
              value={deliveryNoteNo}
              onChange={(e) => setDeliveryNoteNo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grn-inv">{t('supplierInvoiceNo')}</Label>
            <Input
              id="grn-inv"
              dir="ltr"
              value={supplierInvoiceNo}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grn-shipment">{t('shipmentType')}</Label>
            <Select value={shipmentType} onValueChange={(v) => setShipmentType(v as ShipmentType)}>
              <SelectTrigger id="grn-shipment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`shipment.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{tr('lines.description')}</TableHead>
              <TableHead className="w-24 text-end">{tr('lines.ordered')}</TableHead>
              <TableHead className="w-24 text-end">{tr('lines.remaining')}</TableHead>
              <TableHead className="w-28">{tr('lines.delivered')}</TableHead>
              <TableHead className="w-28">{tr('lines.rejected')}</TableHead>
              <TableHead className="w-24 text-end">{tr('lines.accepted')}</TableHead>
              <TableHead className="w-48">{tr('lines.rejectReason')}</TableHead>
              <TableHead className="w-48">{tr('lines.condition')}</TableHead>
              <TableHead className="w-16">{tr('lines.asset')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.lines.map((l) => {
              const d = draftOf(l.id, l.remainingQty);
              const set = (patch: Partial<LineDraft>) => update(l.id, l.remainingQty, patch);
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={t('include')}
                      checked={d.include}
                      onCheckedChange={(v) => set({ include: v === true })}
                    />
                  </TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.quantity}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.remainingQty}
                  </TableCell>
                  <TableCell>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={tr('lines.delivered')}
                      value={d.delivered}
                      disabled={!d.include}
                      onChange={(e) => set({ delivered: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={tr('lines.rejected')}
                      value={d.rejected}
                      disabled={!d.include}
                      onChange={(e) => set({ rejected: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {accepted(d)}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={tr('lines.rejectReason')}
                      value={d.rejectReason}
                      disabled={!d.include || Number(d.rejected || 0) <= 0}
                      onChange={(e) => set({ rejectReason: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={tr('lines.condition')}
                      value={d.conditionRemarks}
                      disabled={!d.include}
                      onChange={(e) => set({ conditionRemarks: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={tr('lines.asset')}
                      checked={d.isAsset}
                      disabled={!d.include}
                      onCheckedChange={(v) => set({ isAsset: v === true })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}
      <Button
        disabled={!receivedDate || !deliveryNoteNo.trim() || chosen.length === 0 || create.isPending}
        onClick={() =>
          create.mutate(
            {
              receivedDate: receivedDate!,
              deliveryNoteNo: deliveryNoteNo.trim(),
              ...(supplierInvoiceNo.trim() ? { supplierInvoiceNo: supplierInvoiceNo.trim() } : {}),
              shipmentType,
              lines: chosen,
            },
            { onSuccess: (grn) => router.push(`/procurement/receiving/${grn.id}`) }
          )
        }
      >
        {t('save')}
      </Button>
    </div>
  );
}
