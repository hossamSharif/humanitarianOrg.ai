'use client';

// Submit (US4): checks the form with the shared rules, saves pending edits, then submits with the
// saved version. BUDGET_EXCEEDED marks the failing lines with their shortfall in the grant
// currency; other errors are shown by code (EXCHANGE_RATE_MISSING names the currencies and
// asks the user to contact Finance).
import {
  formatAmount,
  formatDate,
  type BudgetShortfallLine,
  type PrSubmitResult,
} from '@ngo/shared';
import { Button } from '@ngo/ui';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldPath, UseFormReturn } from 'react-hook-form';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useSubmitPr } from './api';
import type { PrFormValues } from './form-model';
import type { Autosave } from './use-autosave';

export function SubmitButton({
  prId,
  form,
  autosave,
  onShortfalls,
  onSubmitted,
}: {
  prId: string;
  form: UseFormReturn<PrFormValues>;
  autosave: Autosave;
  /** line id → message, cleared with an empty map */
  onShortfalls: (lines: Map<string, string>) => void;
  onSubmitted: (result: PrSubmitResult) => void;
}) {
  const t = useTranslations('pr.submit');
  const apiError = useApiError();
  const submit = useSubmitPr(prId);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function describe(err: unknown): string {
    if (!(err instanceof ApiRequestError)) return apiError(err);
    if (err.code === 'EXCHANGE_RATE_MISSING') {
      const d = err.details as { currencies: string[]; date: string };
      return t('rateMissing', { currencies: d.currencies.join(', '), date: formatDate(d.date) });
    }
    if (err.code === 'PR_DATE_OUT_OF_RANGE') {
      const d = err.details as { earliest: string; latest: string };
      return t('dateOutOfRange', {
        earliest: formatDate(d.earliest),
        latest: formatDate(d.latest),
      });
    }
    if (err.code === 'NO_ELIGIBLE_APPROVER') {
      const d = err.details as { stepOrder: number; roleName: string };
      return t('noApprover', { step: d.stepOrder, role: d.roleName });
    }
    return apiError(err);
  }

  /** server VALIDATION_ERROR fields ('header.prType', 'lines.0.unitId') onto the form */
  function showFieldErrors(err: ApiRequestError): boolean {
    if (err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return false;
    for (const d of err.details as { field?: string; message?: string }[]) {
      if (d.field?.startsWith('header.') || d.field?.startsWith('lines.')) {
        form.setError(d.field as FieldPath<PrFormValues>, { type: 'invalid_type' });
      }
    }
    return true;
  }

  const onValid = async () => {
    setBusy(true);
    setMessage(null);
    onShortfalls(new Map());
    try {
      const version = await autosave.flush();
      const result = await submit.mutateAsync(version);
      autosave.discard();
      onSubmitted(result);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'BUDGET_EXCEEDED') {
        const lines = (err.details as { lines: BudgetShortfallLine[] }).lines;
        const byLine = new Map<string, string>();
        for (const l of lines) {
          const text = t('shortfall', {
            code: l.code,
            shortfall: formatAmount({ amount: l.shortfall, currency: l.currency }),
            available: formatAmount({ amount: l.available, currency: l.currency }),
          });
          for (const id of l.prLineIds) byLine.set(id, text);
        }
        onShortfalls(byLine);
        setMessage(t('budgetExceeded'));
      } else if (err instanceof ApiRequestError && showFieldErrors(err)) {
        setMessage(t('incomplete'));
      } else {
        setMessage(describe(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={busy}
        onClick={form.handleSubmit(onValid, () => setMessage(t('incomplete')))}
      >
        <Send className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
        {busy ? t('submitting') : t('submit')}
      </Button>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
