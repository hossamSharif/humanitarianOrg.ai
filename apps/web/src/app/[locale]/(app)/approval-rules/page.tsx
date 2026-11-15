'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApprovalRules } from '@/features/approval-rules/api';
import { RulePreview } from '@/features/approval-rules/rule-preview';
import { RuleEditor, draftFromRule, type RuleDraft } from '@/features/approval-rules/rule-editor';
import { useOffices } from '@/features/users/api';
import { api } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';

/** DoA reference currency from the organization profile (US1); USD until it loads. */
function useDoaCurrency(): string {
  const { data } = useQuery({
    queryKey: ['tenant'],
    queryFn: () => api.get<{ doaReferenceCurrency: string }>('/tenant'),
  });
  return data?.doaReferenceCurrency ?? 'USD';
}

export default function ApprovalRulesPage() {
  const t = useTranslations('approvalRules');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const currency = useDoaCurrency();
  const { data, isLoading, error } = useApprovalRules();
  const { data: offices } = useOffices();
  const [adding, setAdding] = useState<RuleDraft | null>(null);

  const rules = data?.data ?? [];
  const takenOfficeIds = rules.flatMap((r) => (r.officeId ? [r.officeId] : []));
  const freeOffice = offices?.data.find((o) => !takenOfficeIds.includes(o.id));
  const orgRule = rules.find((r) => r.officeId === null);

  function startOfficeRule() {
    if (!freeOffice) return;
    const base = orgRule ? draftFromRule(orgRule) : null;
    setAdding({
      officeId: freeOffice.id,
      name: `${t('officeRulePrefix')} ${freeOffice.code}`,
      isActive: true,
      financeRoleId: base?.financeRoleId ?? '',
      approvalRoleIds: base?.approvalRoleIds ?? [],
      bands: base?.bands ?? [{ roleId: '', maxAmount: '' }],
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <Button onClick={startOfficeRule} disabled={!freeOffice || adding !== null}>
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {t('addOfficeRule')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiError(error)}
        </p>
      ) : null}
      {isLoading ? <p>{tCommon('loading')}</p> : null}

      <RulePreview currency={currency} />

      {adding ? (
        <RuleEditor
          initial={adding}
          currency={currency}
          takenOfficeIds={takenOfficeIds}
          onSaved={() => setAdding(null)}
          onCancel={() => setAdding(null)}
        />
      ) : null}

      {rules.map((rule) => (
        <RuleEditor
          // remount after a save so the editor shows the stored rule
          key={`${rule.id}:${JSON.stringify(rule.steps)}:${rule.name}:${rule.isActive}`}
          initial={draftFromRule(rule)}
          currency={currency}
          takenOfficeIds={takenOfficeIds}
        />
      ))}
    </div>
  );
}
