import { describe, expect, it } from 'vitest';
import { amountInWords, toWordsAr, toWordsEn, type CurrencyNames } from '../src/amount-in-words';

// rows of migration 0008_seed_reference.sql
const SDG: CurrencyNames = {
  code: 'SDG',
  minorUnits: 2,
  nameArSingular: 'جنيه سوداني',
  nameArDual: 'جنيهان سودانيان',
  nameArPlural: 'جنيهات سودانية',
  nameEnSingular: 'Sudanese Pound',
  nameEnPlural: 'Sudanese Pounds',
  minorNameArSingular: 'قرش',
  minorNameArDual: 'قرشان',
  minorNameArPlural: 'قروش',
  minorNameEnSingular: 'Piastre',
  minorNameEnPlural: 'Piastres',
};
const USD: CurrencyNames = {
  code: 'USD',
  minorUnits: 2,
  nameArSingular: 'دولار أمريكي',
  nameArDual: 'دولاران أمريكيان',
  nameArPlural: 'دولارات أمريكية',
  nameEnSingular: 'US Dollar',
  nameEnPlural: 'US Dollars',
  minorNameArSingular: 'سنت',
  minorNameArDual: 'سنتان',
  minorNameArPlural: 'سنتات',
  minorNameEnSingular: 'Cent',
  minorNameEnPlural: 'Cents',
};
const JOD3: CurrencyNames = { ...USD, code: 'JOD', minorUnits: 3 };
const WHOLE0: CurrencyNames = { ...USD, code: 'XAF', minorUnits: 0 };

describe('amountInWords — the RTHA PR 0010 total (SC-006)', () => {
  it('spells 870710.00 SDG in Arabic', () => {
    expect(amountInWords('870710.00', SDG, 'ar')).toBe(
      'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير'
    );
  });

  it('spells 870710.00 SDG in English', () => {
    expect(amountInWords('870710.00', SDG, 'en')).toBe(
      'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only'
    );
  });
});

describe('toWordsEn — 0 to 1,000', () => {
  it.each([
    [0, 'zero'],
    [1, 'one'],
    [7, 'seven'],
    [10, 'ten'],
    [11, 'eleven'],
    [15, 'fifteen'],
    [19, 'nineteen'],
    [20, 'twenty'],
    [21, 'twenty-one'],
    [45, 'forty-five'],
    [99, 'ninety-nine'],
    [100, 'one hundred'],
    [101, 'one hundred one'],
    [110, 'one hundred ten'],
    [119, 'one hundred nineteen'],
    [250, 'two hundred fifty'],
    [999, 'nine hundred ninety-nine'],
    [1000, 'one thousand'],
  ])('%i → %s', (n, words) => {
    expect(toWordsEn(n)).toBe(words);
  });

  it('spells every number 0–1,000 without gaps or double spaces', () => {
    for (let n = 0; n <= 1000; n++) {
      const words = toWordsEn(n);
      expect(words, String(n)).toMatch(/^[a-z]+([ -][a-z]+)*$/);
    }
    expect(new Set(Array.from({ length: 1001 }, (_, n) => toWordsEn(n))).size).toBe(1001);
  });
});

describe('toWordsEn — scale boundaries', () => {
  it.each([
    [1001, 'one thousand one'],
    [9999, 'nine thousand nine hundred ninety-nine'],
    [10_000, 'ten thousand'],
    [100_000, 'one hundred thousand'],
    [999_999, 'nine hundred ninety-nine thousand nine hundred ninety-nine'],
    [1_000_000, 'one million'],
    [1_000_001, 'one million one'],
    [2_500_000, 'two million five hundred thousand'],
    [999_999_999, 'nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine'],
    [1_000_000_000, 'one billion'],
    [3_000_000_007, 'three billion seven'],
    [1_000_000_000_000, 'one trillion'],
  ])('%i → %s', (n, words) => {
    expect(toWordsEn(n)).toBe(words);
  });

  it('rejects negatives, fractions and numbers beyond the trillions', () => {
    expect(() => toWordsEn(-1)).toThrow(RangeError);
    expect(() => toWordsEn(1.5)).toThrow(RangeError);
    expect(() => toWordsEn(1_000_000_000_000_000)).toThrow(RangeError);
  });
});

