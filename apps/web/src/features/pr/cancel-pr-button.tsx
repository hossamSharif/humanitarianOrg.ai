'use client';

// Cancel a PR with a required reason (US6): the creator before approval, a holder of
// pr:cancel_approved also after. The dialog warns when the PR is approved (its committed budget is
// released) and when it belongs to someone else (they are notified). Rendered only when
// `availableActions` includes cancel.
import type { PrDetail } from '@ngo/shared';
import { Button } from '@ngo/ui';
import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { useCancelPr } from './api';
import { ReasonDialog } from './reason-dialog';

export function CancelPrButton({
  pr,
  prepare,
  onCancelled,
}: {
  pr: PrDetail;
  /** e.g. flush the editor's autosave; resolves to the version to send */
  prepare?: () => Promise<number>;
  onCancelled?: () => void;
}) {
  const t = useTranslations('pr.cancel');
  const apiError = useApiError();
  const { data: me } = useMe();
  const cancel = useCancelPr(pr.id);
  const [open, setOpen] = useState(false);
  // a failed autosave flush (e.g. VERSION_CONFLICT) before the cancel is sent
  const [prepareError, setPrepareError] = useState<unknown>(null);

  if (!pr.availableActions.includes('cancel')) return null;

  const othersPr = me !== undefined && me.user.id !== pr.requesterId;

  async function confirm(reason: string) {
    let expectedVersion = pr.version;
    if (prepare) {
      try {
        expectedVersion = await prepare();
      } catch (err) {
        setPrepareError(err);
        return;
      }
    }
    const done = await cancel.mutateAsync({ expectedVersion, reason }).catch(() => null);
    if (done) {
      setOpen(false);
      onCancelled?.();
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          cancel.reset();
          setPrepareError(null);
          setOpen(true);
        }}
      >
        <Ban className="me-2 h-4 w-4" aria-hidden />
        {t('open')}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('intro')}
        confirmLabel={t('confirm')}
        destructive
        busy={cancel.isPending}
        error={(prepareError ?? cancel.error) ? apiError(prepareError ?? cancel.error) : null}
        onConfirm={(reason) => void confirm(reason)}
      >
        {pr.status === 'approved' || othersPr ? (
          <div
            role="alert"
            className="space-y-1 rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            {pr.status === 'approved' ? <p>{t('approvedWarning')}</p> : null}
            {othersPr ? <p>{t('othersWarning')}</p> : null}
          </div>
        ) : null}
      </ReasonDialog>
    </>
  );
}
