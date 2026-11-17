// Rate arithmetic for vouchers, commitments and conversions (research D5, Principle V). Rates
// are "1 unit = rate × base"; the base currency has rate 1. Every conversion rounds half-up to
// 2 decimals once, at the end, so a line's base amount is reproducible from its stored rate.
import { Decimal, parseAmount } from '../money';

/** The rate locked on a document line: what was used, as of when, and from where. */
export interface RateSnapshot {
  rateToBase: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
}

/** Base-currency snapshot (rate 1, source 'base'). */
export function baseRate(rateDate: string): RateSnapshot {
  return { rateToBase: '1', rateDate, rateSource: 'base', exchangeRateId: null };
}

/** Half-up to 2 decimals, as a decimal string. */
export function halfUp2(value: string | number | Decimal): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function positiveRate(rate: string): Decimal {
  const value = parseAmount(rate);
  if (value.lte(0)) throw new RangeError('Exchange rates must be greater than zero');
  return value;
}

/** amount × rate → base currency, 2 decimals. */
export function toBase(amount: string, rateToBase: string): string {
  return halfUp2(parseAmount(amount).times(positiveRate(rateToBase)));
}

/** amount in a currency with `fromRate` → a currency with `toRate`, through the base. */
export function convert(amount: string, fromRateToBase: string, toRateToBase: string): string {
  return halfUp2(
    parseAmount(amount).times(positiveRate(fromRateToBase)).dividedBy(positiveRate(toRateToBase))
  );
}
