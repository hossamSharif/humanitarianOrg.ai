'use client';

// Reassign an open step to one eligible user (pr:reassign, FR-039); a reason is required.
import type { PrDetail } from '@ngo/shared';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useReassignStep, useStepEligibleUsers } from './api';
import { ReasonDialog } from './reason-dialog';

export function ReassignStepDialog({
  open,
  onOpenChange,
  pr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pr: PrDetail;
}) {
  const t = useTranslations('pr.actions.reassign');
  const tk = useTranslations('pr.steps.kind');
  const locale = useLocale();
  const apiError = useApiError();
  const openSteps = pr.steps.filter((s) => s.status === 'pending' || s.status === 'waiting');
  const [stepId, setStepId] = useState('');
  const [userId, setUserId] = useState('');
  const users = useStepEligibleUsers(pr.id, open && stepId ? stepId : null);
  const reassign = useReassignStep(pr.id);

  useEffect(() => {
    if (open) {
      setStepId(openSteps.find((s) => s.status === 'pending')?.id ?? openSteps[0]?.id ?? '');
      reassign.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setUserId(''), [stepId]);

  async function confirm(reason: string) {
    const done = await reassign
      .mutateAsync({ stepId, expectedVersion: pr.version, userId, reason })
      .catch(() => null);
    if (done) onOpenChange(false);
  }

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('intro')}
      confirmLabel={t('confirm')}
      busy={reassign.isPending || !userId}
      error={reassign.error ? apiError(reassign.error) : null}
      onConfirm={(reason) => void confirm(reason)}
    >
      <div className="space-y-1.5">
        <Label htmlFor="reassign-step">{t('step')}</Label>
        <Select value={stepId} onValueChange={setStepId}>
          <SelectTrigger id="reassign-step">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {openSteps.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.stepOrder}. {tk(s.kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reassign-user">{t('user')}</Label>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger id="reassign-user">
            <SelectValue placeholder={users.isLoading ? t('loadingUsers') : t('userPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {(users.data ?? []).map((u) => (
              <SelectItem key={u.userId} value={u.userId}>
                <span dir="auto">{locale === 'ar' ? u.nameAr : u.nameEn}</span>
                {u.position ? (
                  <span className="text-xs text-muted-foreground"> — {u.position}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {users.data && users.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noUsers')}</p>
        ) : null}
      </div>
    </ReasonDialog>
  );
}
