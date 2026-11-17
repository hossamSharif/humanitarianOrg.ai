'use client';

import { useTranslations } from 'next-intl';
import { InvoiceCreate } from '@/features/payments/invoice-create';

export default function NewInvoicePage({ searchParams }: { searchParams: { po?: string } }) {
  const t = useTranslations('invoices.create');
  if (!searchParams.po) return <p className="text-sm text-muted-foreground">{t('choosePo')}</p>;
  return <InvoiceCreate poId={searchParams.po} />;
}
