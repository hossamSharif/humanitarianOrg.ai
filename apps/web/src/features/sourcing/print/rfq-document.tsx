// The Request for Quotation PDF (002 US20-2, contracts/print-layout.md) on the shared print kit:
// one addressee supplier, the lines to quote with quantities and units, the terms, the deadline
// and the published criteria. RfqPrintData has no offer, price or other-supplier field, so the
// template cannot show one.
import { Document, Page, View } from '@react-pdf/renderer';
import { formatDate, formatDateTime, type RfqPrintData } from '@ngo/shared';
import {
  DocHeader,
  Footer,
  InfoGrid,
  ItemTable,
  KitStylesProvider,
  KitText as T,
  Watermark,
  kitStyles,
  type InfoCell,
  type KitColumn,
} from '@/features/print-kit';

/** Translator over the `sourcing` messages namespace of the PDF's language. */
export type RfqPdfTranslate = (key: string, values?: Record<string, string | number>) => string;

type ColumnKey = 'no' | 'description' | 'quantity' | 'unit';

const COLUMNS: readonly KitColumn<ColumnKey>[] = [
  { key: 'no', width: '6%', align: 'center' },
  { key: 'description', width: '64%', align: 'start' },
  { key: 'quantity', width: '15%', align: 'number' },
  { key: 'unit', width: '15%', align: 'start' },
];

function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function RfqDocument({
  data,
  t,
  logoSrc,
  timeZone,
  printedAt,
}: {
  data: RfqPrintData;
  t: RfqPdfTranslate;
  logoSrc: string | null;
  timeZone: string;
  printedAt: string;
}) {
  const { locale } = data;
  const s = kitStyles(locale);
  const number = data.number ?? t('print.unnumbered');
  const supplierName = locale === 'ar' ? data.supplier.nameAr : data.supplier.nameEn;
  const officeName = locale === 'ar' ? data.office.nameAr : data.office.nameEn;

  const cells: InfoCell[] = [
    [t('print.to'), supplierName, true],
    [
      t('print.supplierContact'),
      [data.supplier.phone, data.supplier.email].filter(Boolean).join(' · ') || '—',
    ],
    [t('print.office'), officeName],
    [t('print.subject'), data.title, true],
    [t('print.issueDate'), data.issueDate ? formatDate(data.issueDate) : '—'],
    [
      t('print.deadline'),
      data.submissionDeadline ? formatDateTime(data.submissionDeadline, timeZone) : '—',
    ],
    [t('print.currency'), data.currency],
    [
      t('print.validity'),
      data.offerValidityDays ? t('print.days', { count: data.offerValidityDays }) : '—',
    ],
    [t('print.deliveryPlace'), data.deliveryPlace ?? '—', true],
    [t('print.deliveryTerms'), data.deliveryTerms ?? '—', true],
    [t('print.paymentTerms'), data.paymentTerms ?? '—', true],
  ];

  return (
    <KitStylesProvider styles={s}>
      <Document title={number} language={locale}>
        <Page size="A4" style={s.page}>
          {data.watermark ? <Watermark text={t(`print.watermark.${data.watermark}`)} /> : null}
          <DocHeader
            organization={data.organization}
            logoSrc={logoSrc}
            titleAr={t('print.titleAr')}
            titleEn={t('print.titleEn')}
            number={number}
          />
          <InfoGrid cells={cells} />
          <View style={{ marginTop: 8 }}>
            <T style={s.bold}>{t('print.intro')}</T>
          </View>
          <View style={{ marginTop: 6 }}>
            <ItemTable
              columns={COLUMNS}
              head={{
                no: '#',
                description: t('print.description'),
                quantity: t('print.quantity'),
                unit: t('print.unit'),
              }}
              rows={data.lines}
              rowKey={(l) => l.lineNo}
              renderRow={(l, width) => (
                <>
                  <T style={[s.cellCode, { width: width.no }]}>{String(l.lineNo)}</T>
                  <View style={[s.cell, { width: width.description }]}>
                    <T>{l.description ?? ''}</T>
                    {l.specifications ? <T style={s.specs}>{l.specifications}</T> : null}
                  </View>
                  <T style={[s.cellNumber, { width: width.quantity }]}>{trimZeros(l.quantity)}</T>
                  <T style={[s.cell, { width: width.unit }]}>{l.unit ?? ''}</T>
                </>
              )}
            />
          </View>
          {data.criteria.length > 0 ? (
            <View style={{ marginTop: 10 }} wrap={false}>
              <T style={s.bold}>{t('print.criteria')}</T>
              {data.criteria.map((c) => (
                <T key={c.name} style={s.rateLine}>
                  {c.kind === 'weighted' && c.weightPct
                    ? t('print.criterionWeighted', { name: c.name, weight: c.weightPct })
                    : t('print.criterionEssential', { name: c.name })}
                </T>
              ))}
            </View>
          ) : null}
          <View style={{ marginTop: 10 }}>
            <T style={s.rateLine}>{t('print.sealedNote')}</T>
          </View>
          <Footer
            number={number}
            printedAt={printedAt}
            timeZone={timeZone}
            printedLabel={(date) => t('print.printedAt', { date })}
            pageLabel={(page, pages) => t('print.page', { page, pages })}
          />
        </Page>
      </Document>
    </KitStylesProvider>
  );
}
