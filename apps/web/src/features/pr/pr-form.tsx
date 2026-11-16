'use client';

// PR draft form (React Hook Form): header — DD/MM/YYYY dates, requesting office, grant picked
// from the grants a PR on that date and office may charge, deliver-to, address, contact,
// required-by, activity, purpose, type — and the lines table. Changing the grant clears the
// budget lines and activities chosen from the previous one (Business Rule 2).
import { PR_TYPES, type BudgetLineWithBalance } from '@ngo/shared';
import { DateInput, Input, Label, Textarea } from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import { useOffices } from '@/features/grants/api';
import { useUnits } from '@/features/setup/api';
import { useMe } from '@/lib/use-me';
import { useGrantActivities, useGrantBudgetLines, useSelectableGrants } from './api';
import type { PrFormValues } from './form-model';
import { FieldError, type Option } from './pr-form-fields';
import { OptionSelect, PrLinesTable } from './pr-lines-table';

export function PrForm({
  form,
  disabled,
  baseCurrency,
  shortfalls,
}: {
  form: UseFormReturn<PrFormValues>;
  disabled?: boolean;
  baseCurrency: string;
  shortfalls?: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('pr.form');
  const tc = useTranslations('common');
  const locale = useLocale();
  const me = useMe();
  const offices = useOffices();
  const units = useUnits();

  const header = useWatch({ control: form.control, name: 'header' });
  const grants = useSelectableGrants(header.prDate, header.requestingOfficeId || null);
  const budgetLines = useGrantBudgetLines(header.grantId || null);
  const activities = useGrantActivities(header.grantId || null);
  const errors = form.formState.errors.header;

  const name = (o: { nameAr: string; nameEn: string }) => (locale === 'ar' ? o.nameAr : o.nameEn);

  const officeOptions: Option[] = (offices.data ?? []).map((o) => ({
    value: o.id,
    label: `${o.code} · ${name(o)}`,
  }));
  const requestingOptions = me.data?.orgWideAccess
    ? officeOptions
    : officeOptions.filter((o) => me.data?.offices.some((m) => m.id === o.value));
  const grantOptions: Option[] = (grants.data?.data ?? []).map((g) => ({
    value: g.id,
    label: `${g.code} · ${g.name} (${g.currency})`,
  }));
  if (header.grantId && !grantOptions.some((g) => g.value === header.grantId)) {
    grantOptions.push({ value: header.grantId, label: t('grantNotSelectable') });
  }
  const unitOptions: Option[] = (units.data?.data ?? [])
    .filter((u) => u.isActive)
    .map((u) => ({ value: u.id, label: `${u.code} · ${name(u)}` }));
  const activityOptions: Option[] = (activities.data ?? [])
    .filter((a) => a.isActive)
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const lines: BudgetLineWithBalance[] = budgetLines.data?.data ?? [];

  /** budget lines and activities belong to one grant: a new grant starts them over */
  function onGrantChange() {
    form.setValue('header.activityId', '');
    form.getValues('lines').forEach((_, i) => {
      form.setValue(`lines.${i}.budgetLineId`, '');
      form.setValue(`lines.${i}.activityId`, '');
    });
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="pr-header-title"
        className="space-y-4 rounded-lg border bg-card p-4"
      >
        <h2 id="pr-header-title" className="text-lg font-semibold">
          {t('headerTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pr-date">{t('prDate')}</Label>
            <Controller
              control={form.control}
              name="header.prDate"
              render={({ field }) => (
                <DateInput
                  id="pr-date"
                  placeholder={tc('dateFormatHint')}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={disabled}
                  aria-invalid={errors?.prDate ? true : undefined}
                />
              )}
            />
            <FieldError error={errors?.prDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-office">{t('requestingOffice')}</Label>
            <OptionSelect
              id="pr-office"
              form={form}
              name="header.requestingOfficeId"
              options={requestingOptions}
              disabled={disabled}
              invalid={Boolean(errors?.requestingOfficeId)}
              placeholder={t('select')}
            />
            <FieldError error={errors?.requestingOfficeId} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-grant">{t('grant')}</Label>
            <OptionSelect
              id="pr-grant"
              form={form}
              name="header.grantId"
              options={grantOptions}
              disabled={disabled || !header.prDate || !header.requestingOfficeId}
              invalid={Boolean(errors?.grantId)}
              placeholder={
                header.prDate && header.requestingOfficeId ? t('select') : t('grantNeedsDateOffice')
              }
              onValueChange={onGrantChange}
            />
            {grants.isSuccess && grants.data.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noGrants')}</p>
            ) : null}
            <FieldError error={errors?.grantId} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-deliver-to">{t('deliverTo')}</Label>
            <OptionSelect
              id="pr-deliver-to"
              form={form}
              name="header.deliverToOfficeId"
              options={officeOptions}
              disabled={disabled}
              invalid={Boolean(errors?.deliverToOfficeId)}
              placeholder={t('select')}
            />
            <FieldError error={errors?.deliverToOfficeId} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pr-address">{t('deliveryAddress')}</Label>
            <Input
              id="pr-address"
              disabled={disabled}
              {...form.register('header.deliveryAddress')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-contact-name">{t('contactName')}</Label>
            <Input
              id="pr-contact-name"
              disabled={disabled}
              {...form.register('header.contactName')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-contact-phone">{t('contactPhone')}</Label>
            <Input
              id="pr-contact-phone"
              dir="ltr"
              inputMode="tel"
              disabled={disabled}
              {...form.register('header.contactPhone')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-required-by">{t('requiredBy')}</Label>
            <Controller
              control={form.control}
              name="header.requiredByDate"
              render={({ field }) => (
                <DateInput
                  id="pr-required-by"
                  placeholder={tc('dateFormatHint')}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={disabled}
                  aria-invalid={errors?.requiredByDate ? true : undefined}
                />
              )}
            />
            <FieldError error={errors?.requiredByDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-type">{t('prType')}</Label>
            <OptionSelect
              id="pr-type"
              form={form}
              name="header.prType"
              options={PR_TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))}
              disabled={disabled}
              invalid={Boolean(errors?.prType)}
              placeholder={t('select')}
            />
            <FieldError error={errors?.prType} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-activity">{t('activity')}</Label>
            <OptionSelect
              id="pr-activity"
              form={form}
              name="header.activityId"
              options={activityOptions}
              disabled={disabled || activityOptions.length === 0}
              optional
              noneLabel={t('none')}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="pr-purpose">{t('purpose')}</Label>
            <Textarea
              id="pr-purpose"
              rows={3}
              disabled={disabled}
              {...form.register('header.purpose')}
            />
          </div>
        </div>
      </section>

      <PrLinesTable
        form={form}
        disabled={disabled}
        baseCurrency={baseCurrency}
        units={unitOptions}
        offices={officeOptions}
        activities={activityOptions}
        budgetLines={lines}
        shortfalls={shortfalls}
      />
    </div>
  );
}
