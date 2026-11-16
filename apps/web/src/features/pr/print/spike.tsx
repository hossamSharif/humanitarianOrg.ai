// Research R13 spike: one Arabic PR page exercising the known weak points of @react-pdf/renderer
// — Arabic shaping, mixed Arabic/Latin runs, LTR codes and amounts inside RTL text, and mirrored
// table rows. react-pdf ≥ 4 resolves bidi correctly only for Text that carries
// `direction: 'rtl'` itself (the style is not inherited from the page), and `direction` does
// not mirror flex rows, so rows use `row-reverse`. Rendered by a Node script (research.md R13);
// not part of the app bundle.
/* eslint-disable react/jsx-no-literals -- fixed bidi test strings, not UI copy */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_FONT_AR } from './fonts';

const s = StyleSheet.create({
  page: { fontFamily: PDF_FONT_AR, fontSize: 10, padding: '15mm' },
  title: { fontSize: 16, fontWeight: 700, direction: 'rtl', textAlign: 'right' },
  para: { marginTop: 6, direction: 'rtl', textAlign: 'right' },
  row: { flexDirection: 'row-reverse', borderBottom: '0.5pt solid #999', paddingVertical: 3 },
  head: { fontWeight: 700, backgroundColor: '#eee' },
  cell: { flex: 1, paddingHorizontal: 3, direction: 'rtl', textAlign: 'right' },
  wide: { flex: 3, paddingHorizontal: 3, direction: 'rtl', textAlign: 'right' },
  num: { flex: 1, textAlign: 'left', paddingHorizontal: 3, direction: 'rtl' },
  label: { marginTop: 10, fontSize: 8, color: '#666', direction: 'rtl', textAlign: 'right' },
});

const LINES = [
  ['1', 'جركانة مياه سعة 20 لتر (Jerrycan 20 L)', '10', 'قطعة', '87,071.00', '870,710.00', '10202'],
  ['2', 'Hygiene kit — طقم نظافة شخصية', '25', 'طقم', '1,200.50', '30,012.50', '10202'],
];

export function SpikeDocument() {
  return (
    <Document title="R13 spike">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>طلب شراء / Purchase Requisition</Text>
        <Text style={s.label}>1 — رقم مستقل في خلية</Text>
        <Text style={s.para}>PR-MAD-2026-0010</Text>
        <Text style={s.label}>2 — رمز داخل جملة عربية</Text>
        <Text style={s.para}>رقم الطلب PR-MAD-2026-0010 على بند الميزانية 10202 للمانح ADRA.</Text>
        <Text style={s.label}>3 — مبلغ داخل جملة عربية</Text>
        <Text style={s.para}>الإجمالي 870,710.00 SDG بتاريخ 10/11/2026.</Text>
        <Text style={s.label}>4 — نص يبدأ بكلمة لاتينية</Text>
        <Text style={s.para}>Hygiene kit — طقم نظافة شخصية</Text>
        <Text style={s.label}>5 — المبلغ كتابة</Text>
        <Text style={s.para}>فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير</Text>
        <Text style={s.label}>6 — جدول بأعمدة معكوسة</Text>
        <View style={[s.row, s.head]}>
          <Text style={s.cell}>م</Text>
          <Text style={s.wide}>الوصف</Text>
          <Text style={s.cell}>الكمية</Text>
          <Text style={s.cell}>الوحدة</Text>
          <Text style={s.cell}>سعر الوحدة</Text>
          <Text style={s.cell}>الإجمالي</Text>
          <Text style={s.cell}>بند الميزانية</Text>
        </View>
        {LINES.map(([no, desc, qty, unit, cost, total, code]) => (
          <View key={no} style={s.row}>
            <Text style={s.cell}>{no}</Text>
            <Text style={s.wide}>{desc}</Text>
            <Text style={s.num}>{qty}</Text>
            <Text style={s.cell}>{unit}</Text>
            <Text style={s.num}>{cost}</Text>
            <Text style={s.num}>{total}</Text>
            <Text style={s.num}>{code}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