describe('toWordsAr — 0 to 1,000 (no counted noun)', () => {
  it.each([
    [0, 'صفر'],
    [1, 'واحد'],
    [2, 'اثنان'],
    [3, 'ثلاثة'],
    [8, 'ثمانية'],
    [10, 'عشرة'],
    [11, 'أحد عشر'],
    [12, 'اثنا عشر'],
    [13, 'ثلاثة عشر'],
    [19, 'تسعة عشر'],
    [20, 'عشرون'],
    [21, 'واحد وعشرون'],
    [22, 'اثنان وعشرون'],
    [35, 'خمسة وثلاثون'],
    [99, 'تسعة وتسعون'],
    [100, 'مائة'],
    [101, 'مائة وواحد'],
    [110, 'مائة وعشرة'],
    [200, 'مائتان'],
    [215, 'مائتان وخمسة عشر'],
    [300, 'ثلاثمائة'],
    [710, 'سبعمائة وعشرة'],
    [800, 'ثمانمائة'],
    [999, 'تسعمائة وتسعة وتسعون'],
    [1000, 'ألف'],
  ])('%i → %s', (n, words) => {
    expect(toWordsAr(n)).toBe(words);
  });

  it('spells every number 0–1,000 uniquely, words joined by و', () => {
    const seen = new Set<string>();
    for (let n = 0; n <= 1000; n++) {
      const words = toWordsAr(n);
      expect(words, String(n)).not.toMatch(/\s{2}|^\s|\s$|undefined/);
      seen.add(words);
    }
    expect(seen.size).toBe(1001);
  });
});

describe('toWordsAr — thousands, millions, billions', () => {
  it.each([
    [1000, 'ألف'],
    [2000, 'ألفان'],
    [3000, 'ثلاثة آلاف'],
    [10_000, 'عشرة آلاف'],
    [11_000, 'أحد عشر ألفاً'],
    [99_000, 'تسعة وتسعون ألفاً'],
    [100_000, 'مائة ألف'],
    [103_000, 'مائة وثلاثة آلاف'],
    [870_000, 'ثمانمائة وسبعون ألفاً'],
    [1001, 'ألف وواحد'],
    [1_000_000, 'مليون'],
    [2_000_000, 'مليونان'],
    [5_000_000, 'خمسة ملايين'],
    [25_000_000, 'خمسة وعشرون مليوناً'],
    [1_000_000_000, 'مليار'],
    [2_000_000_000, 'ملياران'],
    [7_000_000_000, 'سبعة مليارات'],
    [1_002_003_004, 'مليار ومليونان وثلاثة آلاف وأربعة'],
  ])('%i → %s', (n, words) => {
    expect(toWordsAr(n)).toBe(words);
  });
});

