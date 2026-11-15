// T052 — PR number formatting (Business Rule 9, FR-004) and the submission-date year.
import type { NumberingConfigInput } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import type { TxSql } from '../../src/db/tx';
import {
  formatNumber,
  NumberingService,
  submissionYear,
} from '../../src/services/numbering.service';
import { InMemoryNumberingStore } from './helpers/in-memory-tenant-store';

const DEFAULTS: NumberingConfigInput = {
  prefix: 'PR',
  includeOffice: true,
  includeYear: true,
  padding: 4,
  separator: '-',
};

const fakeTx = {} as TxSql;

function service(store = new InMemoryNumberingStore()) {
  return { store, numbering: new NumberingService(store, () => store) };
}

describe('formatNumber', () => {
  it('formats the defaults as PR-MAD-2026-0010', () => {
    expect(formatNumber(DEFAULTS, 'MAD', 2026, 10)).toBe('PR-MAD-2026-0010');
  });

  it('omits the office code when include_office is false', () => {
    expect(formatNumber({ ...DEFAULTS, includeOffice: false }, 'MAD', 2026, 10)).toBe(
      'PR-2026-0010'
    );
  });

  it('omits the year when include_year is false', () => {
    expect(formatNumber({ ...DEFAULTS, includeYear: false }, 'MAD', 2026, 10)).toBe('PR-MAD-0010');
    expect(
      formatNumber({ ...DEFAULTS, includeOffice: false, includeYear: false }, 'MAD', 2026, 7)
    ).toBe('PR-0007');
  });

  it('pads to 1–10 digits and never truncates a longer sequence', () => {
    expect(formatNumber({ ...DEFAULTS, padding: 1 }, 'MAD', 2026, 7)).toBe('PR-MAD-2026-7');
    expect(formatNumber({ ...DEFAULTS, padding: 10 }, 'MAD', 2026, 7)).toBe(
      'PR-MAD-2026-0000000007'
    );
    expect(formatNumber({ ...DEFAULTS, padding: 2 }, 'MAD', 2026, 12345)).toBe('PR-MAD-2026-12345');
  });

  it('uses a custom prefix and separator (including none)', () => {
    expect(formatNumber({ ...DEFAULTS, prefix: 'REQ', separator: '/' }, 'KST', 2027, 3)).toBe(
      'REQ/KST/2027/0003'
    );
    expect(formatNumber({ ...DEFAULTS, separator: '' }, 'MAD', 2026, 10)).toBe('PRMAD20260010');
  });

  it('rejects sequences below 1 and padding outside 1–10', () => {
    expect(() => formatNumber(DEFAULTS, 'MAD', 2026, 0)).toThrow(RangeError);
    expect(() => formatNumber({ ...DEFAULTS, padding: 11 }, 'MAD', 2026, 1)).toThrow(RangeError);
  });
});

describe('submissionYear', () => {
  it('is the calendar year of the submission instant in the tenant timezone', () => {
    expect(submissionYear('2026-01-02T08:00:00Z', 'Africa/Khartoum')).toBe(2026);
    // 31/12/2025 23:30 UTC is 01/01/2026 01:30 in Khartoum (UTC+2)
    expect(submissionYear('2025-12-31T23:30:00Z', 'Africa/Khartoum')).toBe(2026);
    expect(submissionYear('2025-12-31T23:30:00Z', 'UTC')).toBe(2025);
  });
});

describe('NumberingService.assignNumber', () => {
  it('a PR dated 28/12/2025 submitted on 02/01/2026 gets a 2026 number', async () => {
    const { store, numbering } = service();
    const mad = store.addOffice('MAD');
    const prDate = '2025-12-28';
    const number = await numbering.assignNumber(
      fakeTx,
      'PR',
      mad,
      new Date('2026-01-02T09:00:00Z'),
      'Africa/Khartoum'
    );
    expect(number).toBe('PR-MAD-2026-0001');
    expect(number).not.toContain(prDate.slice(0, 4));
  });

  it('counts per office and per year, continuing from the stored sequence', async () => {
    const { store, numbering } = service();
    const mad = store.addOffice('MAD');
    const kst = store.addOffice('KST');
    store.sequences.set(`${mad}:2026`, 9);
    const at = '2026-11-10T10:00:00Z';
    expect(await numbering.assignNumber(fakeTx, 'PR', mad, at, 'Africa/Khartoum')).toBe(
      'PR-MAD-2026-0010'
    );
    expect(await numbering.assignNumber(fakeTx, 'PR', mad, at, 'Africa/Khartoum')).toBe(
      'PR-MAD-2026-0011'
    );
    expect(await numbering.assignNumber(fakeTx, 'PR', kst, at, 'Africa/Khartoum')).toBe(
      'PR-KST-2026-0001'
    );
    expect(
      await numbering.assignNumber(fakeTx, 'PR', mad, '2027-01-01T08:00:00Z', 'Africa/Khartoum')
    ).toBe('PR-MAD-2027-0001');
  });

  it('applies the current config, so edits affect future numbers only', async () => {
    const { store, numbering } = service();
    const mad = store.addOffice('MAD');
    const at = '2026-11-10T10:00:00Z';
    await numbering.assignNumber(fakeTx, 'PR', mad, at, 'Africa/Khartoum');
    await numbering.update('PR', { ...DEFAULTS, prefix: 'RQ', padding: 3 });
    expect(await numbering.assignNumber(fakeTx, 'PR', mad, at, 'Africa/Khartoum')).toBe(
      'RQ-MAD-2026-002'
    );
  });
});

describe('NumberingService preview', () => {
  const now = new Date('2026-11-10T10:00:00Z');

  it('previews the next number of the first active office without consuming it', async () => {
    const { store, numbering } = service();
    store.addOffice('MAD');
    store.addOffice('AAA', false);
    const config = await numbering.get('PR', undefined, now);
    expect(config).toMatchObject({ docType: 'PR', ...DEFAULTS, preview: 'PR-MAD-2026-0001' });
    expect(store.sequences.size).toBe(0);
  });

  it('previews for a given office from its current sequence', async () => {
    const { store, numbering } = service();
    const kst = store.addOffice('KST');
    store.sequences.set(`${kst}:2026`, 41);
    expect((await numbering.get('PR', kst, now)).preview).toBe('PR-KST-2026-0042');
  });

  it('returns the preview with the saved config after an update', async () => {
    const { store, numbering } = service();
    store.addOffice('MAD');
    const saved = await numbering.update(
      'PR',
      { ...DEFAULTS, includeYear: false, separator: '/' },
      undefined,
      now
    );
    expect(saved.preview).toBe('PR/MAD/0001');
  });

  it('uses a placeholder office code when the organization has no office yet', async () => {
    const { numbering } = service();
    expect((await numbering.get('PR', undefined, now)).preview).toBe('PR-OFFICE-2026-0001');
  });
});

describe('NumberingService previewParts', () => {
  it('returns what the preview was built from, so the web form can re-format it live', async () => {
    const { store, numbering } = service();
    const kst = store.addOffice('KST');
    store.sequences.set(`${kst}:2026`, 4);
    const config = await numbering.get('PR', kst, new Date('2026-11-10T10:00:00Z'));
    expect(config.previewParts).toEqual({ officeCode: 'KST', year: 2026, seq: 5 });
    expect(
      formatNumber({ ...config, includeYear: false }, 'KST', 2026, config.previewParts.seq)
    ).toBe('PR-KST-0005');
  });
});
