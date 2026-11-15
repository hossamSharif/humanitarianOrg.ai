'use client';

// One PR approval rule (DoA, FR-019): Finance Check locked as step 1 (FR-035), optional ordered
// approval steps, then Final Approval as amount bands in the DoA reference currency. Bands are
// edited as "up to" limits, so they are contiguous by construction: each band starts where the
// previous one ends and the last is open-ended. The API still validates everything.
import {
  formatAmount,
  parseAmount,
  type ApprovalRule,
  type ApprovalRuleBodyInput,
  type ApprovalRuleIssue,
} from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@ngo/ui';
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useBilingual, useOffices, useRoles } from '@/features/users/api';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useSaveApprovalRule } from './api';

export interface Band {
  roleId: string;
  /** upper limit, inclusive; ignored for the last (open-ended) band */
  maxAmount: string;
}

export interface RuleDraft {
  id?: string;
  officeId: string | null;
  name: string;
  isActive: boolean;
  financeRoleId: string;
  approvalRoleIds: string[];
  bands: Band[];
}

export function draftFromRule(rule: ApprovalRule): RuleDraft {
  const byOrder = [...rule.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const finals = byOrder
    .filter((s) => s.kind === 'final_approval')
    .sort((a, b) => parseAmount(a.minAmount ?? '0').comparedTo(parseAmount(b.minAmount ?? '0')));
  return {
    id: rule.id,
    officeId: rule.officeId,
    name: rule.name,
    isActive: rule.isActive,
    financeRoleId: byOrder.find((s) => s.kind === 'finance_check')?.roleId ?? '',
    approvalRoleIds: byOrder.filter((s) => s.kind === 'approval').map((s) => s.roleId),
    bands: finals.length
      ? finals.map((s) => ({ roleId: s.roleId, maxAmount: s.maxAmount ?? '' }))
      : [{ roleId: '', maxAmount: '' }],
  };
}

export function draftToBody(draft: RuleDraft): ApprovalRuleBodyInput {
  const finalOrder = draft.approvalRoleIds.length + 2;
  return {
    officeId: draft.officeId,
    name: draft.name,
    isActive: draft.isActive,
    steps: [
      { stepOrder: 1, kind: 'finance_check', roleId: draft.financeRoleId },
      ...draft.approvalRoleIds.map((roleId, i) => ({
        stepOrder: i + 2,
        kind: 'approval' as const,
        roleId,
      })),
      ...draft.bands.map((band, i) => ({
        stepOrder: finalOrder,
        kind: 'final_approval' as const,
        roleId: band.roleId,
        minAmount: i === 0 ? null : draft.bands[i - 1]!.maxAmount || null,
        maxAmount: i === draft.bands.length - 1 ? null : band.maxAmount || null,
      })),
    ],
  };
}

const ORG_WIDE = '__org';

function RoleSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (roleId: string) => void;
  label: string;
}) {
  const t = useTranslations('approvalRules');
  const name = useBilingual();
  const { data: roles } = useRoles();
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-64" aria-label={label}>
        <SelectValue placeholder={t('chooseRole')} />
      </SelectTrigger>
      <SelectContent>
        {roles?.data.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {name(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RuleEditor({
  initial,
  currency,
  takenOfficeIds,
  onSaved,
  onCancel,
}: {
  initial: RuleDraft;
  /** DoA reference currency, shown next to band limits */
  currency: string;
  /** offices that already have a rule (excluded from the scope selector) */
  takenOfficeIds: readonly string[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('approvalRules');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const name = useBilingual();
  const { data: offices } = useOffices();
  const save = useSaveApprovalRule();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [issues, setIssues] = useState<ApprovalRuleIssue[]>([]);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const finalOrder = draft.approvalRoleIds.length + 2;

  function moveApproval(index: number, delta: number) {
    const list = [...draft.approvalRoleIds];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item!);
    set('approvalRoleIds', list);
  }

  function setBand(index: number, band: Partial<Band>) {
    set(
      'bands',
      draft.bands.map((b, i) => (i === index ? { ...b, ...band } : b))
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIssues([]);
    try {
      await save.mutateAsync({ id: draft.id, body: draftToBody(draft) });
      toast({ description: t('saved') });
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'APPROVAL_RULE_INVALID') {
        const details = err.details as { issues?: ApprovalRuleIssue[] } | undefined;
        setIssues(details?.issues ?? []);
        return;
      }
      toast({ variant: 'destructive', description: apiError(err) });
    }
  }

  const scopeOffices = offices?.data.filter(
    (o) => o.id === draft.officeId || !takenOfficeIds.includes(o.id)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {draft.officeId === null
            ? t('orgWideRule')
            : t('officeRule', {
                office: name(
                  offices?.data.find((o) => o.id === draft.officeId) ?? { nameAr: '', nameEn: '' }
                ),
              })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`rule-name-${draft.id ?? 'new'}`}>{t('name')}</Label>
              <Input
                id={`rule-name-${draft.id ?? 'new'}`}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('scope')}</Label>
              <Select
                value={draft.officeId ?? ORG_WIDE}
                onValueChange={(v) => set('officeId', v === ORG_WIDE ? null : v)}
                // the organization-wide rule always exists; it cannot become an office rule
                disabled={initial.id !== undefined && initial.officeId === null}
              >
                <SelectTrigger aria-label={t('scope')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {initial.officeId === null ? (
                    <SelectItem value={ORG_WIDE}>{t('orgWide')}</SelectItem>
                  ) : null}
                  {scopeOffices?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.code} — {name(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.isActive}
              onCheckedChange={(on) => set('isActive', on === true)}
            />
            {t('active')}
          </label>

          <ol className="space-y-4">
            <li className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('stepLabel', { order: 1 })} · {t('kinds.finance_check')}
              </div>
              <p className="text-xs text-muted-foreground">{t('financeLocked')}</p>
              <RoleSelect
                value={draft.financeRoleId}
                onChange={(v) => set('financeRoleId', v)}
                label={t('requiredRole')}
              />
            </li>

            {draft.approvalRoleIds.map((roleId, i) => (
              <li key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {t('stepLabel', { order: i + 2 })} · {t('kinds.approval')}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      aria-label={t('moveUp')}
                      onClick={() => moveApproval(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={i === draft.approvalRoleIds.length - 1}
                      aria-label={t('moveDown')}
                      onClick={() => moveApproval(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('removeStep')}
                      onClick={() =>
                        set(
                          'approvalRoleIds',
                          draft.approvalRoleIds.filter((_, j) => j !== i)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <RoleSelect
                  value={roleId}
                  onChange={(v) =>
                    set(
                      'approvalRoleIds',
                      draft.approvalRoleIds.map((r, j) => (j === i ? v : r))
                    )
                  }
                  label={t('requiredRole')}
                />
              </li>
            ))}

            <li>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set('approvalRoleIds', [...draft.approvalRoleIds, ''])}
              >
                <Plus className="me-2 h-4 w-4" aria-hidden />
                {t('addApprovalStep')}
              </Button>
            </li>

            <li className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-semibold">
                {t('stepLabel', { order: finalOrder })} · {t('kinds.final_approval')}
              </div>
              <p className="text-xs text-muted-foreground">{t('bandsIntro', { currency })}</p>
              {draft.bands.map((band, i) => {
                const last = i === draft.bands.length - 1;
                const prevMax = i === 0 ? '0' : draft.bands[i - 1]!.maxAmount;
                // mid-typing values such as '5000.' are shown as typed
                const from = /^\d+(\.\d+)?$/.test(prevMax)
                  ? formatAmount({ amount: prevMax, currency }, { withCurrency: false })
                  : prevMax || '…';
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    {last ? (
                      <span className="w-full text-sm sm:w-64">
                        {i === 0 ? t('anyAmount') : t('above', { amount: from, currency })}
                      </span>
                    ) : (
                      <div className="flex w-full items-center gap-2 sm:w-64">
                        <span className="text-sm">{t('upTo')}</span>
                        <MoneyInput
                          value={band.maxAmount}
                          onChange={(v) => setBand(i, { maxAmount: v })}
                          currency={currency}
                          aria-label={t('upTo')}
                        />
                      </div>
                    )}
                    <RoleSelect
                      value={band.roleId}
                      onChange={(v) => setBand(i, { roleId: v })}
                      label={t('requiredRole')}
                    />
                    {draft.bands.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('removeBand')}
                        onClick={() =>
                          set(
                            'bands',
                            draft.bands.filter((_, j) => j !== i)
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set('bands', [
                    ...draft.bands.slice(0, -1),
                    { roleId: '', maxAmount: '' },
                    draft.bands[draft.bands.length - 1]!,
                  ])
                }
              >
                <Plus className="me-2 h-4 w-4" aria-hidden />
                {t('addBand')}
              </Button>
            </li>
          </ol>

          {issues.length ? (
            <ul role="alert" className="list-disc space-y-1 ps-5 text-sm text-destructive">
              {issues.map((issue, i) => (
                <li key={i}>
                  {t.has(`issues.${issue.reason}`)
                    ? t(`issues.${issue.reason}`)
                    : t('issues.unknown')}
                  {issue.stepOrder ? ` (${t('stepLabel', { order: issue.stepOrder })})` : ''}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex justify-end gap-2">
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel}>
                {tCommon('cancel')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
