// Arabic number words for amounts with number–noun agreement (research R14). Every counted noun
// here — ألف, مليون, مليار, تريليون and the currency names (جنيه, دولار, قرش, سنت …) — is
// masculine, so 3–10 take the feminine form (ثلاثة … عشرة). The counted noun follows the last two
// digits of its count:
//   1 → singular (+ واحد for currencies), 2 → dual, 3–10 → plural, 11–99 → singular accusative,
//   x00 / x01 / x02 → singular.
// A count directly followed by another noun is in construct (إضافة): the dual drops its nun
// (ألفا جنيه, مائتا جنيه) and the accusative loses its tanween (سبعون ألف جنيه).
import { MAX_WHOLE } from './types';

const ONES = [
  'صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر',
  'ثمانية عشر', 'تسعة عشر',
];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة',
  'تسعمائة',
];

export interface ArNounForms {
  singular: string;
  dual: string;
  plural: string;
}

const SCALES: ArNounForms[] = [
  { singular: 'ألف', dual: 'ألفان', plural: 'آلاف' },
  { singular: 'مليون', dual: 'مليونان', plural: 'ملايين' },
  { singular: 'مليار', dual: 'ملياران', plural: 'مليارات' },
  { singular: 'تريليون', dual: 'تريليونان', plural: 'تريليونات' },
];

/** Construct form of a dual: ألفان → ألفا, جنيهان سودانيان → جنيها سودانيا. */
function construct(dual: string): string {
  return dual
    .split(' ')
    .map((word) => (word.endsWith('ان') ? word.slice(0, -1) : word))
    .join(' ');
}

/** Singular accusative (tanween fath) of each word: جنيه سوداني → جنيهاً سودانياً. */
export function accusative(singular: string): string {
  return singular
    .split(' ')
    .map((word) => {
      if (/[ةء]$/.test(word)) return `${word}ً`;
      if (/[اىو]$/.test(word)) return word; // يورو and other indeclinable endings
      return `${word}اً`;
    })
    .join(' ');
}

/** 1..999; `followed` = a noun comes next, so a bare مائتان is in construct. */
function group(n: number, followed: boolean): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) {
    words.push(hundreds === 2 && rest === 0 && followed ? 'مائتا' : HUNDREDS[hundreds]!);
  }
  if (rest > 0 && rest < 20) words.push(ONES[rest]!);
  else if (rest >= 20) {
    const ones = rest % 10;
    words.push(ones === 0 ? TENS[rest / 10]! : `${ONES[ones]} و${TENS[Math.floor(rest / 10)]}`);
  }
  return words.join(' و');
}

/** `count` thousands/millions/…; `followed`: the counted currency noun comes right after. */
function counted(count: number, noun: ArNounForms, followed: boolean): string {
  if (count === 1) return noun.singular;
  if (count === 2) return followed ? construct(noun.dual) : noun.dual;
  const rest = count % 100;
  let form: string;
  if (rest >= 3 && rest <= 10) form = noun.plural;
  else if (rest >= 11 && !followed) form = accusative(noun.singular);
  else form = noun.singular;
  return `${group(count, true)} ${form}`;
}

/**
 * Whole number 0..MAX_WHOLE in Arabic words. With `noun`, the noun is counted and agrees with
 * the number (870710 جنيه → ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية).
 */
export function toWordsAr(n: number, noun?: ArNounForms): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_WHOLE) {
    throw new RangeError(`Cannot spell ${n}`);
  }
  if (n === 0) return noun ? `${ONES[0]} ${noun.singular}` : ONES[0]!;

  const groups: number[] = []; // least significant first
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
  const units = groups[0]!;

  // n = 1, 2 or a count ending in a scale word with no units: the noun binds to the whole count
  if (noun && units === 0) {
    const parts: string[] = [];
    const lowest = groups.findIndex((k) => k > 0);
    for (let scale = groups.length - 1; scale >= 1; scale--) {
      const k = groups[scale]!;
      if (k > 0) parts.push(counted(k, SCALES[scale - 1]!, scale === lowest));
    }
    return `${parts.join(' و')} ${noun.singular}`;
  }

  const parts: string[] = [];
  for (let scale = groups.length - 1; scale >= 1; scale--) {
    const k = groups[scale]!;
    if (k > 0) parts.push(counted(k, SCALES[scale - 1]!, false));
  }
  if (!noun) {
    if (units > 0) parts.push(group(units, false));
    return parts.join(' و');
  }
  if (n === 1) return `${noun.singular} ${ONES[1]}`;
  if (n === 2) return noun.dual;

  const rest = units % 100;
  let form: string;
  if (rest >= 3 && rest <= 10) form = noun.plural;
  else if (rest >= 11) form = accusative(noun.singular);
  else form = noun.singular;
  parts.push(group(units, rest === 0));
  return `${parts.join(' و')} ${form}`;
}

/** 'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير' */
export function amountWordsAr(
  whole: number,
  minor: number,
  names: { major: ArNounForms; minor: ArNounForms }
): string {
  const parts: string[] = [];
  if (whole > 0 || minor === 0) parts.push(toWordsAr(whole, names.major));
  if (minor > 0) parts.push(toWordsAr(minor, names.minor));
  return `فقط ${parts.join(' و')} لا غير`;
}
