// Print kit styles (002 contracts/print-layout.md, extracted from the 001 PR PDF without
// changing it): A4 portrait, 15 mm margins, one stylesheet per template language. The Arabic variant mirrors every row (`row-reverse`), aligns text to the right and
// gives every Text `direction: 'rtl'` — react-pdf neither inherits `direction` nor mirrors rows
// with it, and drops RTL Text without a definite width in absolute boxes (research R13 spike).
// `lineHeight` only on Text with an explicit fontSize (unitless values resolve against 18pt
// otherwise) and never on Page or a `render` Text (it silently drops page numbers). Numbers and codes sit in their own cells, so they stay LTR.
import { StyleSheet } from '@react-pdf/renderer';
import type { PrintLocale } from '@ngo/shared';
import { PDF_FONT_AR, PDF_FONT_EN } from './fonts';

const INK = '#111111';
const MUTED = '#555555';
const RULE = '#9a9a9a';
const BAND = '#eeeeee';
const PAID = '#1f5f99';
const MM = 72 / 25.4;
const MARGIN = 15 * MM;
const FOOTER_BOTTOM = 10 * MM;

/** An item table column in reading order (the Arabic template reverses the row). */
export interface KitColumn<K extends string = string> {
  key: K;
  width: string;
  align: 'start' | 'number' | 'center';
}

