// Budget status report as PDF (FR-049), rendered in the browser from the JSON report with
// @react-pdf/renderer and the same IBM Plex fonts as the PR printout (features/pr/print/fonts.ts).
// A4 landscape; Arabic mirrors the column order; amounts and codes stay left-to-right.
import {
  formatAmount,
  formatDate,
  formatDateTime,
  type BudgetFigures,
  type BudgetStatusReport,
  type PrintLocale,
} from '@ngo/shared';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_FONT_AR, PDF_FONT_EN } from '@/features/pr/print/fonts';

/** One style object of a react-pdf StyleSheet. */
type Style = Parameters<typeof StyleSheet.create>[0][string];

export type ReportTranslate = (key: string, values?: Record<string, string | number>) => string;

const COLUMNS = [
  { key: 'code', width: '9%' },
  { key: 'description', width: '27%' },
  { key: 'category', width: '11%' },
  { key: 'budget', width: '9%' },
  { key: 'reserved', width: '9%' },
  { key: 'committed', width: '9%' },
  { key: 'actual', width: '8%' },
  { key: 'available', width: '10%' },
  { key: 'pctUsed', width: '8%' },
] as const;

const NUMERIC = new Set(['budget', 'reserved', 'committed', 'actual', 'available', 'pctUsed']);

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, color: '#111827' },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 6 },
  meta: { marginBottom: 2 },
  table: { marginTop: 10, borderWidth: 0.5, borderColor: '#9CA3AF' },
  row: { borderBottomWidth: 0.5, borderColor: '#D1D5DB' },
  head: { backgroundColor: '#E5E7EB', fontWeight: 700 },
  totals: { fontWeight: 700, backgroundColor: '#F3F4F6' },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 7, color: '#6B7280' },
});

export function BudgetStatusDocument({
  report,
  locale,
  timeZone,
  t,
}: {
  report: BudgetStatusReport;
  locale: PrintLocale;
  timeZone: string;
  t: ReportTranslate;
}) {
  const rtl = locale === 'ar';
  const direction = rtl ? 'row-reverse' : 'row';
  const textAlign = rtl ? 'right' : 'left';
  const { grant } = report;
  const money = (amount: string) => formatAmount({ amount, currency: grant.currency });

  const cells = (values: Record<(typeof COLUMNS)[number]['key'], string>, style?: Style) => (
    <View style={[styles.row, { flexDirection: direction }, style ?? {}]} wrap={false}>
      {COLUMNS.map((c) => (
        <Text
          key={c.key}
          style={[
            styles.cell,
            {
              width: c.width,
              textAlign: NUMERIC.has(c.key) ? (rtl ? 'left' : 'right') : textAlign,
            },
          ]}
        >
          {values[c.key]}
        </Text>
      ))}
    </View>
  );
  const figures = (f: BudgetFigures) => ({
    budget: money(f.budget),
    reserved: money(f.reserved),
    committed: money(f.committed),
    actual: money(f.actual),
    available: money(f.available),
    pctUsed: f.pctUsed === null ? '—' : `${f.pctUsed}%`,
  });

  return (
    <Document title={`${t('title')} — ${grant.code}`}>
      <Page
        size="A4"
        orientation="landscape"
        style={[styles.page, { fontFamily: rtl ? PDF_FONT_AR : PDF_FONT_EN, textAlign }]}
      >
        <Text style={styles.title}>{t('title')}</Text>
        <Text style={styles.meta}>
          {t('grant')}: {grant.code} — {grant.name}
        </Text>
        {grant.donorName ? (
          <Text style={styles.meta}>
            {t('donor')}: {grant.donorName}
          </Text>
        ) : null}
        <Text style={styles.meta}>
          {t('period')}: {formatDate(grant.startDate)} – {formatDate(grant.endDate)} ·{' '}
          {t('currency')}: {grant.currency}
        </Text>

        <View style={styles.table}>
          {cells(
            Object.fromEntries(COLUMNS.map((c) => [c.key, t(`columns.${c.key}`)])) as Record<
              (typeof COLUMNS)[number]['key'],
              string
            >,
            styles.head
          )}
          {report.lines.map((line) => (
            <View key={line.budgetLineId}>
              {cells({
                code: line.code,
                description: line.description,
                category: t(`categories.${line.category}`),
                ...figures(line),
              })}
            </View>
          ))}
          {cells(
            { code: t('totals'), description: '', category: '', ...figures(report.totals) },
            styles.totals
          )}
        </View>

        <View
          style={[styles.footer, { flexDirection: direction, justifyContent: 'space-between' }]}
          fixed
        >
          <Text>
            {t('generated')}: {formatDateTime(report.generatedAt, timeZone)}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
