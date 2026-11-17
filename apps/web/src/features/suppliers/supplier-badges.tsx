'use client';

import type { SupplierCompliance, SupplierStatus } from '@ngo/shared';
import { Badge } from '@ngo/ui';
import { useTranslations } from 'next-intl';

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const t = useTranslations('suppliers.status');
  const variant =
    status === 'approved'
      ? 'default'
      : status === 'blacklisted'
        ? 'destructive'
        : status === 'suspended'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{t(status)}</Badge>;
}

/** Warnings that block award and payment (overdue vetting, expired required document). */
export function ComplianceBadges({ compliance }: { compliance: SupplierCompliance }) {
  const t = useTranslations('suppliers.compliance');
  if (!compliance.vettingOverdue && !compliance.hasExpiredRequiredDoc) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {compliance.vettingOverdue ? (
        <Badge variant="outline" className="border-warning text-foreground">
          {t('vettingOverdue')}
        </Badge>
      ) : null}
      {compliance.hasExpiredRequiredDoc ? (
        <Badge variant="outline" className="border-warning text-foreground">
          {t('expiredDocument')}
        </Badge>
      ) : null}
    </span>
  );
}
