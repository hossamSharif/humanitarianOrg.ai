'use client';

// Step actions on any 002 document's detail page: sign the current step (the confirmation shows
// the name and position stored with the signature), reject or return with a reason, reassign a
// step and cancel with a reason. Only the actions in the detail response's `availableActions`
// are rendered; type-specific actions go in `children`.
import type { DocStepView, DocTypeSlug } from '@ngo/shared';
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
import { Ban, CheckCircle2, CornerUpLeft, UserCog, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { useApproveDoc, useCancelDoc, useRejectDoc, useReturnDoc } from './api';
import { ReasonDialog } from './reason-dialog';
import { ReassignStepDialog } from './reassign-step-dialog';

/** What the panel needs from a detail response. */
export interface ActionableDoc {
  id: string;
  version: number;
  currentStepOrder: number | null;
  steps: readonly DocStepView[];
  availableActions: readonly string[];
}

type Open = 'approve' | 'reject' | 'return' | 'cancel' | 'reassign' | null;

export function ActionsPanel({
  slug,
  doc,
  children,
}: {
  slug: DocTypeSlug;
  doc: ActionableDoc;
  children?: ReactNode;
}) {
  const t = useTranslations('documents.actions');
  const tk = useTranslations('documents.steps.kind');
  const tc = useTranslations('common');
  const locale = useLocale();
  const apiError = useApiError();
  const { data: me } = useMe();
  const approve = useApproveDoc(slug, doc.id);
  const reject = useRejectDoc(slug, doc.id);
  const ret = useReturnDoc(slug, doc.id);
  const cancel = useCancelDoc(slug, doc.id);
  const [open, setOpen] = useState<Open>(null);
  const [comment, setComment] = useState('');

  const step = doc.steps.find(
    (s) => s.status === 'pending' && s.stepOrder === doc.currentStepOrder
  );
  const can = (a: string) => doc.availableActions.includes(a);
  const stepAction = can('approve') || can('reject') || can('return');
  if (!stepAction && !can('reassign') && !can('cancel') && !children) return null;

  const openDialog = (which: Open) => {
    for (const m of [approve, reject, ret, cancel]) m.reset();
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
        expectedVersion: doc.version,
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
      .mutateAsync({ expectedVersion: doc.version, stepId: step.id, reason })
      .catch(() => null);
    if (done) setOpen(null);
  }

  async function cancelDoc(reason: string) {
    const done = await cancel
      .mutateAsync({ expectedVersion: doc.version, reason })
      .catch(() => null);
    if (done) setOpen(null);
  }

  return (
    <section aria-labelledby="doc-actions" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 id="doc-actions" className="text-lg font-semibold">
        {step && stepAction ? t('titleStep', { step: tk(step.kind) }) : t('title')}
      </h2>

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
        {can('reassign') ? (
          <Button type="button" variant="outline" onClick={() => openDialog('reassign')}>
            <UserCog className="me-2 h-4 w-4" aria-hidden />
            {t('reassign.open')}
          </Button>
        ) : null}
        {can('cancel') ? (
          <Button type="button" variant="outline" onClick={() => openDialog('cancel')}>
            <Ban className="me-2 h-4 w-4" aria-hidden />
            {t('cancel')}
          </Button>
        ) : null}
        {children}
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
            <Label htmlFor="doc-approve-comment">{t('comment')}</Label>
            <Input
              id="doc-approve-comment"
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
      <ReasonDialog
        open={open === 'cancel'}
        onOpenChange={close}
        title={t('cancelTitle')}
        description={t('cancelIntro')}
        confirmLabel={t('cancel')}
        destructive
        busy={cancel.isPending}
        error={cancel.error ? apiError(cancel.error) : null}
        onConfirm={(reason) => void cancelDoc(reason)}
      />
      {can('reassign') ? (
        <ReassignStepDialog open={open === 'reassign'} onOpenChange={close} slug={slug} doc={doc} />
      ) : null}
    </section>
  );
}
