'use client';

// Read-only PR: header, lines with locked conversions, attachments, the approval route with its
// signatures, the actions the caller may take, printing, and the history timeline (US8).
import { Button } from '@ngo/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionsPanel } from '@/features/pr/actions-panel';
import { usePr } from '@/features/pr/api';
import { AttachmentsPanel } from '@/features/pr/attachments-panel';
import { HistoryTimeline } from '@/features/pr/history-timeline';
import { PrHeaderView } from '@/features/pr/pr-header-view';
import { ReturnedBanner } from '@/features/pr/returned-banner';
import { PrLinesView } from '@/features/pr/pr-lines-view';
import { PrStatusBadge } from '@/features/pr/pr-status-badge';
import { PrStepsView } from '@/features/pr/pr-steps-view';
import { PrintButton } from '@/features/pr/print/print-button';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';

export default function PrDetailPage({ params }: { params: { id: string } }) {
  const t = useTranslations('pr.view');
  const tf = useTranslations('pr.form');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const { data: pr, error } = usePr(params.id);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiError(error)}
      </p>
    );
  }
  if (!pr) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold" dir="auto">
            {pr.number ?? tf('newTitle')}
          </h1>
          <PrStatusBadge status={pr.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton prId={pr.id} />
          {pr.availableActions.includes('update') ? (
            <Button asChild>
              <Link href={`/prs/${pr.id}/edit`}>
                <Pencil className="me-2 h-4 w-4" aria-hidden />
                {t('edit')}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {pr.status === 'returned' && pr.returnReason ? (
        <ReturnedBanner reason={pr.returnReason} />
      ) : null}
      <ActionsPanel pr={pr} />
      <PrHeaderView pr={pr} />
      <PrLinesView pr={pr} />
      <PrStepsView pr={pr} />
      <AttachmentsPanel prId={pr.id} attachments={pr.attachments} editable={false} />
      <HistoryTimeline prId={pr.id} />
    </div>
  );
}
