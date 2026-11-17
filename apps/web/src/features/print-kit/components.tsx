// Print kit building blocks (002 contracts/print-layout.md "Shared kit", research D9),
// extracted from the 001 PR PDF: header band, info grid, item table with a repeating header,
// totals with the amount in words in both languages, signature blocks from doc_signature,
// watermark, PAID stamp, waiver badge and footer with page x / y. Each renders exactly the
// react-pdf primitives the PR template used to, so the PR output is unchanged. Every Text goes
// through <KitText>, which carries the template's base direction (react-pdf does not inherit
// `direction`; research R13).
import { Image, Text, View, type Styles } from '@react-pdf/renderer';
import { calendarDateInTimeZone, formatDate, formatDateTime } from '@ngo/shared';
import { createContext, useContext, type ReactNode } from 'react';
import type { KitColumn, KitStyles } from './styles';

type TextStyle = Styles[string] | Styles[string][];

const StylesContext = createContext<KitStyles | null>(null);

/** Makes the template's stylesheet available to <KitText> and the blocks below. */
export function KitStylesProvider({
  styles,
  children,
}: {
  styles: KitStyles;
  children: ReactNode;
}) {
  return <StylesContext.Provider value={styles}>{children}</StylesContext.Provider>;
}

export function useKitStyles(): KitStyles {
  const styles = useContext(StylesContext);
  if (!styles) throw new Error('KitStylesProvider is missing');
  return styles;
}

/** Text with the template's base direction. */
export function KitText({ style, children }: { style?: TextStyle; children?: ReactNode }) {
  const s = useKitStyles();
  const rest = Array.isArray(style) ? style : style ? [style] : [];
  return <Text style={[s.text, ...rest]}>{children}</Text>;
}

const T = KitText;

// ---------------------------------------------------------------------------------------------

export function Watermark({ text }: { text: string }) {
  const s = useKitStyles();
  return (
    <Text fixed style={[s.text, s.watermark]}>
      {text}
    </Text>
  );
}

export interface DocHeaderProps {
  organization: {
    nameAr: string;
    nameEn: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  logoSrc: string | null;
  titleAr: string;
  titleEn: string;
  /** the document number, or the "not yet numbered" label */
  number: string;
  /** office / region line under the number (vouchers: "Gazira") */
  officeLine?: string | null;
}

export function DocHeader({
  organization: org,
  logoSrc,
  titleAr,
  titleEn,
  number,
  officeLine,
}: DocHeaderProps) {
  const s = useKitStyles();
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
        <T style={[s.titleAr, s.arabic]}>{titleAr}</T>
        <T style={[s.titleEn, s.english]}>{titleEn}</T>
        <T style={s.number}>{number}</T>
        {officeLine ? <T style={[s.orgContact, s.end]}>{officeLine}</T> : null}
      </View>
    </View>
  );
}

/** label, value, full width */
export type InfoCell = [string, string, boolean?];

