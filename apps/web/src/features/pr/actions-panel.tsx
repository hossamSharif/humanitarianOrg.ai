'use client';

// Step actions on the PR detail page (US5): sign the current step (the confirmation shows the
// name and position that will be stored with the signature), reject or return with a reason,
// change a line's budget line during the finance check, and reassign a step. Only the actions in
// `availableActions` are rendered; a frozen grant shows a banner and hides Approve (FR-022).
import type { PrDetail } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@ngo/ui';
import { CheckCircle2, CornerUpLeft, Replace, UserCog, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { useApprovePr, useRejectPr, useReturnPr } from './api';
import { ChangeBudgetLineDialog } from './change-budget-line-dialog';
import { ReasonDialog } from './reason-dialog';
import { ReassignStepDialog } from './reassign-step-dialog';

type Open = 'approve' | 'reject' | 'return' | 'budget-line' | 'reassign' | null;

export function ActionsPanel({ pr }: { pr: PrDetail }) {
  const t = useTranslations('pr.actions');
  const tf = useTranslations('pr.frozen');
  const tk = useTranslations('pr.steps.kind');
  const tc = useTranslations('common');
  const locale = useLocale();
  const apiError = useApiError();
  const { data: me } = useMe();
  const approve = useApprovePr(pr.id);
  const reject = useRejectPr(pr.id);
  const ret = useReturnPr(pr.id);
  const [open, setOpen] = useState<Open>(null);
  const [comment, setComment] = useState('');

  const step = pr.steps.find((s) => s.status === 'pending' && s.stepOrder === pr.currentStepOrder);
  const can = (a: PrDetail['availableActions'][number]) => pr.availableActions.includes(a);
  const anyAction =
    can('approve') ||
    can('reject') ||
    can('return') ||
    can('change_budget_line') ||
    can('reassign');

  if (!anyAction && !pr.grantFrozen) return null;

  const openDialog = (which: Open) => {
    approve.reset();
    reject.reset();
    ret.reset();
    setComment('');
    setOpen(which);
  };
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  const signerName = locale === 'ar' ? me?.membership?.fullNameAr : me?.membership?.fullNameEn;

  async function sign() {
    if (!step) return;
    const done = await approve
      .mutateAsync({
        expectedVersion: pr.version,
        stepId: step.id,
        comment: comment.trim() || null,
      })
      .catch(() => null);
    if (done) setOpen(null);
  }

  async function withReason(action: 'reject' | 'return', reason: string) {
    if (!step) return;
    const mutation = action === 'reject' ? reject : ret;
    const done = await mutation
      .mutateAsync({ expectedVersion: pr.version, stepId: step.id, reason })
      .catch(() => null);
    if (done) setOpen(null);
  }

  return (
    <section aria-labelledby="pr-actions" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 id="pr-actions" className="text-lg font-semibold">
        {step ? t('titleStep', { step: tk(step.kind) }) : t('title')}
      </h2>

      {pr.grantFrozen ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="font-medium">{tf('title')}</p>
          <p>{tf('body')}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {can('approve') ? (
          <Button type="button" onClick={() => openDialog('approve')}>
            <CheckCircle2 className="me-2 h-4 w-4" aria-hidden />
            {t('approve')}
          </Button>
        ) : null}
        {can('return') ? (
          <Button type="button" variant="outline" onClick={() => openDialog('return')}>
            <CornerUpLeft className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {t('return')}
          </Button>
        ) : null}
        {can('reject') ? (
          <Button type="button" variant="destructive" onClick={() => openDialog('reject')}>
            <XCircle className="me-2 h-4 w-4" aria-hidden />
            {t('reject')}
          </Button>
        ) : null}
        {can('change_budget_line') ? (
          <Button type="button" variant="outline" onClick={() => openDialog('budget-line')}>
            <Replace className="me-2 h-4 w-4" aria-hidden />
            {t('changeBudgetLine.open')}
          </Button>
        ) : null}
        {can('reassign') ? (
          <Button type="button" variant="outline" onClick={() => openDialog('reassign')}>
            <UserCog className="me-2 h-4 w-4" aria-hidden />
            {t('reassign.open')}
          </Button>
        ) : null}
      </div>

      <Dialog open={open === 'approve'} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('approveTitle')}</DialogTitle>
            <DialogDescription>{t('approveIntro')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="text-muted-foreground">{t('signingAs')}</p>
            <p className="font-medium" dir="auto">
              {signerName}
            </p>
            {me?.membership?.positionTitle ? <p dir="auto">{me.membership.positionTitle}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="approve-comment">{t('comment')}</Label>
            <Input
              id="approve-comment"
              dir="auto"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          {approve.error ? (
            <p role="alert" className="text-sm text-destructive">
              {apiError(approve.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(null)}>
              {tc('cancel')}
            </Button>
            <Button type="button" disabled={approve.isPending} onClick={() => void sign()}>
              {t('sign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={open === 'return'}
        onOpenChange={close}
        title={t('returnTitle')}
        description={t('returnIntro')}
        confirmLabel={t('return')}
        busy={ret.isPending}
        error={ret.error ? apiError(ret.error) : null}
        onConfirm={(reason) => void withReason('return', reason)}
      />
      <ReasonDialog
        open={open === 'reject'}
        onOpenChange={close}
        title={t('rejectTitle')}
        description={t('rejectIntro')}
        confirmLabel={t('reject')}
        destructive
        busy={reject.isPending}
        error={reject.error ? apiError(reject.error) : null}
        onConfirm={(reason) => void withReason('reject', reason)}
      />
      {can('change_budget_line') ? (
        <ChangeBudgetLineDialog open={open === 'budget-line'} onOpenChange={close} pr={pr} />
      ) : null}
      {can('reassign') ? (
        <ReassignStepDialog open={open === 'reassign'} onOpenChange={close} pr={pr} />
      ) : null}
    </section>
  );
}
