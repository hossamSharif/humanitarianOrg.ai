// Advance, retention and deductions of a payment against a PO (research R25, FR-057). Pure and
// decimal.js-based; every amount is a decimal string in one currency, rounded half-up to 2
// decimals once per figure.
import { Decimal, parseAmount } from '../money';
import type { DeductionAppliesTo } from '../schemas/procurement-config';

const half2 = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const pct = (value: string) => parseAmount(value).dividedBy(100);

/** What an advance request may still ask for: advance_pct × total − advances already requested. */
export function advanceLimit(input: {
  advancePct: string;
  poTotal: string;
  priorAdvances: string;
}): string {
  const limit = half2(pct(input.advancePct).times(parseAmount(input.poTotal))).minus(
    parseAmount(input.priorAdvances)
  );
  return Decimal.max(limit, 0).toFixed(2);
}

/**
 * The advance recovered by a payment: advance_paid × (gross ÷ PO total), half-up, never more
 * than what is still to recover; the final payment clears the remainder.
 */
export function advanceDeduction(input: {
  advancePaid: string;
  alreadyDeducted: string;
  gross: string;
  poTotal: string;
  isFinal: boolean;
}): string {
  const remaining = Decimal.max(
    parseAmount(input.advancePaid).minus(parseAmount(input.alreadyDeducted)),
    0
  );
  const total = parseAmount(input.poTotal);
  if (remaining.isZero() || total.isZero()) return '0.00';
  if (input.isFinal) return remaining.toFixed(2);
  const share = half2(
    parseAmount(input.advancePaid).times(parseAmount(input.gross)).dividedBy(total)
  );
  return Decimal.min(share, remaining, parseAmount(input.gross)).toFixed(2);
}

/** retention_pct × gross, half-up. */
export function retentionAmount(gross: string, retentionPct: string): string {
  return half2(parseAmount(gross).times(pct(retentionPct))).toFixed(2);
}

export interface DeductionRule {
  id: string;
  ratePct: string;
  appliesTo: DeductionAppliesTo;
}

export interface DeductionAmount {
  id: string;
  base: string;
  ratePct: string;
  amount: string;
}

/** Each applicable deduction on `base`: round(base × rate ÷ 100, 2). */
export function deductionAmounts(
  base: string,
  rules: readonly DeductionRule[],
  isService: boolean
): DeductionAmount[] {
  return rules
    .filter((r) => r.appliesTo === 'both' || r.appliesTo === (isService ? 'services' : 'goods'))
    .map((r) => ({
      id: r.id,
      base: parseAmount(base).toFixed(2),
      ratePct: r.ratePct,
      amount: half2(parseAmount(base).times(pct(r.ratePct))).toFixed(2),
    }));
}

/** net = gross − advance − retention − Σ deductions; refused below zero. */
export function netAmount(input: {
  gross: string;
  advanceDeduction: string;
  retention: string;
  deductions: readonly string[];
}): string {
  const net = input.deductions.reduce(
    (sum, d) => sum.minus(parseAmount(d)),
    parseAmount(input.gross)
      .minus(parseAmount(input.advanceDeduction))
      .minus(parseAmount(input.retention))
  );
  if (net.isNegative()) throw new RangeError('The deductions exceed the gross amount');
  return net.toFixed(2);
}

/**
 * Spreads `amount` over weighted parts (e.g. PO line totals) half-up; the largest part takes
 * the rounding residue so the parts add up exactly.
 */
export function spreadAmount(amount: string, weights: readonly string[]): string[] {
  const total = weights.reduce((sum, w) => sum.plus(parseAmount(w)), new Decimal(0));
  const target = parseAmount(amount);
  if (weights.length === 0) return [];
  if (total.isZero()) return weights.map((_, i) => (i === 0 ? target.toFixed(2) : '0.00'));
  const parts = weights.map((w) => half2(target.times(parseAmount(w)).dividedBy(total)));
  const residue = target.minus(parts.reduce((sum, p) => sum.plus(p), new Decimal(0)));
  let largest = 0;
  weights.forEach((w, i) => {
    if (parseAmount(w).gt(parseAmount(weights[largest]!))) largest = i;
  });
  parts[largest] = parts[largest]!.plus(residue);
  return parts.map((p) => p.toFixed(2));
}
