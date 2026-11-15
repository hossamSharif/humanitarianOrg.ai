import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone, isValidTimeZone } from '../src/format/date';

describe('calendarDateInTimeZone', () => {
  it('uses the organization timezone, not UTC', () => {
    // 31/12/2025 23:30 UTC is already 01/01/2026 in Khartoum (UTC+2)
    expect(calendarDateInTimeZone('2025-12-31T23:30:00Z', 'Africa/Khartoum')).toBe('2026-01-01');
    expect(calendarDateInTimeZone('2025-12-31T23:30:00Z', 'UTC')).toBe('2025-12-31');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimeZone('Africa/Khartoum')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Africa/Khartoum; drop')).toBe(false);
  });
});
