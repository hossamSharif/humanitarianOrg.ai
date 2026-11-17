import { describe, expect, it } from 'vitest';
import { baseRate, convert, halfUp2, toBase } from '../../src/accounting/rates';

describe('halfUp2', () => {
  it('rounds half away from zero to 2 decimals', () => {
    expect(halfUp2('1.005')).toBe('1.01');
    expect(halfUp2('1.004')).toBe('1.00');
    expect(halfUp2('-1.005')).toBe('-1.01');
    expect(halfUp2('870710')).toBe('870710.00');
  });
});

describe('toBase', () => {
  it('multiplies by the rate and rounds once', () => {
    expect(toBase('100.00', '600')).toBe('60000.00');
    expect(toBase('1450.50', '0.001667')).toBe('2.42');
  });

  it('keeps base-currency amounts unchanged at rate 1', () => {
    expect(toBase('3040800.00', '1')).toBe('3040800.00');
  });

  it('rejects a zero or negative rate', () => {
    expect(() => toBase('1', '0')).toThrow(RangeError);
    expect(() => toBase('1', '-2')).toThrow(RangeError);
  });
});

describe('convert', () => {
  it('converts through the base currency: SDG → USD at 600 SDG per USD', () => {
    expect(convert('870710.00', '1', '600')).toBe('1451.18');
  });

  it('converts between two foreign currencies', () => {
    // 100 EUR (650 SDG) → USD (600 SDG) = 108.333… → 108.33
    expect(convert('100', '650', '600')).toBe('108.33');
  });

  it('is the identity for equal rates', () => {
    expect(convert('48.04', '600', '600')).toBe('48.04');
  });
});

describe('baseRate', () => {
  it('is rate 1 from the base source with no rate row', () => {
    expect(baseRate('2026-11-16')).toEqual({
      rateToBase: '1',
      rateDate: '2026-11-16',
      rateSource: 'base',
      exchangeRateId: null,
    });
  });
});
