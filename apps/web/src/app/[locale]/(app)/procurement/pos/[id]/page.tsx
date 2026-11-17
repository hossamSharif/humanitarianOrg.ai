'use client';

import { PoDetail } from '@/features/orders/po-detail';

export default function PurchaseOrderPage({ params }: { params: { id: string } }) {
  return <PoDetail id={params.id} />;
}
