'use client';

import {
  BUDGET_CATEGORIES,
  budgetLineCreate,
  type BudgetCategory,
  type BudgetLine,
} from '@ngo/shared';
import {
  Button,
  Checkbox,
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
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useOffices, useSaveBudgetLine } from './api';
import {
  Amount,
  ErrorText,
  Field,
  apiFieldErrors,
  useLocalizedName,
  zodFieldErrors,
  type FieldErrors,
} from './shared';

const NO_OFFICE = 'none';

interface LineForm {
  code: string;
  description: string;
  category: BudgetCategory;
  budgetAmount: string;
  officeId: string;
  isActive: boolean;
}

const EMPTY: LineForm = {
  code: '',
  description: '',
  category: 'supplies',
  budgetAmount: '',
  officeId: NO_OFFICE,
  isActive: true,
};

export function BudgetLineDialog({
  open,
  onOpenChange,
  grantId,
  currency,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grantId: string;
  currency: string;
  /** edit this line; create when omitted */
  line?: BudgetLine;
}) {
  const t = useTranslations('budgetLines');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const offices = useOffices();
  const save = useSaveBudgetLine(grantId);
  const [form, setForm] = useState<LineForm>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setForm(
        line
          ? {
              code: line.code,
              description: line.description,
              category: line.category,
              budgetAmount: line.budgetAmount,
              officeId: line.officeId ?? NO_OFFICE,
              isActive: line.isActive,
            }
          : EMPTY
      );
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line]);

  const set = <K extends keyof LineForm>(key: K, value: LineForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = budgetLineCreate.safeParse({
      code: form.code,
      description: form.description,
      category: form.category,
      budgetAmount: form.budgetAmount,
      officeId: form.officeId === NO_OFFICE ? null : form.officeId,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync(
        line
          ? {
              id: line.id,
              body: {
                ...parsed.data,
                // send the amount only when it changed, so other edits never hit FR-014
                budgetAmount:
                  parsed.data.budgetAmount === line.budgetAmount
                    ? undefined
                    : parsed.data.budgetAmount,
                isActive: form.isActive,
                expectedVersion: line.version,
              },
            }
          : { body: parsed.data }
      );
      onOpenChange(false);
    } catch (err) {
      setErrors(apiFieldErrors(err));
    }
  }

  const belowUsage =
    save.error instanceof ApiRequestError && save.error.code === 'BUDGET_BELOW_USAGE'
      ? (save.error.details as { minimum?: string } | undefined)?.minimum
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{line ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="line-code" label={t('code')} error={errors.code}>
              <Input
                id="line-code"
                dir="ltr"
                value={form.code}
                onChange={(e) => set('code', e.target.value)}
                aria-invalid={errors.code ? true : undefined}
              />
            </Field>
            <Field id="line-category" label={t('category')} error={errors.category}>
              <Select
                value={form.category}
                onValueChange={(v) => set('category', v as BudgetCategory)}
              >
                <SelectTrigger id="line-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`categories.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field id="line-description" label={t('description')} error={errors.description}>
            <Input
              id="line-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              aria-invalid={errors.description ? true : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="line-amount" label={t('budgetAmount')} error={errors.budgetAmount}>
              <MoneyInput
                id="line-amount"
                value={form.budgetAmount}
                onChange={(v) => set('budgetAmount', v)}
                currency={currency}
                aria-invalid={errors.budgetAmount || belowUsage ? true : undefined}
              />
            </Field>
            <Field id="line-office" label={t('office')}>
              <Select value={form.officeId} onValueChange={(v) => set('officeId', v)}>
                <SelectTrigger id="line-office">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OFFICE}>{t('noOffice')}</SelectItem>
                  {(offices.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.code} · {localized(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {line ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="line-active"
                checked={form.isActive}
                onCheckedChange={(v) => set('isActive', v === true)}
              />
              <Label htmlFor="line-active">{t('active')}</Label>
            </div>
          ) : null}

          {belowUsage ? (
            <ErrorText>
              {t('belowUsage')} <Amount value={belowUsage} currency={currency} />
            </ErrorText>
          ) : save.error && Object.keys(errors).length === 0 ? (
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