export function kitStyles(locale: PrintLocale) {
  const rtl = locale === 'ar';
  const row = rtl ? ('row-reverse' as const) : ('row' as const);
  const start = rtl ? ('right' as const) : ('left' as const);
  const end = rtl ? ('left' as const) : ('right' as const);

  return StyleSheet.create({
    page: {
      // Plex Sans Arabic has Latin glyphs; the English template falls back to it for Arabic text
      fontFamily: rtl ? PDF_FONT_AR : [PDF_FONT_EN, PDF_FONT_AR],
      fontSize: 8.5,
      color: INK,
      paddingTop: '15mm',
      paddingHorizontal: '15mm',
      paddingBottom: '22mm',
    },
    /** every Text: the bidi base direction of the template */
    text: { direction: rtl ? 'rtl' : 'ltr' },
    /** Arabic strings inside either template */
    arabic: { fontFamily: PDF_FONT_AR, direction: 'rtl' },
    /** English strings inside either template */
    english: { fontFamily: PDF_FONT_EN, direction: 'ltr' },
    row: { flexDirection: row },
    start: { textAlign: start },
    end: { textAlign: end },
    center: { textAlign: 'center' },
    muted: { color: MUTED },
    small: { fontSize: 7 },
    bold: { fontWeight: 700 },

    watermark: {
      position: 'absolute',
      top: '40%',
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 96,
      fontWeight: 700,
      lineHeight: 1.2,
      color: '#999999',
      opacity: 0.4,
      transform: 'rotate(-35deg)',
    },

    // header band
    header: {
      flexDirection: row,
      alignItems: 'center',
      borderBottom: `1pt solid ${INK}`,
      paddingBottom: 6,
      marginBottom: 8,
    },
    logoBox: { width: 70, height: 50, justifyContent: 'center' },
    logo: { maxWidth: 70, maxHeight: 50, objectFit: 'contain' },
    orgBox: { flexGrow: 1, paddingHorizontal: 8 },
    orgNameAr: { fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: 1.5 },
    orgNameEn: { fontSize: 11, fontWeight: 700, textAlign: 'center', lineHeight: 1.4 },
    orgContact: { fontSize: 7, color: MUTED, textAlign: 'center' },
    titleBox: { width: 140 },
    titleAr: { fontSize: 12, fontWeight: 700, textAlign: end, lineHeight: 1.5 },
    titleEn: { fontSize: 10, fontWeight: 700, textAlign: end, lineHeight: 1.4 },
    number: { fontSize: 11, fontWeight: 700, textAlign: end, lineHeight: 1.6, direction: 'ltr' },

    // info grid
    grid: {
      flexDirection: row,
      flexWrap: 'wrap',
      marginBottom: 8,
      borderTop: `0.5pt solid ${RULE}`,
    },
    gridCell: {
      width: '50%',
      flexDirection: row,
      borderBottom: `0.5pt solid ${RULE}`,
      paddingVertical: 2.5,
      paddingHorizontal: 3,
    },
    gridCellWide: { width: '100%' },
    gridLabel: { width: 88, color: MUTED, textAlign: start },
    gridValue: { flex: 1, textAlign: start },

    // item table
    table: { borderTop: `0.75pt solid ${INK}`, borderBottom: `0.75pt solid ${INK}` },
    tableHead: {
      flexDirection: row,
      backgroundColor: BAND,
      borderBottom: `0.75pt solid ${INK}`,
      fontWeight: 700,
      fontSize: 7.5,
    },
    tableRow: { flexDirection: row, borderBottom: `0.5pt solid ${RULE}` },
    cell: { paddingVertical: 2.5, paddingHorizontal: 2.5, textAlign: start },
    cellNumber: { paddingVertical: 2.5, paddingHorizontal: 2.5, textAlign: end, direction: 'ltr' },
    cellCode: {
      paddingVertical: 2.5,
      paddingHorizontal: 2.5,
      textAlign: 'center',
      direction: 'ltr',
    },
    specs: { fontSize: 7, color: MUTED, marginTop: 1 },

    // totals
    totals: { marginTop: 6 },
    totalRow: { flexDirection: row, alignItems: 'flex-start', paddingVertical: 3 },
    totalLabel: { width: 110, fontWeight: 700, textAlign: start },
    totalAmount: { width: 110, fontWeight: 700, textAlign: end, direction: 'ltr' },
    words: { flex: 1, paddingHorizontal: 8 },
    wordsMain: { textAlign: start, fontWeight: 500 },
    wordsOther: { textAlign: start, fontSize: 7, color: MUTED },
    rateLine: { fontSize: 7, color: MUTED, textAlign: start },

    // signatures
    signatures: { flexDirection: row, marginTop: 14, justifyContent: 'space-between' },
    signatureBox: { width: '32%', border: `0.75pt solid ${INK}`, padding: 6, minHeight: 82 },
    signatureTitle: { fontWeight: 700, textAlign: 'center', marginBottom: 6 },
    signatureLine: { flexDirection: row, marginTop: 5 },
    signatureLabel: { width: 48, color: MUTED, textAlign: start },
    signatureValue: { flex: 1, textAlign: start },
    blank: { flex: 1, borderBottom: `0.5pt solid ${INK}`, marginBottom: 2 },

    // footer
    // footer (absolute offsets in pt: 10 mm from the bottom, 15 mm margins)
    footer: {
      position: 'absolute',
      bottom: FOOTER_BOTTOM,
      left: MARGIN,
      right: MARGIN,
      flexDirection: row,
      borderTop: `0.5pt solid ${RULE}`,
      paddingTop: 3,
      fontSize: 7,
      color: MUTED,
    },
    // RTL Text needs a definite width in absolute/fixed boxes, or react-pdf drops it
    footerNumber: { width: 110, textAlign: start, direction: 'ltr' },
    footerPrinted: { flex: 1, textAlign: start },
    pageNumber: {
      position: 'absolute',
      bottom: FOOTER_BOTTOM,
      left: MARGIN,
      right: MARGIN,
      paddingTop: 3.5,
      textAlign: end,
      direction: rtl ? 'rtl' : 'ltr',
      fontSize: 7,
      color: MUTED,
    },

    // "PAID BY …" stamp of a posted payment voucher, with the payment date (BPV-35)
    paidStamp: {
      position: 'absolute',
      top: '58%',
      left: '30%',
      width: 220,
      border: `2pt solid ${PAID}`,
      borderRadius: 6,
      paddingVertical: 6,
      color: PAID,
      transform: 'rotate(-12deg)',
    },
    paidStampTitle: { fontSize: 16, fontWeight: 700, textAlign: 'center', lineHeight: 1.3 },
    paidStampDate: { fontSize: 10, textAlign: 'center', direction: 'ltr' },

    // waiver numbers printed across the chain (FR-050)
    waiverBadge: {
      flexDirection: row,
      alignSelf: rtl ? 'flex-end' : 'flex-start',
      border: `0.75pt solid ${INK}`,
      paddingVertical: 2,
      paddingHorizontal: 5,
      marginBottom: 6,
    },
    waiverBadgeLabel: { fontWeight: 700, textAlign: start },
    waiverBadgeNumbers: { paddingHorizontal: 4, textAlign: start, direction: 'ltr' },
  });
}

export type KitStyles = ReturnType<typeof kitStyles>;