describe('amountInWords — Arabic number–noun agreement', () => {
  const ar = (amount: string, currency = SDG) => amountInWords(amount, currency, 'ar');

  it.each([
    ['0.00', 'فقط صفر جنيه سوداني لا غير'],
    ['1.00', 'فقط جنيه سوداني واحد لا غير'],
    ['2.00', 'فقط جنيهان سودانيان لا غير'],
    ['3.00', 'فقط ثلاثة جنيهات سودانية لا غير'],
    ['10.00', 'فقط عشرة جنيهات سودانية لا غير'],
    ['11.00', 'فقط أحد عشر جنيهاً سودانياً لا غير'],
    ['12.00', 'فقط اثنا عشر جنيهاً سودانياً لا غير'],
    ['21.00', 'فقط واحد وعشرون جنيهاً سودانياً لا غير'],
    ['99.00', 'فقط تسعة وتسعون جنيهاً سودانياً لا غير'],
    ['100.00', 'فقط مائة جنيه سوداني لا غير'],
    ['101.00', 'فقط مائة وواحد جنيه سوداني لا غير'],
    ['102.00', 'فقط مائة واثنان جنيه سوداني لا غير'],
    ['105.00', 'فقط مائة وخمسة جنيهات سودانية لا غير'],
    ['150.00', 'فقط مائة وخمسون جنيهاً سودانياً لا غير'],
    ['200.00', 'فقط مائتا جنيه سوداني لا غير'],
    ['1000.00', 'فقط ألف جنيه سوداني لا غير'],
    ['2000.00', 'فقط ألفا جنيه سوداني لا غير'],
    ['5000.00', 'فقط خمسة آلاف جنيه سوداني لا غير'],
    ['15000.00', 'فقط خمسة عشر ألف جنيه سوداني لا غير'],
    ['870000.00', 'فقط ثمانمائة وسبعون ألف جنيه سوداني لا غير'],
    ['1000000.00', 'فقط مليون جنيه سوداني لا غير'],
    ['2000000.00', 'فقط مليونا جنيه سوداني لا غير'],
    ['1001000.00', 'فقط مليون وألف جنيه سوداني لا غير'],
    ['2000000000.00', 'فقط مليارا جنيه سوداني لا غير'],
    ['1003.00', 'فقط ألف وثلاثة جنيهات سودانية لا غير'],
    ['12345.00', 'فقط اثنا عشر ألفاً وثلاثمائة وخمسة وأربعون جنيهاً سودانياً لا غير'],
  ])('%s SDG → %s', (amount, words) => {
    expect(ar(amount)).toBe(words);
  });

  it('spells fractional minor units (piastres / cents)', () => {
    expect(ar('870710.50')).toBe(
      'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية وخمسون قرشاً لا غير'
    );
    expect(ar('5.01')).toBe('فقط خمسة جنيهات سودانية وقرش واحد لا غير');
    expect(ar('5.02')).toBe('فقط خمسة جنيهات سودانية وقرشان لا غير');
    expect(ar('5.07')).toBe('فقط خمسة جنيهات سودانية وسبعة قروش لا غير');
    expect(ar('0.25')).toBe('فقط خمسة وعشرون قرشاً لا غير');
    expect(ar('12.50', USD)).toBe('فقط اثنا عشر دولاراً أمريكياً وخمسون سنتاً لا غير');
    expect(ar('11.11', USD)).toBe('فقط أحد عشر دولاراً أمريكياً وأحد عشر سنتاً لا غير');
  });

  it('rounds half-up to the currency minor units before spelling', () => {
    expect(ar('1.995')).toBe('فقط جنيهان سودانيان لا غير');
    expect(ar('3.004')).toBe('فقط ثلاثة جنيهات سودانية لا غير');
  });
});

describe('amountInWords — English', () => {
  const en = (amount: string, currency = SDG) => amountInWords(amount, currency, 'en');

  it.each([
    ['0.00', 'Zero Sudanese Pounds only'],
    ['1.00', 'One Sudanese Pound only'],
    ['2.00', 'Two Sudanese Pounds only'],
    ['1000.00', 'One thousand Sudanese Pounds only'],
    ['0.01', 'One Piastre only'],
    ['0.50', 'Fifty Piastres only'],
    ['870710.50', 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds and fifty Piastres only'],
  ])('%s SDG → %s', (amount, words) => {
    expect(en(amount)).toBe(words);
  });

  it('uses the currency names from the currency table', () => {
    expect(en('12.50', USD)).toBe('Twelve US Dollars and fifty Cents only');
    expect(en('1.01', USD)).toBe('One US Dollar and one Cent only');
  });
});

describe('amountInWords — currency minor units and limits', () => {
  it('handles currencies with 3 or 0 minor units', () => {
    expect(amountInWords('1.005', JOD3, 'en')).toBe('One US Dollar and five Cents only');
    expect(amountInWords('7.4', WHOLE0, 'en')).toBe('Seven US Dollars only');
    expect(amountInWords('7.5', WHOLE0, 'ar')).toBe('فقط ثمانية دولارات أمريكية لا غير');
  });

  it('rejects negative, malformed and oversized amounts', () => {
    expect(() => amountInWords('-1.00', SDG, 'en')).toThrow(RangeError);
    expect(() => amountInWords('1,000.00', SDG, 'en')).toThrow();
    expect(() => amountInWords('1000000000000000.00', SDG, 'ar')).toThrow(RangeError);
  });
});
