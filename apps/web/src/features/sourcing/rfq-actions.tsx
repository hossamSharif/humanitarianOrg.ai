'use client';

// Issue, cancel and re-issue an RFQ (002 US3). Issuing with a splitting warning asks for the
// acknowledgement comment first (FR-053); cancel and re-issue need a reason.
import type { SourcingEventDetail } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { ErrorText } from '@/features/grants/shared';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useCancelRfq, useIssueRfq, useReissueRfq } from './api';

export function RfqActions({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.actions');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const issue = useIssueRfq(event.id);
  const cancel = useCancelRfq(event.id);
  const reissue = useReissueRfq(event.id);
  const [dialog, setDialog] = useState<'issue' | 'cancel' | 'reissue' | null>(null);
  const [comment, setComment] = useState('');
  const can = (a: string) => event.availableActions.includes(a as never);
  const needsAck = !!event.splittingWarning && !event.splittingAcknowledged;

  const doIssue = () =>
    issue.mutate(
      {
        expectedVersion: event.version,
        ...(needsAck ? { splittingAcknowledgement: { comment: comment.trim() } } : {}),
      },
      { onSuccess: () => setDialog(null) }
    );

  if (!can('issue') && !can('cancel') && !can('reissue')) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {can('issue') ? (
        <Button
          onClick={() => {
            setComment('');
            issue.reset();
            setDialog('issue');
          }}
        >
          {t('issue')}
        </Button>
      ) : null}
      {can('reissue') ? (
        <Button variant="outline" onClick={() => setDialog('reissue')}>
          {t('reissue')}
        </Button>
      ) : null}
      {can('cancel') ? (
        <Button variant="outline" onClick={() => setDialog('cancel')}>
          {t('cancel')}
        </Button>
      ) : null}

      <Dialog open={dialog === 'issue'} onOpenChange={(o) => setDialog(o ? 'issue' : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('issueTitle')}</DialogTitle>
            <DialogDescription>{t('issueIntro')}</DialogDescription>
          </DialogHeader>
          {needsAck ? (
            <div className="space-y-1.5">
              <p className="text-sm">
                {t('splittingPrompt', {
                  total: event.splittingWarning!.total,
                  max: event.splittingWarning!.bandMax,
                  currency: event.method.currency,
                })}
              </p>
              <Label htmlFor="splitting-ack">{t('splittingComment')}</Label>
              <Textarea
                id="splitting-ack"
                dir="auto"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          ) : null}
          {issue.error ? <ErrorText>{apiError(issue.error)}</ErrorText> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={issue.isPending || (needsAck && comment.trim() === '')}
              onClick={doIssue}
            >
              {t('issueConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={t('cancelTitle')}
        description={t('cancelIntro')}
        confirmLabel={t('cancelConfirm')}
        destructive
        busy={cancel.isPending}
        error={cancel.error ? apiError(cancel.error) : null}
        onConfirm={(reason) =>
          cancel.mutate(
            { expectedVersion: event.version, reason },
            { onSuccess: () => setDialog(null) }
          )
        }
      />
      <ReasonDialog
        open={dialog === 'reissue'}
        onOpenChange={(o) => setDialog(o ? 'reissue' : null)}
        title={t('reissueTitle')}
        description={t('reissueIntro')}
        confirmLabel={t('reissueConfirm')}
        busy={reissue.isPending}
        error={reissue.error ? apiError(reissue.error) : null}
        onConfirm={(reason) =>
          reissue.mutate(
            { expectedVersion: event.version, reason },
            {
              onSuccess: (next) => {
                setDialog(null);
                router.push(`/procurement/rfqs/${next.id}`);
              },
            }
          )
        }
      />
    </div>
  );
}
