// PR PDF styles (contracts/print-layout.md): the shared print-kit stylesheet plus the PR item
// table's columns, in reading order (the Arabic template reverses the row).
import type { PrintLocale } from '@ngo/shared';
import { kitStyles, type KitColumn } from '@/features/print-kit/styles';

export const COLUMNS = [
  { key: 'no', width: '5%', align: 'center' },
  { key: 'description', width: '26%', align: 'start' },
  { key: 'quantity', width: '7%', align: 'number' },
  { key: 'unit', width: '8%', align: 'start' },
  { key: 'unitCost', width: '11%', align: 'number' },
  { key: 'total', width: '13%', align: 'number' },
  { key: 'donor', width: '9%', align: 'center' },
  { key: 'location', width: '10%', align: 'start' },
  { key: 'budgetLine', width: '11%', align: 'center' },
] as const satisfies readonly KitColumn[];

export type ColumnKey = (typeof COLUMNS)[number]['key'];

export function pdfStyles(locale: PrintLocale) {
  return kitStyles(locale);
}

export type PdfStyles = ReturnType<typeof pdfStyles>;
