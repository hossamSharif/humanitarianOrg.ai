'use client';

import { InvoiceDetailView } from '@/features/payments/invoice-detail';

export default function InvoicePage({ params }: { params: { id: string } }) {
  return <InvoiceDetailView id={params.id} />;
}
