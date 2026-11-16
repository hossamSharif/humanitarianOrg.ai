'use client';

// Budget status report (US8-2, FR-049): grant picker; Budget / Reserved / Committed / Actual /
// Available / % used per budget line with grant totals; Reserved and Committed open the
// drill-down; PDF (client-side) and Excel (API) exports.
import { formatAmount, type PrintLocale } from '@ngo/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@ngo/ui';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { createTranslator, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useGrants } from '@/features/grants/api';
import { WarningBanner } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { usePathname, useRouter } from '@/i18n/routing';
import { saveBlob } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { downloadBudgetStatusXlsx, useBudgetStatus } from './api';
import { DrillDownSheet, type DrillDownTarget } from './drill-down-sheet';
import type { ReportTranslate } from './budget-status-pdf';

function DrillButton({
  value,
  currency,
  onClick,
}: {
  value: string;
  currency: string;
  onClick: () => void;
}) {
  const t = useTranslations('reports');
  const zero = Number(value) === 0;
  const text = (
    <span dir="ltr" className="tabular-nums">
      {formatAmount({ amount: value, currency })}
    </span>
  );
  if (zero) return text;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-primary underline-offset-2 hover:underline"
      aria-label={t('openDrillDown')}
    >
      {text}
    </button>
  );
}

export function BudgetStatusTable() {
  const t = useTranslations('reports');
  const tLines = useTranslations('budgetLines');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const timeZone = useTenantTimeZone();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const grants = useGrants();
  const grantId = params.get('grantId');
  const { data, error, isFetching } = useBudgetStatus(grantId);
  const [drill, setDrill] = useState<DrillDownTarget | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const pickGrant = (id: string) => router.replace(`${pathname}?grantId=${id}`, { scroll: false });

  async function exportExcel(locale: PrintLocale) {
    if (!grantId) return;
    setExporting(`xlsx-${locale}`);
    try {
      await downloadBudgetStatusXlsx(grantId, locale);
    } catch (err) {
      toast({ variant: 'destructive', description: apiError(err) });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf(locale: PrintLocale) {
    if (!data) return;
    setExporting(`pdf-${locale}`);
    try {
      const [messages, { pdf }, { BudgetStatusDocument }, { registerPdfFonts }] = await Promise.all(
        [
          import(`@/messages/${locale}.json`).then(
            (m: { default: Record<string, unknown> }) => m.default
          ),
          import('@react-pdf/renderer'),
          import('./budget-status-pdf'),
          import('@/features/pr/print/fonts'),
        ]
      );
      registerPdfFonts();
      const translate = createTranslator({
        locale,
        messages,
        namespace: 'reports.export' as never,
      });
      const tr: ReportTranslate = (key, values) => translate(key as never, values as never);
      const blob = await pdf(
        <BudgetStatusDocument report={data} locale={locale} timeZone={timeZone} t={tr} />
      ).toBlob();
      saveBlob(blob, `budget-status-${data.grant.code}-${locale}.pdf`);
    } catch (err) {
      toast({ variant: 'destructive', description: apiError(err) });
    } finally {
      setExporting(null);
    }
  }

  const currency = data?.grant.currency ?? '';
  const exportMenu = (kind: 'pdf' | 'xlsx') => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!data || exporting !== null}>
          {exporting?.startsWith(kind) ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
          ) : kind === 'pdf' ? (
            <FileText className="me-2 h-4 w-4" aria-hidden />
          ) : (
            <FileSpreadsheet className="me-2 h-4 w-4" aria-hidden />
          )}
          {t(kind === 'pdf' ? 'exportPdf' : 'exportExcel')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['ar', 'en'] as const).map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => void (kind === 'pdf' ? exportPdf(locale) : exportExcel(locale))}
          >
            {tc(`locales.${locale}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md space-y-1.5">
          <Label htmlFor="report-grant">{t('grant')}</Label>
          <Select value={grantId ?? undefined} onValueChange={pickGrant}>
            <SelectTrigger id="report-grant">
              <SelectValue placeholder={t('selectGrant')} />
            </SelectTrigger>
            <SelectContent>
              {(grants.data?.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.code} — {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {exportMenu('pdf')}
          {exportMenu('xlsx')}
        </div>
      </div>

      {!grantId ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('pickGrant')}
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiError(error)}
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      ) : (
        <>
          {Number(data.difference) !== 0 ? (
            <WarningBanner>
              {tLines('differenceWarning')}{' '}
              <span dir="ltr">{formatAmount({ amount: data.difference, currency })}</span>
            </WarningBanner>
          ) : null}
          <div className={isFetching ? 'rounded-md border opacity-70' : 'rounded-md border'}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tLines('code')}</TableHead>
                  <TableHead>{tLines('description')}</TableHead>
                  <TableHead>{tLines('category')}</TableHead>
                  <TableHead className="text-end">{tLines('budget')}</TableHead>
                  <TableHead className="text-end">{tLines('reserved')}</TableHead>
                  <TableHead className="text-end">{tLines('committed')}</TableHead>
                  <TableHead className="text-end">{tLines('actual')}</TableHead>
                  <TableHead className="text-end">{tLines('available')}</TableHead>
                  <TableHead className="text-end">{tLines('pctUsed')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      {tLines('empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.lines.map((line) => (
                    <TableRow
                      key={line.budgetLineId}
                      className={line.isActive ? undefined : 'opacity-60'}
                    >
                      <TableCell dir="ltr" className="text-start font-medium">
                        {line.code}
                      </TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{tLines(`categories.${line.category}`)}</TableCell>
                      <TableCell className="text-end">
                        <span dir="ltr" className="tabular-nums">
                          {formatAmount({ amount: line.budget, currency })}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <DrillButton
                          value={line.reserved}
                          currency={currency}
                          onClick={() =>
                            setDrill({
                              budgetLineId: line.budgetLineId,
                              code: line.code,
                              status: 'reserved',
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        <DrillButton
                          value={line.committed}
                          currency={currency}
                          onClick={() =>
                            setDrill({
                              budgetLineId: line.budgetLineId,
                              code: line.code,
                              status: 'committed',
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        <span dir="ltr" className="tabular-nums">
                          {formatAmount({ amount: line.actual, currency })}
                        </span>
                      </TableCell>
                      <TableCell className="text-end font-medium">
                        <span dir="ltr" className="tabular-nums">
                          {formatAmount({ amount: line.available, currency })}
                        </span>
                      </TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {line.pctUsed === null ? '—' : `${line.pctUsed}%`}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {data.lines.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">
                      {tLines('totals')}
                    </TableCell>
                    {(['budget', 'reserved', 'committed', 'actual', 'available'] as const).map(
                      (k) => (
                        <TableCell key={k} className="text-end font-medium">
                          <span dir="ltr" className="tabular-nums">
                            {formatAmount({ amount: data.totals[k], currency })}
                          </span>
                        </TableCell>
                      )
                    )}
                    <TableCell dir="ltr" className="text-end font-medium tabular-nums">
                      {data.totals.pctUsed === null ? '—' : `${data.totals.pctUsed}%`}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        </>
      )}

      <DrillDownSheet target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
