'use client';

// PR lines (field array): description, expandable specifications, quantity, unit, unit cost,
// calculated line total, currency, budget line of the grant with its Available, location and
// activity. Totals are shown per currency; nothing is parsed into a JS number (Principle V).
import {
  formatAmount,
  roundHalfUp,
  sumByCurrency,
  multiply,
  type BudgetLineWithBalance,
  type Money,
} from '@ngo/shared';
import {
  Button,
  Input,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@ngo/ui';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { emptyLine, type PrFormValues, type PrLineFormValues } from './form-model';
import { FieldError, NONE, type Option } from './pr-form-fields';

/** Currencies seeded in packages/database/migrations/0008_seed_reference.sql. */
export const LINE_CURRENCIES = ['SDG', 'USD', 'EUR', 'GBP', 'SAR'] as const;

const QUANTITY = /^\d+(\.\d+)?$/;
const AMOUNT = /^\d+(\.\d+)?$/;

export function lineTotalOf(line: Pick<PrLineFormValues, 'quantity' | 'unitCost'>): string | null {
  if (!QUANTITY.test(line.quantity) || !AMOUNT.test(line.unitCost)) return null;
  return roundHalfUp(multiply(line.quantity, line.unitCost), 2);
}

export function totalsOf(lines: readonly PrLineFormValues[]): Money[] {
  return sumByCurrency(
    lines.flatMap((l) => {
      const total = lineTotalOf(l);
      return total === null ? [] : [{ amount: total, currency: l.currency }];
    })
  );
}

export function PrLinesTable({
  form,
  disabled,
  baseCurrency,
  units,
  offices,
  activities,
  budgetLines,
  shortfalls,
}: {
  form: UseFormReturn<PrFormValues>;
  disabled?: boolean;
  baseCurrency: string;
  units: Option[];
  offices: Option[];
  activities: Option[];
  budgetLines: BudgetLineWithBalance[];
  /** line id → shortfall text from a BUDGET_EXCEEDED submit */
  shortfalls?: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('pr.lines');
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' }) ?? [];
  const deliverTo = useWatch({ control: form.control, name: 'header.deliverToOfficeId' });
  const errors = form.formState.errors.lines;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <section className="space-y-3" aria-labelledby="pr-lines-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pr-lines-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            append(emptyLine({ currency: baseCurrency, locationOfficeId: deliverTo ?? '' }))
          }
        >
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {t('add')}
        </Button>
      </div>

      {typeof errors?.message === 'string' || errors?.root ? (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.noLines')}
        </p>
      ) : null}
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}

      <ol className="space-y-3">
        {fields.map((field, index) => {
          const line = lines[index] ?? field;
          const lineErrors = errors?.[index];
          const total = lineTotalOf(line);
          const shortfall = line.id ? shortfalls?.get(line.id) : undefined;
          const budgetLine = budgetLines.find((b) => b.id === line.budgetLineId);
          const id = (name: string) => `line-${field.id}-${name}`;
          const open = expanded[field.id] ?? Boolean(line.specifications);
          return (
            <li
              key={field.id}
              className={cn(
                'rounded-lg border bg-card p-3 shadow-sm',
                shortfall && 'border-destructive ring-1 ring-destructive'
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {t('lineNo', { n: index + 1 })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  aria-label={t('remove', { n: index + 1 })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-6">
                  <Label htmlFor={id('description')}>{t('description')}</Label>
                  <Input
                    id={id('description')}
                    disabled={disabled}
                    aria-invalid={lineErrors?.description ? true : undefined}
                    {...form.register(`lines.${index}.description`)}
                  />
                  <FieldError error={lineErrors?.description} />
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    aria-expanded={open}
                    aria-controls={id('specifications')}
                    onClick={() => setExpanded((e) => ({ ...e, [field.id]: !open }))}
                  >
                    {open ? (
                      <ChevronUp className="h-3 w-3" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3 w-3" aria-hidden />
                    )}
                    {t('specifications')}
                  </button>
                  {open ? (
                    <Textarea
                      id={id('specifications')}
                      aria-label={t('specifications')}
                      rows={3}
                      disabled={disabled}
                      {...form.register(`lines.${index}.specifications`)}
                    />
                  ) : null}
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor={id('quantity')}>{t('quantity')}</Label>
                  <Controller
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field: f }) => (
                      <MoneyInput
                        id={id('quantity')}
                        maxDecimals={3}
                        value={f.value}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        disabled={disabled}
                        aria-invalid={lineErrors?.quantity ? true : undefined}
                      />
                    )}
                  />
                  <FieldError error={lineErrors?.quantity} />
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor={id('unit')}>{t('unit')}</Label>
                  <OptionSelect
                    id={id('unit')}
                    form={form}
                    name={`lines.${index}.unitId`}
                    options={units}
                    disabled={disabled}
                    invalid={Boolean(lineErrors?.unitId)}
                    placeholder={t('select')}
                  />
                  <FieldError error={lineErrors?.unitId} />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={id('unitCost')}>{t('unitCost')}</Label>
                  <Controller
                    control={form.control}
                    name={`lines.${index}.unitCost`}
                    render={({ field: f }) => (
                      <MoneyInput
                        id={id('unitCost')}
                        value={f.value}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        currency={line.currency}
                        disabled={disabled}
                        aria-invalid={lineErrors?.unitCost ? true : undefined}
                      />
                    )}
                  />
                  <FieldError error={lineErrors?.unitCost} />
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor={id('currency')}>{t('currency')}</Label>
                  <OptionSelect
                    id={id('currency')}
                    form={form}
                    name={`lines.${index}.currency`}
                    options={LINE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <span className="text-sm font-medium">{t('lineTotal')}</span>
                  <output
                    htmlFor={`${id('quantity')} ${id('unitCost')}`}
                    dir="ltr"
                    className="flex h-10 items-center justify-end rounded-md bg-muted px-3 text-sm font-medium tabular-nums"
                  >
                    {total === null
                      ? '—'
                      : formatAmount({ amount: total, currency: line.currency })}
                  </output>
                </div>

                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor={id('budgetLine')}>{t('budgetLine')}</Label>
                  <OptionSelect
                    id={id('budgetLine')}
                    form={form}
                    name={`lines.${index}.budgetLineId`}
                    options={budgetLines
                      .filter((b) => b.isActive || b.id === line.budgetLineId)
                      .map((b) => ({
                        value: b.id,
                        label: `${b.code} · ${b.description}`,
                      }))}
                    disabled={disabled || budgetLines.length === 0}
                    invalid={Boolean(lineErrors?.budgetLineId)}
                    placeholder={budgetLines.length ? t('select') : t('selectGrantFirst')}
                  />
                  {budgetLine ? (
                    <p className="text-xs text-muted-foreground">
                      {t('available', {
                        amount: formatAmount({
                          amount: budgetLine.available,
                          currency: budgetLine.currency,
                        }),
                      })}
                    </p>
                  ) : null}
                  <FieldError error={lineErrors?.budgetLineId} />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={id('location')}>{t('location')}</Label>
                  <OptionSelect
                    id={id('location')}
                    form={form}
                    name={`lines.${index}.locationOfficeId`}
                    options={offices}
                    disabled={disabled}
                    invalid={Boolean(lineErrors?.locationOfficeId)}
                    placeholder={t('select')}
                  />
                  <FieldError error={lineErrors?.locationOfficeId} />
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor={id('activity')}>{t('activity')}</Label>
                  <OptionSelect
                    id={id('activity')}
                    form={form}
                    name={`lines.${index}.activityId`}
                    options={activities}
                    disabled={disabled || activities.length === 0}
                    optional
                    noneLabel={t('none')}
                  />
                </div>
              </div>

              {shortfall ? (
                <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                  {shortfall}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <TotalsBar totals={totalsOf(lines)} />
    </section>
  );
}

export function TotalsBar({ totals }: { totals: Money[] }) {
  const t = useTranslations('pr.lines');
  if (totals.length === 0) return null;
  return (
    <dl className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg bg-muted px-4 py-3">
      {totals.map((m) => (
        <div key={m.currency} className="flex items-baseline gap-2">
          <dt className="text-sm text-muted-foreground">
            {t('totalIn', { currency: m.currency })}
          </dt>
          <dd dir="ltr" className="text-base font-semibold tabular-nums">
            {formatAmount(m)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Select bound to a string form field; optional fields map '' to a "none" item. */
export function OptionSelect({
  id,
  form,
  name,
  options,
  disabled,
  invalid,
  placeholder,
  optional,
  noneLabel,
  onValueChange,
}: {
  id: string;
  form: UseFormReturn<PrFormValues>;
  name: Parameters<UseFormReturn<PrFormValues>['register']>[0];
  options: Option[];
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  optional?: boolean;
  noneLabel?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string | null) ?? '';
        return (
          <Select
            value={optional ? value || NONE : value}
            onValueChange={(v) => {
              const next = v === NONE ? '' : v;
              field.onChange(next);
              onValueChange?.(next);
            }}
            disabled={disabled}
          >
            <SelectTrigger id={id} aria-invalid={invalid ? true : undefined} onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {optional ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }}
    />
  );
}
