'use client';

import { GrnDetailView } from '@/features/receiving/grn-detail';

export default function GrnPage({ params }: { params: { id: string } }) {
  return <GrnDetailView id={params.id} />;
}
