'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMe } from '@/lib/use-me';

export default function HomePage() {
  const t = useTranslations('common');
  const locale = useLocale();
  const { data: me } = useMe();
  const name = locale === 'ar' ? me?.membership?.fullNameAr : me?.membership?.fullNameEn;

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t('welcome', { name: name ?? '' })}</h1>
      <p className="text-muted-foreground">{t('homeIntro')}</p>
    </div>
  );
}
