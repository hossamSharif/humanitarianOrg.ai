// Amount in words for printed documents (research R14, Business Rule 12, SC-006). The only
// source of "total in words" on a PR printout; never taken from user input.
import { roundHalfUp } from '../money';
import { amountWordsAr } from './ar';
import { amountWordsEn } from './en';
import { MAX_WHOLE, type CurrencyNames } from './types';

export type { CurrencyNames } from './types';
export { toWordsEn } from './en';
export { toWordsAr } from './ar';

/**
 * '870710.00', SDG, 'ar' → 'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير';
 * 'en' → 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only'.
 * The amount is rounded half-up to the currency's minor units first.
 */
export function amountInWords(
  amount: string,
  currency: CurrencyNames,
  locale: 'ar' | 'en'
): string {
  const fixed = roundHalfUp(amount, currency.minorUnits);
  if (fixed.startsWith('-')) throw new RangeError(`Cannot spell a negative amount: ${amount}`);
  const [wholeText = '0', minorText = ''] = fixed.split('.');
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole > MAX_WHOLE) {
    throw new RangeError(`Amount too large to spell: ${amount}`);
  }
  const minor = minorText ? Number(minorText) : 0;

  if (locale === 'ar') {
    return amountWordsAr(whole, minor, {
      major: {
        singular: currency.nameArSingular,
        dual: currency.nameArDual,
        plural: currency.nameArPlural,
      },
      minor: {
        singular: currency.minorNameArSingular,
        dual: currency.minorNameArDual,
        plural: currency.minorNameArPlural,
      },
    });
  }
  return amountWordsEn(whole, minor, {
    singular: currency.nameEnSingular,
    plural: currency.nameEnPlural,
    minorSingular: currency.minorNameEnSingular,
    minorPlural: currency.minorNameEnPlural,
  });
}
