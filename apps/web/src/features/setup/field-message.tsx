'use client';

import { useTranslations } from 'next-intl';
import type { FieldErrors } from './api';

/** Localized message for a field: server/Zod messages are English, so only their kind is shown. */
export function FieldMessage({
  errors,
  field,
  hint,
}: {
  errors: FieldErrors;
  field: string;
  /** message key under setup.validation for an invalid value (default: invalid) */
  hint?: string;
}) {
  const t = useTranslations('setup.validation');
  const error = errors[field];
  if (!error) return null;
  const key = error === 'already_exists' ? 'alreadyExists' : (hint ?? 'invalid');
  return (
    <p id={`${field}-error`} role="alert" className="text-sm text-destructive">
      {t(key)}
    </p>
  );
}
