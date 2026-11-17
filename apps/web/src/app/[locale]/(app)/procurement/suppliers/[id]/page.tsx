'use client';

import { SupplierDetail } from '@/features/suppliers/supplier-detail';

export default function SupplierPage({ params }: { params: { id: string } }) {
  return <SupplierDetail id={params.id} />;
}
