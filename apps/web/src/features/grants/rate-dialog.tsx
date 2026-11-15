'use client';

import { exchangeRateCreate, type ExchangeRate } from '@ngo/shared';
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useSaveRate } from './api';
import { GRANT_CURRENCIES } from './grant-form';
import { ErrorText, Field, apiFieldErrors, zodFieldErrors, type FieldErrors } from './shared';

export type RateDialogMode =
  | { kind: 'create' }
  | { kind: 'edit'; rate: ExchangeRate }
  /** in-use rate: a new row with the same currency and date (FR-015) */
  | { kind: 'correction'; rate: ExchangeRate };

interface RateForm {
  currency: string;
  rateToBase: string;
  rateDate: string | null;
  source: string;
}

export function RateDialog({
  open,
  onOpenChange,
  mode,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RateDialogMode;
  /** tenant base currency, excluded from the currency list */
  baseCurrency?: string;
}) {
  const t = useTranslations('rates');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveRate();
  const [form, setForm] = useState<RateForm>({
    currency: 'USD',
    rateToBase: '',
    rateDate: null,
    source: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!open) return;
    if (mode.kind === 'create') {
      setForm({ currency: 'USD', rateToBase: '', rateDate: null, source: '' });
    } else {
      setForm({
        currency: mode.rate.currency,
        rateToBase: mode.kind === 'edit' ? mode.rate.rateToBase : '',
        rateDate: mode.rate.rateDate,
        source: mode.kind === 'edit' ? mode.rate.source : '',
      });
    }
    setErrors({});
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const set = <K extends keyof RateForm>(key: K, value: RateForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = exchangeRateCreate.safeParse({ ...form, rateDate: form.rateDate ?? '' });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({
        id: mode.kind === 'edit' ? mode.rate.id : undefined,
        body: parsed.data,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors(apiFieldErrors(err));
    }
  }

  const title =
    mode.kind === 'create'
      ? t('newTitle')
      : mode.kind === 'edit'
        ? t('editTitle')
        : t('correctionTitle');
  const fixedKey = mode.kind === 'correction';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === 'correction'
              ? t('correctionIntro')
              : t('rateMeaning', { base: baseCurrency ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rate-currency" label={t('currency')} error={errors.currency}>
              <Select
                value={form.currency}
                onValueChange={(v) => set('currency', v)}
                disabled={fixedKey}
              >
                <SelectTrigger id="rate-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANT_CURRENCIES.filter((c) => c !== baseCurrency).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="rate-value" label={t('rateToBase')} error={errors.rateToBase}>
              <MoneyInput
                id="rate-value"
                value={form.rateToBase}
                onChange={(v) => set('rateToBase', v)}
                currency={baseCurrency}
                maxDecimals={6}
                aria-invalid={errors.rateToBase ? true : undefined}
              />
            </Field>
            <Field id="rate-date" label={t('rateDate')} error={errors.rateDate}>
              <DateInput
                id="rate-date"
                placeholder={tc('dateFormatHint')}
                value={form.rateDate}
                onChange={(v) => set('rateDate', v)}
                disabled={fixedKey}
                aria-invalid={errors.rateDate ? true : undefined}
              />
            </Field>
            <Field id="rate-source" label={t('source')} error={errors.source}>
              <Input
                id="rate-source"
                value={form.source}
                placeholder={t('sourcePlaceholder')}
                onChange={(e) => set('source', e.target.value)}
                aria-invalid={errors.source ? true : undefined}
              />
            </Field>
          </div>
          {save.error && Object.keys(errors).length === 0 ? (
            <ErrorText>{apiError(save.error)}</ErrorText>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
