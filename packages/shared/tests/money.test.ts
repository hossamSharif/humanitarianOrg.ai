import { describe, expect, it } from 'vitest';
import {
  add,
  convertLine,
  formatAmount,
  multiply,
  parseAmount,
  roundHalfUp,
  sumByCurrency,
} from '../src/money';

describe('parseAmount', () => {
  it('accepts decimal strings and numbers-as-strings', () => {
    expect(parseAmount('870710.00').toFixed(2)).toBe('870710.00');
    expect(parseAmount('0').toFixed(2)).toBe('0.00');
    expect(parseAmount('-12.5').toFixed(2)).toBe('-12.50');
  });

  it('rejects anything that is not a plain decimal string', () => {
    for (const bad of ['', ' ', 'abc', '1,000.00', '1e5', 'NaN', 'Infinity', '1.2.3', '+-1']) {
      expect(() => parseAmount(bad), bad).toThrow();
    }
  });
});

describe('roundHalfUp', () => {
  it('rounds half away from zero to the minor units', () => {
    expect(roundHalfUp('2.345', 2)).toBe('2.35');
    expect(roundHalfUp('2.344', 2)).toBe('2.34');
    expect(roundHalfUp('-2.345', 2)).toBe('-2.35');
    expect(roundHalfUp('10.5', 0)).toBe('11');
    expect(roundHalfUp('1.0005', 3)).toBe('1.001');
  });

  it('is exact where binary floats are not', () => {
    // 1.005 * 100 = 100.49999999999999 in IEEE-754
    expect(roundHalfUp('1.005', 2)).toBe('1.01');
    expect(
      roundHalfUp(
        add({ amount: '0.1', currency: 'USD' }, { amount: '0.2', currency: 'USD' }).amount,
        2
      )
    ).toBe('0.30');
  });
});

describe('add / multiply', () => {
  it('adds amounts of the same currency', () => {
    expect(
      add({ amount: '870000.00', currency: 'SDG' }, { amount: '710.00', currency: 'SDG' })
    ).toEqual({
      amount: '870710.00',
      currency: 'SDG',
    });
  });

  it('refuses to add different currencies', () => {
    expect(() => add({ amount: '1', currency: 'SDG' }, { amount: '1', currency: 'USD' })).toThrow(
      /different currencies/i
    );
  });

  it('multiplies quantity by unit cost without float error', () => {
    expect(multiply('3', '10.01')).toBe('30.03');
    expect(multiply('0.1', '0.2')).toBe('0.02');
    expect(multiply('2.5', '1.333')).toBe('3.3325');
  });
});

describe('formatAmount', () => {
  it('uses , thousands, 2 decimals and the code after the amount', () => {
    expect(formatAmount({ amount: '870710', currency: 'SDG' })).toBe('870,710.00 SDG');
    expect(formatAmount({ amount: '1234567.891', currency: 'USD' })).toBe('1,234,567.89 USD');
    expect(formatAmount({ amount: '0', currency: 'EUR' })).toBe('0.00 EUR');
    expect(formatAmount({ amount: '-1500.5', currency: 'SDG' })).toBe('-1,500.50 SDG');
  });

  it('respects other minor units when given', () => {
    expect(formatAmount({ amount: '1500.4', currency: 'XAF' }, { minorUnits: 0 })).toBe(
      '1,500 XAF'
    );
  });
});

describe('convertLine (research R7)', () => {
  it('converts line → base → target and rounds half-up per line', () => {
    // 870,710 SDG at 1 SDG = 1 base; USD 1 = 600 SDG → 1451.183333… → 1451.18
    expect(convertLine('870710.00', '1', '600', 2)).toBe('1451.18');
    // USD line into a USD grant is unchanged
    expect(convertLine('100.00', '600', '600', 2)).toBe('100.00');
    // EUR line into a USD grant: 100 EUR × 650 ÷ 600 = 108.3333… → 108.33
    expect(convertLine('100.00', '650', '600', 2)).toBe('108.33');
  });

  it('rounds a .5 boundary up', () => {
    // 1 × 1 ÷ 8 = 0.125 → 0.13
    expect(convertLine('1.00', '1', '8', 2)).toBe('0.13');
  });

  it('rejects non-positive rates', () => {
    expect(() => convertLine('1.00', '0', '1', 2)).toThrow();
    expect(() => convertLine('1.00', '1', '-1', 2)).toThrow();
  });
});

describe('sumByCurrency', () => {
  it('returns one total per currency in first-seen order', () => {
    expect(
      sumByCurrency([
        { amount: '100.10', currency: 'SDG' },
        { amount: '5.00', currency: 'USD' },
        { amount: '0.20', currency: 'SDG' },
      ])
    ).toEqual([
      { amount: '100.30', currency: 'SDG' },
      { amount: '5.00', currency: 'USD' },
    ]);
  });

  it('returns an empty list for no items', () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
