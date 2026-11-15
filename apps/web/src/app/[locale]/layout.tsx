import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { getMessages, getTimeZone, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { directionOf, isLocale, routing } from '@/i18n/routing';
import { Providers } from '../providers';
import '../globals.css';

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

const latin = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-latin',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const [messages, timeZone] = await Promise.all([getMessages(), getTimeZone()]);

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${arabic.variable} ${latin.variable}`}
    >
      <body className="min-h-screen antialiased">
        <Providers locale={locale} messages={messages} timeZone={timeZone}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
