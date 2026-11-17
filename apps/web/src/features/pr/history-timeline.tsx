'use client';

// PR timeline (FR-044) — the shared document timeline over GET /prs/:id/history, with the PR
// status badges and step kinds.
import { HistoryTimeline as Timeline } from '@/features/documents/history-timeline';
import { usePrHistory } from './api';
import { PrStatusBadge } from './pr-status-badge';

export function HistoryTimeline({ prId }: { prId: string }) {
  const { data, error, isPending } = usePrHistory(prId);
  return (
    <Timeline
      data={data}
      error={error}
      isPending={isPending}
      kindNamespace="pr.steps.kind"
      renderState={(status) => (
        <PrStatusBadge status={status as Parameters<typeof PrStatusBadge>[0]['status']} />
      )}
    />
  );
}
