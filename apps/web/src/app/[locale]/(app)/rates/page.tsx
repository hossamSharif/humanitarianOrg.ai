'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { RatesTable } from '@/features/grants/rates-table';
import { api } from '@/lib/api-client';

export default function RatesPage() {
  const t = useTranslations('rates');
  // Base currency from the organization profile (GET /tenant); the API rejects a rate for it anyway.
  const tenant = useQuery({
    queryKey: ['tenant'],
    queryFn: () => api.get<{ baseCurrency: string }>('/tenant'),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <RatesTable baseCurrency={tenant.data?.baseCurrency} />
    </div>
  );
}
