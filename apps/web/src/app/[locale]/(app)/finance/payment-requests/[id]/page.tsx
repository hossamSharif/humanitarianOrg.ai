'use client';

import { PaymentRequestDetailView } from '@/features/payments/payment-detail';

export default function PaymentRequestPage({ params }: { params: { id: string } }) {
  return <PaymentRequestDetailView id={params.id} />;
}
