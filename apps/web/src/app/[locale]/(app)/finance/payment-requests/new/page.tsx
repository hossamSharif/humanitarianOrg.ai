'use client';

import { useTranslations } from 'next-intl';
import { PaymentRequestCreate } from '@/features/payments/payment-create';

export default function NewPaymentRequestPage({
  searchParams,
}: {
  searchParams: { po?: string; invoice?: string };
}) {
  const t = useTranslations('payments.create');
  if (!searchParams.po) return <p className="text-sm text-muted-foreground">{t('choosePo')}</p>;
  return <PaymentRequestCreate poId={searchParams.po} invoiceId={searchParams.invoice} />;
}
