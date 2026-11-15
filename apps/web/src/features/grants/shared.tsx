'use client';

// Small pieces shared by the donor, grant, budget-line and rate screens.
import { formatAmount, type GrantStatus } from '@ngo/shared';
import { Badge, Label, cn } from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ZodError } from 'zod';
import { ApiRequestError } from '@/lib/api-client';

/** Field → message key (`grants.fieldErrors.<key>`). */
export type FieldErrors = Record<string, string>;

/** Client-side check with the shared Zod schema: first issue per top-level field. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    out[field] ??= 'invalid';
  }
  return out;
}

/** Server VALIDATION_ERROR details mapped to the same field keys ('already_exists', …). */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_ERROR') return {};
  const out: FieldErrors = {};
  if (Array.isArray(error.details)) {
    for (const d of error.details as { field?: string; message?: string }[]) {
      if (!d.field) continue;
      const known = ['already_exists', 'not_found', 'before_start_date'];
      out[d.field] ??= known.includes(d.message ?? '') ? d.message! : 'invalid';
    }
  }
  return out;
}

export function Field({
  id,
  label,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('grants.fieldErrors');
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {t.has(error) ? t(error) : t('invalid')}
        </p>
      ) : null}
    </div>
  );
}

/** '870,710.00 SDG' — Latin digits, code after the amount. */
export function Amount({ value, currency }: { value: string; currency: string }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount({ amount: value, currency })}
    </span>
  );
}

export function GrantStatusBadge({ status }: { status: GrantStatus }) {
  const t = useTranslations('grants.status');
  const variant =
    status === 'active' ? 'default' : status === 'suspended' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(status)}</Badge>;
}

/** Arabic or English name by UI locale. */
export function useLocalizedName() {
  const locale = useLocale();
  return (item: { nameAr: string; nameEn: string }) =>
    locale === 'ar' ? item.nameAr : item.nameEn;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

/** Non-blocking warning (FR-013 difference, FR-022 pending PRs). */
export function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
    >
      {children}
    </div>
  );
}
