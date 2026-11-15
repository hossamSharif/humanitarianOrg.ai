'use client';

import { grantCreate, type Grant, type GrantCreate } from '@ngo/shared';
import {
  Button,
  Checkbox,
  DateInput,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
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
import { useDonors, useOffices, useSaveGrant } from './api';
import {
  ErrorText,
  Field,
  apiFieldErrors,
  useLocalizedName,
  zodFieldErrors,
  type FieldErrors,
} from './shared';

/** Currencies seeded in packages/database/migrations/0008_seed_reference.sql. */
export const GRANT_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'SDG'] as const;

interface GrantFormState {
  donorId: string;
  code: string;
  name: string;
  currency: string;
  totalAmount: string;
  startDate: string | null;
  endDate: string | null;
  officeIds: string[];
}

const EMPTY: GrantFormState = {
  donorId: '',
  code: '',
  name: '',
  currency: 'USD',
  totalAmount: '',
  startDate: null,
  endDate: null,
  officeIds: [],
};

function fromGrant(g: Grant): GrantFormState {
  return {
    donorId: g.donorId,
    code: g.code,
    name: g.name,
    currency: g.currency,
    totalAmount: g.totalAmount,
    startDate: g.startDate,
    endDate: g.endDate,
    officeIds: g.officeIds,
  };
}

/** Create or edit a grant: donor, code, name, currency, total, DD/MM/YYYY period, offices. */
export function GrantForm({
  open,
  onOpenChange,
  grant,
  currencyLocked = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grant?: Grant;
  /** budget lines carry commitments: the currency cannot change */
  currencyLocked?: boolean;
  onSaved?: (grant: Grant) => void;
}) {
  const t = useTranslations('grants');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const donors = useDonors({ active: true });
  const offices = useOffices();
  const save = useSaveGrant();
  const [form, setForm] = useState<GrantFormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setForm(grant ? fromGrant(grant) : EMPTY);
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grant]);

  const set = <K extends keyof GrantFormState>(key: K, value: GrantFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleOffice = (id: string, on: boolean) =>
    set('officeIds', on ? [...form.officeIds, id] : form.officeIds.filter((o) => o !== id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = grantCreate.safeParse({
      ...form,
      startDate: form.startDate ?? '',
      endDate: form.endDate ?? '',
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const body: GrantCreate = parsed.data;
    try {
      const saved = await save.mutateAsync(
        grant ? { id: grant.id, body: { ...body, expectedVersion: grant.version } } : { body }
      );
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{grant ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="grant-donor" label={t('donor')} error={errors.donorId}>
              <Select value={form.donorId} onValueChange={(v) => set('donorId', v)}>
                <SelectTrigger id="grant-donor" aria-invalid={errors.donorId ? true : undefined}>
                  <SelectValue placeholder={t('selectDonor')} />
                </SelectTrigger>
                <SelectContent>
                  {(donors.data?.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.shortName ? `${d.name} (${d.shortName})` : d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="grant-code" label={t('code')} error={errors.code}>
              <Input
                id="grant-code"
                dir="ltr"
                value={form.code}
                onChange={(e) => set('code', e.target.value)}
                aria-invalid={errors.code ? true : undefined}
              />
            </Field>
            <Field id="grant-name" label={t('name')} error={errors.name} className="sm:col-span-2">
              <Input
                id="grant-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                aria-invalid={errors.name ? true : undefined}
              />
            </Field>
            <Field id="grant-currency" label={t('currency')} error={errors.currency}>
              <Select
                value={form.currency}
                onValueChange={(v) => set('currency', v)}
                disabled={currencyLocked}
              >
                <SelectTrigger id="grant-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANT_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currencyLocked ? (
                <p className="text-xs text-muted-foreground">{t('currencyLocked')}</p>
              ) : null}
            </Field>
            <Field id="grant-total" label={t('totalAmount')} error={errors.totalAmount}>
              <MoneyInput
                id="grant-total"
                value={form.totalAmount}
                onChange={(v) => set('totalAmount', v)}
                currency={form.currency}
                aria-invalid={errors.totalAmount ? true : undefined}
              />
            </Field>
            <Field id="grant-start" label={t('startDate')} error={errors.startDate}>
              <DateInput
                id="grant-start"
                placeholder={tc('dateFormatHint')}
                value={form.startDate}
                onChange={(v) => set('startDate', v)}
                aria-invalid={errors.startDate ? true : undefined}
              />
            </Field>
            <Field id="grant-end" label={t('endDate')} error={errors.endDate}>
              <DateInput
                id="grant-end"
                placeholder={tc('dateFormatHint')}
                value={form.endDate}
                onChange={(v) => set('endDate', v)}
                aria-invalid={errors.endDate ? true : undefined}
              />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('offices')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(offices.data ?? []).map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`grant-office-${o.id}`}
                    checked={form.officeIds.includes(o.id)}
                    onCheckedChange={(v) => toggleOffice(o.id, v === true)}
                  />
                  <Label htmlFor={`grant-office-${o.id}`}>
                    {o.code} · {localized(o)}
                  </Label>
                </div>
              ))}
            </div>
            {errors.officeIds ? <ErrorText>{t('fieldErrors.officesRequired')}</ErrorText> : null}
          </fieldset>

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