export function InfoGrid({ cells }: { cells: readonly InfoCell[] }) {
  const s = useKitStyles();
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

export interface ItemTableProps<K extends string, R> {
  columns: readonly KitColumn<K>[];
  head: Record<K, string>;
  rows: readonly R[];
  rowKey(row: R): string | number;
  /** the cells of one row, in column order; widths come from `columns` */
  renderRow(row: R, width: Record<K, string>): ReactNode;
}

/** The header row is `fixed` inside the table, so it repeats on every page the table spans. */
export function ItemTable<K extends string, R>({
  columns,
  head,
  rows,
  rowKey,
  renderRow,
}: ItemTableProps<K, R>) {
  const s = useKitStyles();
  const width = Object.fromEntries(columns.map((c) => [c.key, c.width])) as Record<K, string>;
  return (
    <View style={s.table}>
      <View style={s.tableHead} fixed>
        {columns.map((c) => (
          <T key={c.key} style={[s.cell, s[HEAD_ALIGN[c.align]], { width: width[c.key] }]}>
            {head[c.key]}
          </T>
        ))}
      </View>
      {rows.map((row) => (
        <View key={rowKey(row)} style={s.tableRow} wrap={false}>
          {renderRow(row, width)}
        </View>
      ))}
    </View>
  );
}

export function Totals({ children }: { children: ReactNode }) {
  const s = useKitStyles();
  return (
    <View style={s.totals} wrap={false}>
      {children}
    </View>
  );
}

/** One totals row: label, the words area (children), amount. */
export function TotalRow({
  label,
  amount,
  children,
}: {
  label: string;
  amount: string;
  children?: ReactNode;
}) {
  const s = useKitStyles();
  return (
    <View style={s.totalRow}>
      <T style={s.totalLabel}>{label}</T>
      <View style={s.words}>{children}</View>
      <T style={s.totalAmount}>{amount}</T>
    </View>
  );
}

/** The amount in words in the template language, the other language beneath (FR-087). */
export function AmountInWords({ locale, ar, en }: { locale: 'ar' | 'en'; ar: string; en: string }) {
  const s = useKitStyles();
  const arabic = locale === 'ar';
  return (
    <>
      <T style={[s.wordsMain, arabic ? s.arabic : s.english]}>{arabic ? ar : en}</T>
      <T style={[s.wordsOther, arabic ? s.english : s.arabic]}>{arabic ? en : ar}</T>
    </>
  );
}

export interface SignatureValue {
  name: string;
  position: string | null;
  signedAt: string;
}

export interface SignatureBlocksProps {
  boxes: readonly { title: string; signature: SignatureValue | null }[];
  labels: { name: string; position: string; date: string; signature: string };
  timeZone: string;
}

/** Name, position at signing and DD/MM/YYYY date from the signature; wet-signature lines when empty. */
export function SignatureBlocks({ boxes, labels, timeZone }: SignatureBlocksProps) {
  const s = useKitStyles();
  const line = (label: string, value: string | null) => (
    <View style={s.signatureLine}>
      <T style={s.signatureLabel}>{label}</T>
      {value ? <T style={s.signatureValue}>{value}</T> : <View style={s.blank} />}
    </View>
  );
  return (
    <View style={s.signatures} wrap={false}>
      {boxes.map(({ title, signature }) => (
        <View key={title} style={s.signatureBox}>
          <T style={s.signatureTitle}>{title}</T>
          {line(labels.name, signature?.name ?? null)}
          {line(labels.position, signature?.position ?? null)}
          {line(
            labels.date,
            signature ? formatDate(calendarDateInTimeZone(signature.signedAt, timeZone)) : null
          )}
          {line(labels.signature, null)}
        </View>
      ))}
    </View>
  );
}

/** "PAID BY {org}" with the payment date, on posted payment vouchers (BPV-35). */
export function PaidStamp({ text, date }: { text: string; date: string }) {
  const s = useKitStyles();
  return (
    <View fixed style={s.paidStamp}>
      <T style={[s.paidStampTitle, s.english]}>{text}</T>
      <T style={s.paidStampDate}>{formatDate(date)}</T>
    </View>
  );
}

/** The approved waivers of the chain (FR-050); nothing when there are none. */
export function WaiverBadge({ label, numbers }: { label: string; numbers: readonly string[] }) {
  const s = useKitStyles();
  if (numbers.length === 0) return null;
  return (
    <View style={s.waiverBadge} wrap={false}>
      <T style={s.waiverBadgeLabel}>{label}</T>
      <T style={s.waiverBadgeNumbers}>{numbers.join(', ')}</T>
    </View>
  );
}

export interface FooterProps {
  number: string;
  printedLabel(date: string): string;
  printedAt: string;
  timeZone: string;
  pageLabel(page: number, pages: number): string;
}

/** Number, printed DD/MM/YYYY HH:mm and page x / y on every page. */
export function Footer({ number, printedLabel, printedAt, timeZone, pageLabel }: FooterProps) {
  const s = useKitStyles();
  return (
    <>
      <View fixed style={s.footer}>
        <T style={[s.footerNumber, s.english]}>{number}</T>
        <T style={s.footerPrinted}>{printedLabel(formatDateTime(printedAt, timeZone))}</T>
      </View>
      {/* a `render` Text inside a fixed View drops the whole View, so it stands alone;
          it must not get `lineHeight` (s.text) either */}
      <Text
        fixed
        style={s.pageNumber}
        render={({ pageNumber, totalPages }) => pageLabel(pageNumber, totalPages)}
      />
    </>
  );
}
