// Three-way match of an invoice against the PO and the receipts (research R25, FR-055). Pure
// and decimal.js-based. Goods lines: the invoiced quantity is within the accepted quantity plus
// the quantity tolerance, and the invoiced price within the PO price plus the price tolerance.
// Service lines: the invoiced amount is within the certified amount plus the price tolerance.
import { Decimal, parseAmount } from '../money';

export type MatchResult = 'ok' | 'qty_exceeds' | 'price_exceeds';

export interface MatchTolerances {
  /** percentages, e.g. '0' or '5.00' */
  qtyTolerancePct: string;
  priceTolerancePct: string;
}

export interface GoodsMatchLine {
  invoicedQty: string;
  invoicedPrice: string;
  acceptedQty: string;
  poPrice: string;
}

export interface ServiceMatchLine {
  invoicedAmount: string;
  certifiedAmount: string;
}

const factor = (pct: string) => parseAmount(pct).dividedBy(100).plus(1);

/** invoiced_qty ≤ accepted × (1 + qty_tol) and invoiced_price ≤ po_price × (1 + price_tol). */
export function matchGoodsLine(line: GoodsMatchLine, tol: MatchTolerances): MatchResult {
  const maxQty = parseAmount(line.acceptedQty).times(factor(tol.qtyTolerancePct));
  if (parseAmount(line.invoicedQty).gt(maxQty)) return 'qty_exceeds';
  const maxPrice = parseAmount(line.poPrice).times(factor(tol.priceTolerancePct));
  if (parseAmount(line.invoicedPrice).gt(maxPrice)) return 'price_exceeds';
  return 'ok';
}

/** invoiced amount ≤ certified amount × (1 + price_tol). */
export function matchServiceLine(line: ServiceMatchLine, tol: MatchTolerances): MatchResult {
  const max = parseAmount(line.certifiedAmount).times(factor(tol.priceTolerancePct));
  return parseAmount(line.invoicedAmount).gt(max) ? 'price_exceeds' : 'ok';
}

/** matched when every line is ok; an empty match (advance, retention) is not applicable. */
export function matchStatus(results: readonly MatchResult[]): 'matched' | 'mismatch' | 'n_a' {
  if (results.length === 0) return 'n_a';
  return results.every((r) => r === 'ok') ? 'matched' : 'mismatch';
}

/** The largest quantity that still matches: accepted × (1 + tol), 3 decimals down. */
export function maxMatchedQty(acceptedQty: string, qtyTolerancePct: string): string {
  return parseAmount(acceptedQty)
    .times(factor(qtyTolerancePct))
    .toDecimalPlaces(3, Decimal.ROUND_DOWN)
    .toFixed(3);
}
