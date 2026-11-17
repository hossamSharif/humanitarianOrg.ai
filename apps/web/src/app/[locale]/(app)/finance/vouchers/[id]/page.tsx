'use client';

import { VoucherDetailView } from '@/features/vouchers/voucher-detail';

export default function VoucherPage({ params }: { params: { id: string } }) {
  return <VoucherDetailView id={params.id} />;
}
