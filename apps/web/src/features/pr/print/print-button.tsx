'use client';

// Print a PR (US7, FR-045): choose Arabic or English, fetch GET /prs/:id/print in that language,
// render the PDF in the browser with @react-pdf/renderer and open it in a new tab (download when
// pop-ups are blocked). The renderer, the template and the other language's messages load only
// when printing, so they stay out of the detail page bundle.
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
import { prPrintData } from '../api';
import type { PdfTranslate } from './pr-document';

/** The logo as a data URL; null when it cannot be fetched (the PDF prints without it). */
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

async function renderPdf(prId: string, locale: PrintLocale): Promise<{ blob: Blob; name: string }> {
  const [data, messages, { pdf }, { PrDocument }, { registerPdfFonts }] = await Promise.all([
    prPrintData(prId, locale),
    import(`@/messages/${locale}.json`).then(
      (m: { default: Record<string, unknown> }) => m.default
    ),
    import('@react-pdf/renderer'),
    import('./pr-document'),
    import('./fonts'),
  ]);
  registerPdfFonts();
  const translate = createTranslator({ locale, messages, namespace: 'pr' as never });
  const t: PdfTranslate = (key, values) => translate(key as never, values as never);
  const logoSrc = await logoDataUrl(data.organization.logoUrl);
  const blob = await pdf(<PrDocument data={data} t={t} logoSrc={logoSrc} />).toBlob();
  return { blob, name: `${data.document.number ?? 'PR-draft'}-${locale}.pdf` };
}

export function PrintButton({ prId }: { prId: string }) {
  const t = useTranslations('pr.print');
  const [busy, setBusy] = useState(false);

  async function print(locale: PrintLocale) {
    // opened synchronously in the click so the browser does not block it as a pop-up
    const tab = window.open('', '_blank');
    setBusy(true);
    try {
      const { blob, name } = await renderPdf(prId, locale);
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
      }
      // the tab keeps its own reference to the document
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
        <Button type="button" variant="outline" disabled={busy}>
          {busy ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Printer className="me-2 h-4 w-4" aria-hidden />
          )}
          {busy ? t('generating') : t('button')}
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
