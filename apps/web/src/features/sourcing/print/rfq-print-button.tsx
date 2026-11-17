'use client';

// Print the RFQ for one invited supplier (US20-2): Arabic or English, rendered in the browser
// with @react-pdf/renderer and opened in a new tab. Renderer, template and the other language's
// messages load only when printing.
import type { PrintLocale } from '@ngo/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@ngo/ui';
import { Loader2, Printer } from 'lucide-react';
import { createTranslator, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useTenantTimeZone } from '@/features/setup/api';
import { rfqPrintData } from '../api';
import type { RfqPdfTranslate } from './rfq-document';

async function logoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function renderPdf(
  rfqId: string,
  supplierId: string,
  locale: PrintLocale,
  timeZone: string
): Promise<{ blob: Blob; name: string }> {
  const [data, messages, { pdf }, { RfqDocument }, { registerPdfFonts }] = await Promise.all([
    rfqPrintData(rfqId, supplierId, locale),
    import(`@/messages/${locale}.json`).then(
      (m: { default: Record<string, unknown> }) => m.default
    ),
    import('@react-pdf/renderer'),
    import('./rfq-document'),
    import('@/features/print-kit/fonts'),
  ]);
  registerPdfFonts();
  const translate = createTranslator({ locale, messages, namespace: 'sourcing' as never });
  const t: RfqPdfTranslate = (key, values) => translate(key as never, values as never);
  const logoSrc = await logoDataUrl(data.organization.logoUrl);
  const blob = await pdf(
    <RfqDocument
      data={data}
      t={t}
      logoSrc={logoSrc}
      timeZone={timeZone}
      printedAt={new Date().toISOString()}
    />
  ).toBlob();
  return { blob, name: `${data.number ?? 'RFQ-draft'}-${locale}.pdf` };
}

export function RfqPrintButton({ rfqId, supplierId }: { rfqId: string; supplierId: string }) {
  const t = useTranslations('sourcing.print');
  const timeZone = useTenantTimeZone();
  const [busy, setBusy] = useState(false);

  async function print(locale: PrintLocale) {
    const tab = window.open('', '_blank');
    setBusy(true);
    try {
      const { blob, name } = await renderPdf(rfqId, supplierId, locale, timeZone);
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      console.error(err);
      toast({ variant: 'destructive', description: t('error') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Printer className="me-2 h-4 w-4" aria-hidden />
          )}
          {t('button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('chooseLanguage')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void print('ar')}>{t('arabic')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void print('en')}>{t('english')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
