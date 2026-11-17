'use client';

import type { PrStatus } from '@ngo/shared';
import { DocStatusBadge } from '@/features/documents/status-badge';

export function PrStatusBadge({ status, className }: { status: PrStatus; className?: string }) {
  return <DocStatusBadge status={status} namespace="status" className={className} />;
}
