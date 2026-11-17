// The Purchase Requisition PDF (US7, FR-045), laid out like sheet "PR" of the RTHA paper form
// (contracts/print-layout.md): header band, info grid, item table with a repeating header row,
// totals with the amount in words, three signature boxes and a footer with page x / y. One
// component renders both templates; `data.document.locale` picks the Arabic (RTL) or English
// styles. Everything shown comes from PrPrintData — the template only formats. The blocks come
// from the shared print kit (002 D9), which reproduces this layout exactly.
import { Document, Page, View } from '@react-pdf/renderer';
import { formatAmount, formatDate, type PrPrintData } from '@ngo/shared';
import {
  AmountInWords,
  DocHeader,
  Footer,
  InfoGrid,
  ItemTable,
  KitStylesProvider,
  KitText as T,
  SignatureBlocks,
  TotalRow,
  Totals,
  Watermark,
  type InfoCell,
} from '@/features/print-kit/components';
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

export function PrDocument({ data, t, logoSrc }: PrDocumentProps) {
  const { locale, timeZone } = data.document;
  const s = pdfStyles(locale);
  const ctx = { s, t, timeZone };
  const number = data.document.number ?? t('print.pdf.unnumbered');

  return (
    <KitStylesProvider styles={s}>
      <Document title={data.document.number ?? t('print.pdf.title')} language={locale}>
        <Page size="A4" style={s.page}>
          {data.document.watermark ? (
            <Watermark text={t(`print.pdf.watermark.${data.document.watermark}`)} />
          ) : null}
          <DocHeader
            organization={data.organization}
            logoSrc={logoSrc ?? null}
            titleAr={t('print.pdf.titleAr')}
            titleEn={t('print.pdf.titleEn')}
            number={number}
          />
          <Info data={data} {...ctx} />
          <Items data={data} {...ctx} />
          <PrTotals data={data} {...ctx} />
          <SignatureBlocks
            boxes={[
              { title: t('print.pdf.requestedBy'), signature: data.signatures.requestedBy },
              { title: t('print.pdf.financeCheck'), signature: data.signatures.financeCheck },
              { title: t('print.pdf.finalApproval'), signature: data.signatures.finalApproval },
            ]}
            labels={{
              name: t('print.pdf.name'),
              position: t('print.pdf.position'),
              date: t('print.pdf.date'),
              signature: t('print.pdf.signature'),
            }}
            timeZone={timeZone}
          />
          <Footer
            number={number}
            printedAt={data.document.printedAt}
            timeZone={timeZone}
            printedLabel={(date) => t('print.pdf.printedAt', { date })}
            pageLabel={(page, pages) => t('print.pdf.page', { page, pages })}
          />
        </Page>
      </Document>
    </KitStylesProvider>
  );
}

interface ZoneProps {
  data: PrPrintData;
  s: PdfStyles;
  t: PdfTranslate;
  timeZone: string;
}

function Info({ data, t }: ZoneProps) {
  const h = data.header;
  const code = (l: { code: string; name: string } | null) => (l ? `${l.code} — ${l.name}` : '');
  const contact = [h.contactName, h.contactPhone].filter(Boolean).join(' · ');
  const cells: InfoCell[] = [
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
  return <InfoGrid cells={cells} />;
}

function Items({ data, s, t }: ZoneProps) {
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
    <ItemTable
      columns={COLUMNS}
      head={head}
      rows={data.lines}
      rowKey={(l) => l.lineNo}
      renderRow={(l, width) => (
        <>
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
        </>
      )}
    />
  );
}

function PrTotals({ data, s, t }: ZoneProps) {
  return (
    <Totals>
      {data.totals.map((total) => (
        <TotalRow
          key={total.currency}
          label={t('print.pdf.total', { currency: total.currency })}
          amount={formatAmount({ amount: total.amount, currency: total.currency })}
        >
          <AmountInWords
            locale={data.document.locale}
            ar={total.amountInWordsAr}
            en={total.amountInWordsEn}
          />
        </TotalRow>
      ))}
      {data.grantTotal ? (
        <TotalRow
          label={t('print.pdf.grantTotal')}
          amount={formatAmount({
            amount: data.grantTotal.amount,
            currency: data.grantTotal.currency,
          })}
        >
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
        </TotalRow>
      ) : null}
    </Totals>
  );
}
