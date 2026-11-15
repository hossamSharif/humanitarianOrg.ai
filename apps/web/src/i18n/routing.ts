import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

// Arabic first (Principle V); every URL carries its locale: /ar/…, /en/…
export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string | undefined): value is Locale {
  return routing.locales.includes(value as Locale);
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
