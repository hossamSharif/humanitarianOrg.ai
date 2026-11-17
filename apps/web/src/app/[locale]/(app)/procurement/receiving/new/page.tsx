'use client';

import { useTranslations } from 'next-intl';
import { GrnCreate } from '@/features/receiving/grn-create';

export default function NewGrnPage({ searchParams }: { searchParams: { po?: string } }) {
  const t = useTranslations('receiving.create');
  if (!searchParams.po) return <p className="text-sm text-muted-foreground">{t('choosePo')}</p>;
  return <GrnCreate poId={searchParams.po} />;
}
