'use client';

// RFQ header and line wording while draft (002 US3, FR-015): title, dates, deadline in the
// organization's time zone, terms, currency, validity, split award and the chosen method.
// Quantities and units stay the PR lines'; only description and specifications may be reworded.
import {
  PROCUREMENT_METHODS,
  isoToZonedDateTime,
  zonedDateTimeToIso,
  type ProcurementMethod,
  type SourcingEventDetail,
  type UpdateRfqInput,
} from '@ngo/shared';
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
  Textarea,
  toast,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { useApiError } from '@/lib/use-api-error';
import { useUpdateRfq } from './api';

interface FormState {
  title: string;
  issueDate: string | null;
  deadlineDate: string | null;
  deadlineTime: string;
  deliveryPlace: string;
  deliveryTerms: string;
  paymentTerms: string;
  currency: string;
  offerValidityDays: string;
  splitAwardAllowed: boolean;
  chosenMethod: ProcurementMethod;
  lines: Record<string, { description: string; specifications: string }>;
}

function initial(event: SourcingEventDetail, timeZone: string): FormState {
  const deadline = event.submissionDeadline
    ? isoToZonedDateTime(event.submissionDeadline, timeZone)
    : null;
  return {
    title: event.title,
    issueDate: event.issueDate,
    deadlineDate: deadline?.date ?? null,
    deadlineTime: deadline?.time ?? '12:00',
    deliveryPlace: event.deliveryPlace ?? '',
    deliveryTerms: event.deliveryTerms ?? '',
    paymentTerms: event.paymentTerms ?? '',
    currency: event.currency,
    offerValidityDays: event.offerValidityDays ? String(event.offerValidityDays) : '',
    splitAwardAllowed: event.splitAwardAllowed,
    chosenMethod: event.chosenMethod,
    lines: Object.fromEntries(
      event.lines.map((l) => [
        l.id,
        { description: l.description ?? '', specifications: l.specifications ?? '' },
      ])
    ),
  };
}

export function RfqDraftForm({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.form');
  const tm = useTranslations('sourcing.methods');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const timeZone = useTenantTimeZone();
  const update = useUpdateRfq(event.id);
  const [form, setForm] = useState(() => initial(event, timeZone));

  // follow the server copy after a save elsewhere on the page (criteria, invitations)
  useEffect(() => {
    setForm(initial(event, timeZone));
  }, [event, timeZone]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    const input: UpdateRfqInput = {
      expectedVersion: event.version,
      title: form.title,
      issueDate: form.issueDate,
      submissionDeadline: form.deadlineDate
        ? zonedDateTimeToIso(form.deadlineDate, form.deadlineTime || '00:00', timeZone)
        : null,
      deliveryPlace: form.deliveryPlace,
      deliveryTerms: form.deliveryTerms,
      paymentTerms: form.paymentTerms,
      currency: form.currency.toUpperCase(),
      offerValidityDays: form.offerValidityDays ? Number(form.offerValidityDays) : null,
      splitAwardAllowed: form.splitAwardAllowed,
      chosenMethod: form.chosenMethod,
      lines: event.lines.map((l) => ({
        id: l.id,
        description: form.lines[l.id]?.description ?? '',
        specifications: form.lines[l.id]?.specifications ?? '',
      })),
    };
    update.mutate(input, { onSuccess: () => toast({ description: t('saved') }) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="rfq-title">{t('rfqTitle')}</Label>
            <Input
              id="rfq-title"
              dir="auto"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-issue-date">{t('issueDate')}</Label>
            <DateInput
              id="rfq-issue-date"
              value={form.issueDate}
              onChange={(v) => set('issueDate', v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-deadline-date">{t('deadlineDate')}</Label>
            <DateInput
              id="rfq-deadline-date"
              value={form.deadlineDate}
              onChange={(v) => set('deadlineDate', v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-deadline-time">{t('deadlineTime', { timeZone })}</Label>
            <Input
              id="rfq-deadline-time"
              dir="ltr"
              type="time"
              value={form.deadlineTime}
              onChange={(e) => set('deadlineTime', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-currency">{t('currency')}</Label>
            <Input
              id="rfq-currency"
              dir="ltr"
              maxLength={3}
              value={form.currency}
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-validity">{t('offerValidityDays')}</Label>
            <Input
              id="rfq-validity"
              dir="ltr"
              inputMode="numeric"
              value={form.offerValidityDays}
              onChange={(e) => set('offerValidityDays', e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rfq-method">{t('chosenMethod')}</Label>
            <Select
              value={form.chosenMethod}
              onValueChange={(v) => set('chosenMethod', v as ProcurementMethod)}
            >
              <SelectTrigger id="rfq-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCUREMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tm(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="rfq-delivery-place">{t('deliveryPlace')}</Label>
            <Input
              id="rfq-delivery-place"
              dir="auto"
              value={form.deliveryPlace}
              onChange={(e) => set('deliveryPlace', e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="rfq-delivery-terms">{t('deliveryTerms')}</Label>
            <Textarea
              id="rfq-delivery-terms"
              dir="auto"
              rows={2}
              value={form.deliveryTerms}
              onChange={(e) => set('deliveryTerms', e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="rfq-payment-terms">{t('paymentTerms')}</Label>
            <Textarea
              id="rfq-payment-terms"
              dir="auto"
              rows={2}
              value={form.paymentTerms}
              onChange={(e) => set('paymentTerms', e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Checkbox
              id="rfq-split"
              checked={form.splitAwardAllowed}
              onCheckedChange={(v) => set('splitAwardAllowed', v === true)}
            />
            <Label htmlFor="rfq-split">{t('splitAwardAllowed')}</Label>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold">{t('linesTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('linesIntro')}</p>
          {event.lines.map((l) => (
            <div
              key={l.id}
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-[3rem_1fr_1fr]"
            >
              <span className="tabular-nums text-muted-foreground">{l.lineNo}</span>
              <div className="space-y-1">
                <Label htmlFor={`line-desc-${l.id}`} className="text-xs">
                  {t('lineDescription')}
                </Label>
                <Input
                  id={`line-desc-${l.id}`}
                  dir="auto"
                  value={form.lines[l.id]?.description ?? ''}
                  onChange={(e) =>
                    set('lines', {
                      ...form.lines,
                      [l.id]: { ...form.lines[l.id]!, description: e.target.value },
                    })
                  }
                />
                <p dir="ltr" className="text-xs text-muted-foreground">
                  {l.quantity} {l.unitCode ?? ''} · {l.prNumber}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`line-spec-${l.id}`} className="text-xs">
                  {t('lineSpecifications')}
                </Label>
                <Textarea
                  id={`line-spec-${l.id}`}
                  dir="auto"
                  rows={2}
                  value={form.lines[l.id]?.specifications ?? ''}
                  onChange={(e) =>
                    set('lines', {
                      ...form.lines,
                      [l.id]: { ...form.lines[l.id]!, specifications: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>

        {update.error ? <ErrorText>{apiError(update.error)}</ErrorText> : null}
        <div className="flex justify-end">
          <Button onClick={save} disabled={update.isPending || form.title.trim() === ''}>
            {tc('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
