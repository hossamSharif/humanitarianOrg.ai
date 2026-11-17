// Voucher arithmetic (contracts/posting-rules.md §1): base amounts, totals, the rounding residue
// and the Actual of a line in the grant currency. Pure and decimal.js-based.
import { Decimal, parseAmount } from '../money';
import { halfUp2, toBase } from './rates';

export interface BaseAmounts {
  debit: string;
  credit: string;
  rateToBase: string;
}

/** base_debit / base_credit = half-up₂(amount × rate), exactly as the database checks them. */
export function baseOf(line: BaseAmounts): { baseDebit: string; baseCredit: string } {
  return {
    baseDebit: toBase(line.debit, line.rateToBase),
    baseCredit: toBase(line.credit, line.rateToBase),
  };
}

export interface BaseTotals {
  baseDebit: string;
  baseCredit: string;
  /** debit − credit */
  difference: string;
}

export function baseTotals(
  lines: readonly { baseDebit: string; baseCredit: string }[]
): BaseTotals {
  const debit = lines.reduce((s, l) => s.plus(parseAmount(l.baseDebit)), new Decimal(0));
  const credit = lines.reduce((s, l) => s.plus(parseAmount(l.baseCredit)), new Decimal(0));
  return {
    baseDebit: debit.toFixed(2),
    baseCredit: credit.toFixed(2),
    difference: debit.minus(credit).toFixed(2),
  };
}

/** Σ base debit = Σ base credit > 0 (FR-069). */
export function isBalanced(lines: readonly { baseDebit: string; baseCredit: string }[]): boolean {
  const t = baseTotals(lines);
  return parseAmount(t.difference).isZero() && parseAmount(t.baseDebit).gt(0);
}

/**
 * A difference that only rounding explains: |diff| ≤ 0.01 × number of lines. Anything larger is
 * a generation bug (UNBALANCED), not a user error.
 */
export function isRoundingResidue(difference: string, lineCount: number): boolean {
  const diff = parseAmount(difference).abs();
  return diff.gt(0) && diff.lte(new Decimal('0.01').times(lineCount));
}

/**
 * Actual in the grant currency: half-up₂((debit − credit) × r(T) ÷ r(G)); negative for credits
 * (a refund or the source side of a reclassification lowers Actual).
 */
export function actualGrantAmount(input: {
  debit: string;
  credit: string;
  rateToBase: string;
  grantRateToBase: string;
}): string {
  const net = parseAmount(input.debit).minus(parseAmount(input.credit));
  return halfUp2(
    net.times(parseAmount(input.rateToBase)).dividedBy(parseAmount(input.grantRateToBase))
  );
}
