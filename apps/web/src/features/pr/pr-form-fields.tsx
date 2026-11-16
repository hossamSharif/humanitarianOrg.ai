'use client';

// Small pieces shared by the PR header form and the lines table.
import { useTranslations } from 'next-intl';
import type { FieldError as RhfFieldError } from 'react-hook-form';

/** Select value standing for "no value" (Radix Select items cannot have an empty value). */
export const NONE = '__none__';

export interface Option {
  value: string;
  label: string;
}

/** Messages raised by form-model.ts's submit schema; anything else reads as "required/invalid". */
const KNOWN = new Set(['required_by_before_pr_date', 'no_lines']);

export function FieldError({ error }: { error?: Pick<RhfFieldError, 'message' | 'type'> }) {
  const t = useTranslations('pr.form.errors');
  if (!error) return null;
  const key =
    error.message && KNOWN.has(error.message)
      ? error.message
      : error.type === 'invalid_type'
        ? 'required'
        : 'invalid';
  return (
    <p role="alert" className="text-xs text-destructive">
      {t(key)}
    </p>
  );
}
