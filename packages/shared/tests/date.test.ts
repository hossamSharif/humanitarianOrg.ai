import { describe, expect, it } from 'vitest';
import { addDays, formatDate, formatDateTime, parseDisplayDate } from '../src/format/date';

describe('formatDate', () => {
  it('formats ISO dates as DD/MM/YYYY by slicing (no timezone shift)', () => {
    expect(formatDate('2026-11-10')).toBe('10/11/2026');
    expect(formatDate('2026-01-02')).toBe('02/01/2026');
    expect(formatDate('1999-12-31')).toBe('31/12/1999');
  });

  it('accepts an ISO timestamp and uses its date part', () => {
    expect(formatDate('2026-11-10T23:30:00Z')).toBe('10/11/2026');
  });

  it('returns an empty string for null/undefined/empty', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });

  it('throws on non-ISO input', () => {
    expect(() => formatDate('10/11/2026')).toThrow();
    expect(() => formatDate('2026-13-01')).toThrow();
  });
});

describe('parseDisplayDate', () => {
  it('parses DD/MM/YYYY into ISO', () => {
    expect(parseDisplayDate('10/11/2026')).toBe('2026-11-10');
    expect(parseDisplayDate('02/01/2026')).toBe('2026-01-02');
  });

  it('accepts single-digit day and month and surrounding spaces', () => {
    expect(parseDisplayDate(' 2/1/2026 ')).toBe('2026-01-02');
  });

  it('accepts Arabic-Indic digits typed on Arabic keyboards', () => {
    expect(parseDisplayDate('١٠/١١/٢٠٢٦')).toBe('2026-11-10');
  });

  it('rejects impossible or malformed dates', () => {
    for (const bad of [
      '31/02/2026',
      '29/02/2025',
      '00/01/2026',
      '01/13/2026',
      '2026-11-10',
      '1/1/26',
      'abc',
      '',
    ]) {
      expect(parseDisplayDate(bad), bad).toBeNull();
    }
  });

  it('accepts 29 February in leap years', () => {
    expect(parseDisplayDate('29/02/2028')).toBe('2028-02-29');
  });
});

describe('formatDateTime', () => {
  it('converts an instant to the tenant timezone as DD/MM/YYYY HH:mm (Latin digits)', () => {
    // Africa/Khartoum is UTC+2
    expect(formatDateTime('2026-11-10T22:30:00Z', 'Africa/Khartoum')).toBe('11/11/2026 00:30');
    expect(formatDateTime('2026-11-10T08:05:00Z', 'UTC')).toBe('10/11/2026 08:05');
  });

  it('uses 24-hour time', () => {
    expect(formatDateTime('2026-11-10T13:00:00Z', 'UTC')).toBe('10/11/2026 13:00');
    expect(formatDateTime('2026-11-10T00:00:00Z', 'UTC')).toBe('10/11/2026 00:00');
  });

  it('accepts Date objects and returns empty for null', () => {
    expect(formatDateTime(new Date('2026-11-10T08:05:00Z'), 'UTC')).toBe('10/11/2026 08:05');
    expect(formatDateTime(null, 'UTC')).toBe('');
  });
});

describe('addDays', () => {
  it('moves across month and year boundaries', () => {
    expect(addDays('2026-11-10', -30)).toBe('2026-10-11');
    expect(addDays('2026-01-02', -5)).toBe('2025-12-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-11-10', 0)).toBe('2026-11-10');
  });
});
