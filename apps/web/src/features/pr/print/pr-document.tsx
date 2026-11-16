// The Purchase Requisition PDF (US7, FR-045), laid out like sheet "PR" of the RTHA paper form
// (contracts/print-layout.md): header band, info grid, item table with a repeating header row,
// totals with the amount in words, three signature boxes and a footer with page x / y. One
// component renders both templates; `data.document.locale` picks the Arabic (RTL) or English
// styles. Everything shown comes from PrPrintData — the template only formats.
import { Document, Image, Page, Text, View, type Styles } from '@react-pdf/renderer';
import {
  calendarDateInTimeZone,
  formatAmount,
  formatDate,
  formatDateTime,
  type PrPrintData,
  type PrPrintSignature,
} from '@ngo/shared';
import { createContext, useContext, type ReactNode } from 'react';
import { COLUMNS, pdfStyles, type ColumnKey, type PdfStyles } from './styles';

/** Translator over the `pr` messages namespace of the PDF's language. */
export type PdfTranslate = (key: string, values?: Record<string, string | number>) => string;

export interface PrDocumentProps {
  data: PrPrintData;
  t: PdfTranslate;
  /** logo as a data URL (fetched beforehand, so a missing image never breaks rendering) */
  logoSrc?: string | null;
}

/** '10.000' → '10', '2.500' → '2.5' */
function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

const amount = (value: string | null, currency: string) =>
  value === null ? '' : formatAmount({ amount: value, currency }, { withCurrency: false });

type TextStyle = Styles[string] | Styles[string][];

const StylesContext = createContext<PdfStyles | null>(null);

/** Text with the template's base direction (react-pdf does not inherit `direction`). */
function T({ style, children }: { style?: TextStyle; children?: ReactNode }) {
  const s = useContext(StylesContext)!;
  const rest = Array.isArray(style) ? style : style ? [style] : [];
  return <Text style={[s.text, ...rest]}>{children}</Text>;
}

export function PrDocument({ data, t, logoSrc }: PrDocumentProps) {
  const { locale, timeZone } = data.document;
  const s = pdfStyles(locale);
  const ctx = { s, t, timeZone };

  return (
    <StylesContext.Provider value={s}>
      <Document title={data.document.number ?? t('print.pdf.title')} language={locale}>
        <Page size="A4" style={s.page}>
          {data.document.watermark ? (
            <Text fixed style={[s.text, s.watermark]}>
              {t(`print.pdf.watermark.${data.document.watermark}`)}
            </Text>
          ) : null}
          <HeaderBand data={data} logoSrc={logoSrc ?? null} {...ctx} />
          <InfoGrid data={data} {...ctx} />
          <ItemTable data={data} {...ctx} />
          <Totals data={data} {...ctx} />
          <Signatures data={data} {...ctx} />
          <View fixed style={s.footer}>
            <T style={[s.footerNumber, s.english]}>
              {data.document.number ?? t('print.pdf.unnumbered')}
            </T>
            <T style={s.footerPrinted}>
              {t('print.pdf.printedAt', {
                date: formatDateTime(data.document.printedAt, timeZone),
              })}
            </T>
          </View>
          {/* a `render` Text inside a fixed View drops the whole View, so it stands alone;
              it must not get `lineHeight` (s.text) either */}
          <Text
            fixed
            style={s.pageNumber}
            render={({ pageNumber, totalPages }) =>
              t('print.pdf.page', { page: pageNumber, pages: totalPages })
            }
          />
        </Page>
      </Document>
    </StylesContext.Provider>
  );
}

interface ZoneProps {
  data: PrPrintData;
  s: PdfStyles;
  t: PdfTranslate;
  timeZone: string;
}

function HeaderBand({ data, s, t, logoSrc }: ZoneProps & { logoSrc: string | null }) {
  const org = data.organization;
  const contact = [org.address, org.phone, org.email].filter(Boolean).join(' · ');
  return (
    <View style={s.header}>
      <View style={s.logoBox}>{logoSrc ? <Image src={logoSrc} style={s.logo} /> : null}</View>
      <View style={s.orgBox}>
        <T style={[s.orgNameAr, s.arabic]}>{org.nameAr}</T>
        <T style={[s.orgNameEn, s.english]}>{org.nameEn}</T>
        {contact ? <T style={s.orgContact}>{contact}</T> : null}
      </View>
      <View style={s.titleBox}>
        <T style={[s.titleAr, s.arabic]}>{t('print.pdf.titleAr')}</T>
        <T style={[s.titleEn, s.english]}>{t('print.pdf.titleEn')}</T>
        <T style={s.number}>{data.document.number ?? t('print.pdf.unnumbered')}</T>
      </View>
    </View>
  );
}

function InfoGrid({ data, s, t }: ZoneProps) {
  const h = data.header;
  const code = (l: { code: string; name: string } | null) => (l ? `${l.code} — ${l.name}` : '');
  const contact = [h.contactName, h.contactPhone].filter(Boolean).join(' · ');
  const cells: [string, string, boolean?][] = [
    [t('print.pdf.prDate'), formatDate(h.prDate)],
    [t('print.pdf.requiredBy'), formatDate(h.requiredByDate)],
    [t('print.pdf.requestingOffice'), code(h.requestingOffice)],
    [t('print.pdf.grant'), code(h.grant)],
    [t('print.pdf.donor'), h.donor ? h.donor.name : ''],
    [t('print.pdf.deliverTo'), h.deliverTo?.name ?? ''],
    [t('print.pdf.deliveryAddress'), h.deliveryAddress ?? ''],
    [t('print.pdf.contact'), contact],
    [t('print.pdf.activity'), code(h.activity)],
    [t('print.pdf.prType'), h.prType ? t(`form.types.${h.prType}`) : ''],
    [t('print.pdf.purpose'), h.purpose ?? '', true],
  ];
  return (
    <View style={s.grid}>
      {cells.map(([label, value, wide]) => (
        <View key={label} style={wide ? [s.gridCell, s.gridCellWide] : s.gridCell} wrap={false}>
          <T style={s.gridLabel}>{label}</T>
          <T style={s.gridValue}>{value}</T>
        </View>
      ))}
    </View>
  );
}

