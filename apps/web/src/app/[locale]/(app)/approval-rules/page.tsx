'use client';

import { useQuery } from '@tanstack/react-query';
import { DOA_TYPES, type DoaType } from '@ngo/shared';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApprovalRules } from '@/features/approval-rules/api';
import { RulePreview } from '@/features/approval-rules/rule-preview';
import {
  RuleEditor,
  draftFromRule,
  emptyDraft,
  type RuleDraft,
} from '@/features/approval-rules/rule-editor';
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
  const [docType, setDocType] = useState<DoaType>('PR');
  const { data, isLoading, error } = useApprovalRules(docType);
  const { data: offices } = useOffices();
  const [adding, setAdding] = useState<RuleDraft | null>(null);

  const rules = data?.data ?? [];
  const takenOfficeIds = rules.flatMap((r) => (r.officeId ? [r.officeId] : []));
  const freeOffice = offices?.data.find((o) => !takenOfficeIds.includes(o.id));
  const orgRule = rules.find((r) => r.officeId === null);
  const typeLabel = t(`docTypes.${docType}`);

  function startOfficeRule() {
    if (!freeOffice) return;
    const base = orgRule ? draftFromRule(orgRule) : null;
    const name = `${typeLabel} — ${freeOffice.code}`;
    setAdding(
      base
        ? { ...base, id: undefined, officeId: freeOffice.id, name, isActive: true }
        : emptyDraft(docType, freeOffice.id, name)
    );
  }

  function startOrgRule() {
    setAdding(emptyDraft(docType, null, `${typeLabel} — ${t('orgWide')}`));
  }

  function changeType(value: string) {
    setDocType(value as DoaType);
    setAdding(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isLoading && !orgRule ? (
            <Button variant="outline" onClick={startOrgRule} disabled={adding !== null}>
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('addOrgRule')}
            </Button>
          ) : null}
          <Button onClick={startOfficeRule} disabled={!freeOffice || adding !== null}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('addOfficeRule')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rule-doc-type">{t('docType')}</Label>
        <Select value={docType} onValueChange={changeType}>
          <SelectTrigger id="rule-doc-type" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOA_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`docTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiError(error)}
        </p>
      ) : null}
      {isLoading ? <p>{tCommon('loading')}</p> : null}

      <RulePreview key={docType} currency={currency} docType={docType} />

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
