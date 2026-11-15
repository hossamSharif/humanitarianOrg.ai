'use client';

import { Button } from '@ngo/ui';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { routing, usePathname, useRouter, type Locale } from '@/i18n/routing';

/** Toggles between the two locales on the same page. */
export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = routing.locales.find((l) => l !== locale) ?? routing.defaultLocale;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={t('language')}
      onClick={() => startTransition(() => router.replace(pathname, { locale: next }))}
    >
      <Languages className="me-2 h-4 w-4" aria-hidden />
      <span lang={next}>{t(`locales.${next}`)}</span>
    </Button>
  );
}
