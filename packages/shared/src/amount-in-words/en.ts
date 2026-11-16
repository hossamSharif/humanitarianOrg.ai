// English number words for amounts: 870710 → 'eight hundred seventy thousand seven hundred ten'.
import { MAX_WHOLE } from './types';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

/** 1..999 */
function group(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(`${ONES[hundreds]} hundred`);
  if (rest > 0 && rest < 20) words.push(ONES[rest]!);
  else if (rest >= 20) {
    const ones = rest % 10;
    words.push(ones === 0 ? TENS[rest / 10]! : `${TENS[Math.floor(rest / 10)]}-${ONES[ones]}`);
  }
  return words.join(' ');
}

/** Whole number 0..MAX_WHOLE in English words, lower case. */
export function toWordsEn(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_WHOLE) {
    throw new RangeError(`Cannot spell ${n}`);
  }
  if (n === 0) return ONES[0]!;
  const words: string[] = [];
  for (let scale = SCALES.length - 1; scale >= 0; scale--) {
    const k = Math.floor(n / 1000 ** scale) % 1000;
    if (k > 0) words.push(scale === 0 ? group(k) : `${group(k)} ${SCALES[scale]}`);
  }
  return words.join(' ');
}

/** 870710, 0 + SDG names → 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only'. */
export function amountWordsEn(
  whole: number,
  minor: number,
  names: { singular: string; plural: string; minorSingular: string; minorPlural: string }
): string {
  const parts: string[] = [];
  if (whole > 0 || minor === 0) {
    parts.push(`${toWordsEn(whole)} ${whole === 1 ? names.singular : names.plural}`);
  }
  if (minor > 0) {
    parts.push(`${toWordsEn(minor)} ${minor === 1 ? names.minorSingular : names.minorPlural}`);
  }
  const text = `${parts.join(' and ')} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
