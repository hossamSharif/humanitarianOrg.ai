'use client';

import { RfqDetail } from '@/features/sourcing/rfq-detail';

export default function RfqPage({ params }: { params: { id: string } }) {
  return <RfqDetail id={params.id} />;
}
