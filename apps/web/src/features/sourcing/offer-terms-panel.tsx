'use client';

// Offer terms, prices, essential compliance and the scanned quotation, after the opening only
// (002 US4-3). Before the opening this panel does not exist and the API returns nothing (the
// sealed tables' RLS); a late or replaced receipt takes no terms.
import {
  ESSENTIAL_RESULTS,
  formatAmount,
  type EssentialResult,
  type OfferReceiptView,
  type OfferTermsView,
  type SourcingEventDetail,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  toast,
} from '@ngo/ui';
import { FileText, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { offerScanUrl, useEnterTerms, useOfferTerms, useUploadOfferScan } from './api';

interface FormState {
  currency: string;
  deliveryDays: string;
  validityDays: string;
  paymentTerms: string;
  compliance: Record<string, EssentialResult | ''>;
  prices: Record<string, string>;
  quantities: Record<string, string>;
}

function initial(event: SourcingEventDetail, terms: OfferTermsView | undefined): FormState {
  return {
    currency: terms?.currency ?? event.currency,
    deliveryDays: terms?.deliveryDays?.toString() ?? '',
    validityDays: terms?.validityDays?.toString() ?? '',
    paymentTerms: terms?.paymentTerms ?? '',
    compliance: Object.fromEntries(
      event.criteria
        .filter((c) => c.kind === 'essential')
        .map((c) => [c.id, terms?.essentialCompliance[c.id]?.result ?? ''])
    ),
    prices: Object.fromEntries(
      event.lines.map((l) => [
        l.id,
        terms?.linePrices.find((p) => p.sourcingLineId === l.id)?.unitPrice ?? '',
      ])
    ),
    quantities: Object.fromEntries(
      event.lines.map((l) => {
        const q = terms?.linePrices.find((p) => p.sourcingLineId === l.id)?.quantity;
        return [l.id, q && Number(q) !== Number(l.quantity) ? q : ''];
      })
    ),
  };
}

function OfferTermsForm({
  event,
  offer,
  terms,
  editable,
}: {
  event: SourcingEventDetail;
  offer: OfferReceiptView;
  terms: OfferTermsView | undefined;
  editable: boolean;
}) {
  const t = useTranslations('sourcing.terms');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const save = useEnterTerms(event.id);
  const upload = useUploadOfferScan(event.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => initial(event, terms));

  useEffect(() => {
    setForm(initial(event, terms));
  }, [event, terms]);

  const essentials = event.criteria.filter((c) => c.kind === 'essential');
  const submit = () =>
    save.mutate(
      {
        offerId: offer.id,
        input: {
          currency: form.currency.toUpperCase(),
          deliveryDays: form.deliveryDays ? Number(form.deliveryDays) : null,
          validityDays: form.validityDays ? Number(form.validityDays) : null,
          paymentTerms: form.paymentTerms || null,
          essentialCompliance: Object.fromEntries(
            Object.entries(form.compliance)
              .filter(([, r]) => r)
              .map(([id, r]) => [id, { result: r as EssentialResult }])
          ),
          linePrices: event.lines
            .filter((l) => form.prices[l.id])
            .map((l) => ({
              sourcingLineId: l.id,
              unitPrice: form.prices[l.id]!,
              ...(form.quantities[l.id] ? { quantity: form.quantities[l.id] } : {}),
            })),
        },
      },
      { onSuccess: () => toast({ description: t('saved') }) }
    );

  const openScan = async () => {
    try {
      window.open(await offerScanUrl(event.id, offer.id), '_blank', 'noopener');
    } catch (err) {
      toast({ variant: 'destructive', description: apiError(err) });
    }
  };

  return (
    <section className="space-y-3 rounded-md border p-3" aria-label={offer.supplierNameEn}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {localized({ nameAr: offer.supplierNameAr, nameEn: offer.supplierNameEn })}
        </h3>
        {terms ? (
          <Badge variant="secondary">
            <span dir="ltr">{formatAmount({ amount: terms.total, currency: terms.currency })}</span>
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`cur-${offer.id}`}>{t('currency')}</Label>
          <Input
            id={`cur-${offer.id}`}
            dir="ltr"
            maxLength={3}
            disabled={!editable}
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`del-${offer.id}`}>{t('deliveryDays')}</Label>
          <Input
            id={`del-${offer.id}`}
            dir="ltr"
            inputMode="numeric"
            disabled={!editable}
            value={form.deliveryDays}
            onChange={(e) =>
              setForm((f) => ({ ...f, deliveryDays: e.target.value.replace(/\D/g, '') }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`val-${offer.id}`}>{t('validityDays')}</Label>
          <Input
            id={`val-${offer.id}`}
            dir="ltr"
            inputMode="numeric"
            disabled={!editable}
            value={form.validityDays}
            onChange={(e) =>
              setForm((f) => ({ ...f, validityDays: e.target.value.replace(/\D/g, '') }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pay-${offer.id}`}>{t('paymentTerms')}</Label>
          <Input
            id={`pay-${offer.id}`}
            dir="auto"
            disabled={!editable}
            value={form.paymentTerms}
            onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
          />
        </div>
      </div>

      {essentials.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {essentials.map((c) => (
            <div key={c.id} className="space-y-1">
              <Label htmlFor={`ess-${offer.id}-${c.id}`}>{localized(c)}</Label>
              <Select
                value={form.compliance[c.id] || '__none'}
                disabled={!editable}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    compliance: {
                      ...f.compliance,
                      [c.id]: v === '__none' ? '' : (v as EssentialResult),
                    },
                  }))
                }
              >
                <SelectTrigger id={`ess-${offer.id}-${c.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t('notChecked')}</SelectItem>
                  {ESSENTIAL_RESULTS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`results.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{t('line')}</TableHead>
              <TableHead className="w-32 text-end">{t('quantity')}</TableHead>
              <TableHead className="w-40 text-end">{t('unitPrice')}</TableHead>
              <TableHead className="w-40 text-end">{t('lineTotal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {event.lines.map((l) => {
              const saved = terms?.linePrices.find((p) => p.sourcingLineId === l.id);
              return (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                  <TableCell>{l.description ?? '—'}</TableCell>
                  <TableCell>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="text-end"
                      aria-label={t('quantityFor', { line: l.lineNo })}
                      placeholder={l.quantity}
                      disabled={!editable}
                      value={form.quantities[l.id] ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          quantities: {
                            ...f.quantities,
                            [l.id]: e.target.value.replace(/[^\d.]/g, ''),
                          },
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="text-end"
                      aria-label={t('unitPriceFor', { line: l.lineNo })}
                      disabled={!editable}
                      value={form.prices[l.id] ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          prices: { ...f.prices, [l.id]: e.target.value.replace(/[^\d.]/g, '') },
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell dir="ltr" className="text-end tabular-nums">
                    {saved
                      ? formatAmount({ amount: saved.lineTotal, currency: form.currency })
                      : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
      {upload.error ? <ErrorText>{apiError(upload.error)}</ErrorText> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {terms?.scanAttachmentId ? (
          <Button type="button" variant="outline" onClick={() => void openScan()}>
            <FileText className="me-2 h-4 w-4" aria-hidden />
            {t('viewScan')}
          </Button>
        ) : null}
        {editable && terms ? (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ offerId: offer.id, file });
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="me-2 h-4 w-4" aria-hidden />
              {terms.scanAttachmentId ? t('replaceScan') : t('uploadScan')}
            </Button>
          </>
        ) : null}
        {editable ? (
          <Button onClick={submit} disabled={save.isPending || form.currency.length !== 3}>
            {tc('save')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function OfferTermsPanel({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.terms');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const opened = event.openedAt !== null;
  const terms = useOfferTerms(event.id, opened);
  if (!opened) return null;

  const editable = event.availableActions.includes('enter_terms');
  const valid = event.offers.filter((o) => o.status === 'logged' || o.status === 'late_accepted');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {terms.error ? <ErrorText>{apiError(terms.error)}</ErrorText> : null}
        {terms.isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
        {valid.length === 0 ? <p className="text-sm text-muted-foreground">{t('none')}</p> : null}
        {terms.data
          ? valid.map((o) => (
              <OfferTermsForm
                key={o.id}
                event={event}
                offer={o}
                terms={terms.data.find((x) => x.offerId === o.id)}
                editable={editable}
              />
            ))
          : null}
      </CardContent>
    </Card>
  );
}