const HEAD_ALIGN = { start: 'start', number: 'end', center: 'center' } as const;

function ItemTable({ data, s, t }: ZoneProps) {
  const width = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])) as Record<
    ColumnKey,
    string
  >;
  const head: Record<ColumnKey, string> = {
    no: t('print.pdf.columns.no'),
    description: t('print.pdf.columns.description'),
    quantity: t('print.pdf.columns.quantity'),
    unit: t('print.pdf.columns.unit'),
    unitCost: t('print.pdf.columns.unitCost'),
    total: t('print.pdf.columns.total'),
    donor: t('print.pdf.columns.donor'),
    location: t('print.pdf.columns.location'),
    budgetLine: t('print.pdf.columns.budgetLine'),
  };
  return (
    <View style={s.table}>
      {/* `fixed` inside the table repeats the header row on every page the table spans */}
      <View style={s.tableHead} fixed>
        {COLUMNS.map((c) => (
          <T key={c.key} style={[s.cell, s[HEAD_ALIGN[c.align]], { width: width[c.key] }]}>
            {head[c.key]}
          </T>
        ))}
      </View>
      {data.lines.map((l) => (
        <View key={l.lineNo} style={s.tableRow} wrap={false}>
          <T style={[s.cellCode, { width: width.no }]}>{String(l.lineNo)}</T>
          <View style={[s.cell, { width: width.description }]}>
            <T>{l.description ?? ''}</T>
            {l.specifications ? <T style={s.specs}>{l.specifications}</T> : null}
          </View>
          <T style={[s.cellNumber, { width: width.quantity }]}>
            {l.quantity ? trimZeros(l.quantity) : ''}
          </T>
          <T style={[s.cell, { width: width.unit }]}>{l.unit?.name ?? ''}</T>
          <T style={[s.cellNumber, { width: width.unitCost }]}>{amount(l.unitCost, l.currency)}</T>
          <View style={[s.cellNumber, { width: width.total }]}>
            <T style={s.end}>{amount(l.lineTotal, l.currency)}</T>
            <T style={[s.end, s.small, s.muted]}>{l.currency}</T>
          </View>
          <T style={[s.cellCode, { width: width.donor }]}>{l.donorShortName ?? ''}</T>
          <T style={[s.cell, { width: width.location }]}>{l.budgetLocation?.name ?? ''}</T>
          <T style={[s.cellCode, { width: width.budgetLine }]}>{l.budgetLineCode ?? ''}</T>
        </View>
      ))}
    </View>
  );
}

function Totals({ data, s, t }: ZoneProps) {
  const ar = data.document.locale === 'ar';
  return (
    <View style={s.totals} wrap={false}>
      {data.totals.map((total) => (
        <View key={total.currency} style={s.totalRow}>
          <T style={s.totalLabel}>{t('print.pdf.total', { currency: total.currency })}</T>
          <View style={s.words}>
            <T style={[s.wordsMain, ar ? s.arabic : s.english]}>
              {ar ? total.amountInWordsAr : total.amountInWordsEn}
            </T>
            <T style={[s.wordsOther, ar ? s.english : s.arabic]}>
              {ar ? total.amountInWordsEn : total.amountInWordsAr}
            </T>
          </View>
          <T style={s.totalAmount}>
            {formatAmount({ amount: total.amount, currency: total.currency })}
          </T>
        </View>
      ))}
      {data.grantTotal ? (
        <View style={s.totalRow}>
          <T style={s.totalLabel}>{t('print.pdf.grantTotal')}</T>
          <View style={s.words}>
            {data.grantTotal.rates.map((r) => (
              <T key={r.currency} style={s.rateLine}>
                {t('print.pdf.rate', {
                  currency: r.currency,
                  rate: trimZeros(r.rateToBase),
                  date: formatDate(r.rateDate),
                  source: r.source,
                })}
              </T>
            ))}
          </View>
          <T style={s.totalAmount}>
            {formatAmount({ amount: data.grantTotal.amount, currency: data.grantTotal.currency })}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Signatures({ data, s, t, timeZone }: ZoneProps) {
  const boxes: [string, PrPrintSignature][] = [
    [t('print.pdf.requestedBy'), data.signatures.requestedBy],
    [t('print.pdf.financeCheck'), data.signatures.financeCheck],
    [t('print.pdf.finalApproval'), data.signatures.finalApproval],
  ];
  const line = (label: string, value: string | null) => (
    <View style={s.signatureLine}>
      <T style={s.signatureLabel}>{label}</T>
      {value ? <T style={s.signatureValue}>{value}</T> : <View style={s.blank} />}
    </View>
  );
  return (
    <View style={s.signatures} wrap={false}>
      {boxes.map(([title, signature]) => (
        <View key={title} style={s.signatureBox}>
          <T style={s.signatureTitle}>{title}</T>
          {line(t('print.pdf.name'), signature?.name ?? null)}
          {line(t('print.pdf.position'), signature?.position ?? null)}
          {line(
            t('print.pdf.date'),
            signature ? formatDate(calendarDateInTimeZone(signature.signedAt, timeZone)) : null
          )}
          {line(t('print.pdf.signature'), null)}
        </View>
      ))}
    </View>
  );
}
