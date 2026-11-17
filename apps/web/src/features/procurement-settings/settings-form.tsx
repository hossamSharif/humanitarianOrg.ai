'use client';

import {
  procurementSettingsBody,
  type ProcurementSettings,
  type ProcurementSettingsInput,
} from '@ngo/shared';
import { Button, Card, CardContent, Checkbox, Input, Label, MoneyInput, toast } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '@/features/setup/api';
import { FieldMessage } from '@/features/setup/field-message';
import { useApiError } from '@/lib/use-api-error';
import { useSaveProcurementSettings } from './api';

type Draft = Omit<ProcurementSettingsInput, 'expectedVersion'>;

const PERCENT_FIELDS = [
  'invoicePriceTolerancePct',
  'invoiceQtyTolerancePct',
  'grnOverDeliveryTolerancePct',
] as const;

const NUMBER_FIELDS = [
  'committeeMinSize',
  'revettingMonths',
  'guaranteeWarningDays',
  'advanceOverdueDays',
  'splittingWindowDays',
] as const;

function draftFrom(s: ProcurementSettings): Draft {
  const { version: _version, ...rest } = s;
  return rest;
}

/** Tolerances, committee size, re-vetting and warning periods, acknowledgement flag (US1). */
export function ProcurementSettingsForm({
  settings,
  canEdit,
}: {
  settings: ProcurementSettings;
  canEdit: boolean;
}) {
  const t = useTranslations('procurement.settings');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveProcurementSettings();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(settings));

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = procurementSettingsBody.safeParse({
      ...draft,
      expectedVersion: settings.version,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        setDraft(draftFrom(saved));
        toast({ description: t('saved') });
      },
      onError: (err) => {
        setErrors(apiFieldErrors(err));
        toast({ variant: 'destructive', description: apiError(err) });
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardContent className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          {PERCENT_FIELDS.map((field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`ps-${field}`}>{t(`fields.${field}`)}</Label>
              <div className="flex items-center gap-2">
                <MoneyInput
                  id={`ps-${field}`}
                  value={draft[field]}
                  onChange={(v) => set(field, v)}
                  disabled={!canEdit}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <FieldMessage errors={errors} field={field} />
            </div>
          ))}
          {NUMBER_FIELDS.map((field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`ps-${field}`}>{t(`fields.${field}`)}</Label>
              <Input
                id={`ps-${field}`}
                type="number"
                inputMode="numeric"
                dir="ltr"
                min={field === 'committeeMinSize' ? 2 : field === 'revettingMonths' ? 1 : 0}
                value={Number.isNaN(draft[field]) ? '' : draft[field]}
                onChange={(e) => set(field, e.target.valueAsNumber)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">{t(`hints.${field}`)}</p>
              <FieldMessage errors={errors} field={field} />
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
            <Checkbox
              checked={draft.requirePoAcknowledgement}
              onCheckedChange={(on) => set('requirePoAcknowledgement', on === true)}
              disabled={!canEdit}
            />
            {t('fields.requirePoAcknowledgement')}
          </label>
        </CardContent>
      </Card>
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setDraft(draftFrom(settings));
              setErrors({});
            }}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {tCommon('save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
