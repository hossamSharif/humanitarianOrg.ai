// Money helpers (research R7). All arithmetic uses decimal.js — never JS `number`. Amounts cross
// the API as decimal strings with their currency: { amount: '870710.00', currency: 'SDG' }.
import DecimalBase from 'decimal.js';

/** Private Decimal constructor: 40 significant digits, half-up (away from zero) rounding. */
export const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

export interface Money {
  /** decimal string, e.g. '870710.00' */
  amount: string;
  /** ISO 4217 code */
  currency: string;
}

/** Minor units used when a currency's own value is not known (SDG, USD, EUR … all 2). */
export const DEFAULT_MINOR_UNITS = 2;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Parses a plain decimal string ('870710.00', '-12.5'); rejects exponents, separators, NaN. */
export function parseAmount(value: string): Decimal {
  if (!DECIMAL_STRING.test(value)) {
    throw new TypeError(`Not a decimal string: "${value}"`);
  }
  return new Decimal(value);
}

function toDecimal(value: DecimalBase.Value): Decimal {
  return typeof value === 'string' ? parseAmount(value) : new Decimal(value);
}

/** Rounds half away from zero to `minorUnits` decimals; returns a fixed-point string. */
export function roundHalfUp(value: DecimalBase.Value, minorUnits: number): string {
  return toDecimal(value).toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP).toFixed(minorUnits);
}

/** Exact sum of two amounts in the same currency. */
export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new RangeError(`Cannot add different currencies: ${a.currency} and ${b.currency}`);
  }
  const sum = parseAmount(a.amount).plus(parseAmount(b.amount));
  const dp = Math.max(decimals(a.amount), decimals(b.amount));
  return { amount: sum.toFixed(dp), currency: a.currency };
}

/** Exact product, e.g. quantity × unit cost; unrounded. */
export function multiply(a: string, b: string): string {
  return parseAmount(a).times(parseAmount(b)).toFixed();
}

/** '870,710.00 SDG' — `,` thousands separator, fixed minor units, code after the amount. */
export function formatAmount(
  money: Money,
  options: { minorUnits?: number; withCurrency?: boolean } = {}
): string {
  const minorUnits = options.minorUnits ?? DEFAULT_MINOR_UNITS;
  const fixed = roundHalfUp(money.amount, minorUnits);
  const negative = fixed.startsWith('-');
  const [whole = '0', fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const number = `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
  return options.withCurrency === false ? number : `${number} ${money.currency}`;
}

/**
 * Converts a line total into a target currency through the base currency:
 * lineTotal × rate(line→base) ÷ rate(target→base), rounded half-up per line to the target's minor
 * units. Rates are "1 unit = rate × base"; the base currency itself has rate 1.
 */
export function convertLine(
  lineTotal: string,
  rateToBase: string,
  targetRateToBase: string,
  targetMinorUnits: number
): string {
  const rate = parseAmount(rateToBase);
  const targetRate = parseAmount(targetRateToBase);
  if (rate.lte(0) || targetRate.lte(0)) {
    throw new RangeError('Exchange rates must be greater than zero');
  }
  return roundHalfUp(parseAmount(lineTotal).times(rate).dividedBy(targetRate), targetMinorUnits);
}

/** One total per currency, in the order currencies first appear. */
export function sumByCurrency(items: readonly Money[]): Money[] {
  const totals = new Map<string, Money>();
  for (const item of items) {
    const current = totals.get(item.currency);
    totals.set(item.currency, current ? add(current, item) : { ...item });
  }
  return [...totals.values()];
}

function decimals(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}
