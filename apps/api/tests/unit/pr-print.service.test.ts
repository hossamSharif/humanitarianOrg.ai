// T135 — GET /prs/:id/print data (US7, FR-045, contracts/print-layout.md): the PrPrintData
// shape, status watermarks, signature boxes from the latest cycle with the position at signing,
// totals with amount in words, the grant-currency equivalent, per-line labels, and labels frozen
// in the print snapshot for every non-draft PR (Principle VI).
import { prPrintData, type PrStatus } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import type { PrintSnapshot, PrRecord } from '../../src/repositories/pr.repository';
import { PrPrintService } from '../../src/services/pr-print.service';
import { buildPrWorld, type PrWorld } from './helpers/pr-fakes';

const PRINTED_AT = new Date('2026-11-16T10:30:00Z');

function printer(w: PrWorld, logos: string[] = []) {
  return new PrPrintService({
    run: (fn) => fn({ prs: w.db, steps: w.steps, actions: w.actions }),
    assets: {
      async logoUrl(path) {
        logos.push(path);
        return `https://storage.test/sign/${path}?token=t`;
      },
    },
    now: () => PRINTED_AT,
  });
}

/** Live labels of a PR as the SQL printSnapshot builds them. */
function liveLabels(w: PrWorld, pr: PrRecord, changes: Partial<PrintSnapshot> = {}): PrintSnapshot {
  const lines = w.db.lineRows.get(pr.id) ?? [];
  const requester = w.db.actors.get(pr.requesterId) ?? null;
  return {
    organization: {
      nameAr: 'منظمة رتاج للتنمية',
      nameEn: 'RTHA',
      logoPath: 'tenant-1/logo-a.png',
      address: 'Wad Madani',
      phone: '+249 900 000 000',
      email: 'info@rtha.test',
    },
    requestingOffice: { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' },
    deliverTo: { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' },
    grant: { code: 'ADRA-2026-01', name: 'WASH Response' },
    donor: { name: 'Adventist Development and Relief Agency', shortName: 'ADRA' },
    activity: null,
    requester,
    lines: Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          unit: { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece' },
          budgetLineCode: '10202',
          budgetLocation: { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' },
          donorShortName: 'ADRA',
        },
      ])
    ),
    ...changes,
  };
}

/** A draft with live labels registered. */
function draft(w: PrWorld, ...args: Parameters<PrWorld['seedDraft']>) {
  const pr = w.seedDraft(...args);
  w.db.snapshots.set(pr.id, liveLabels(w, pr));
  return pr;
}

async function sign(w: PrWorld, prId: string, userId: string) {
  const { pr, step } = await w.current(prId);
  await w.as(userId).approve(prId, { expectedVersion: pr.version, stepId: step!.id });
}

async function approved(w: PrWorld) {
  const pr = draft(w);
  await w.workflow().submit(pr.id, { expectedVersion: pr.version });
  await sign(w, pr.id, w.financeUserId);
  await sign(w, pr.id, w.approverUserId);
  return (await w.db.find(pr.id))!;
}

describe('PR print data', () => {
  it('matches the PrPrintData contract for an approved PR (US7-1)', async () => {
    const w = buildPrWorld();
    const pr = await approved(w);
    const logos: string[] = [];

    const data = await printer(w, logos).printData(pr.id, 'en');

    expect(() => prPrintData.parse(data)).not.toThrow();
    expect(data.document).toEqual({
      number: pr.number,
      status: 'approved',
      watermark: null,
      printedAt: '2026-11-16T10:30:00.000Z',
      timeZone: 'Africa/Khartoum',
      locale: 'en',
    });
    expect(data.organization).toEqual({
      nameAr: 'منظمة رتاج للتنمية',
      nameEn: 'RTHA',
      logoUrl: 'https://storage.test/sign/tenant-1/logo-a.png?token=t',
      address: 'Wad Madani',
      phone: '+249 900 000 000',
      email: 'info@rtha.test',
    });
    expect(logos).toEqual(['tenant-1/logo-a.png']);
    expect(data.header).toEqual({
      prDate: '2026-11-10',
      requiredByDate: '2026-11-30',
      requestingOffice: { code: 'MAD', name: 'Madani' },
      grant: { code: 'ADRA-2026-01', name: 'WASH Response' },
      donor: { name: 'Adventist Development and Relief Agency', shortName: 'ADRA' },
      deliverTo: { name: 'Madani' },
      deliveryAddress: null,
      contactName: null,
      contactPhone: null,
      activity: null,
      prType: 'goods',
      purpose: null,
    });
  });

  it('prints each line with its donor short name, budget location and budget line code', async () => {
    const w = buildPrWorld();
    const pr = await approved(w);

    const ar = await printer(w).printData(pr.id, 'ar');
    expect(ar.lines).toEqual([
      {
        lineNo: 1,
        description: 'Jerrycan 20 L',
        specifications: null,
        quantity: '10',
        unit: { code: 'PCS', name: 'قطعة' },
        unitCost: '87071.00',
        lineTotal: '870710.00',
        currency: 'SDG',
        donorShortName: 'ADRA',
        budgetLocation: { code: 'MAD', name: 'مدني' },
        budgetLineCode: '10202',
      },
    ]);
    expect(ar.header.requestingOffice).toEqual({ code: 'MAD', name: 'مدني' });

    const en = await printer(w).printData(pr.id, 'en');
    expect(en.lines[0]!.unit).toEqual({ code: 'PCS', name: 'Piece' });
    expect(en.lines[0]!.budgetLocation).toEqual({ code: 'MAD', name: 'Madani' });
  });

  it('totals each line currency with the amount in words in Arabic and English (SC-006)', async () => {
    const w = buildPrWorld();
    const pr = await approved(w);

    const data = await printer(w).printData(pr.id, 'ar');
    expect(data.totals).toEqual([
      {
        currency: 'SDG',
        amount: '870710.00',
        amountInWordsAr: 'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير',
        amountInWordsEn: 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only',
      },
    ]);
  });

  it('gives one total per line currency and the grant-currency equivalent with its rates', async () => {
    const w = buildPrWorld();
    const pr = draft(w, {}, [{}, { description: 'Pump', quantity: '2', unitCost: '50.00', currency: 'USD' }]);
    await w.workflow().submit(pr.id, { expectedVersion: pr.version });

    const data = await printer(w).printData(pr.id, 'en');
    expect(data.totals.map((t) => [t.currency, t.amount, t.amountInWordsEn])).toEqual([
      ['SDG', '870710.00', 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only'],
      ['USD', '100.00', 'One hundred US Dollars only'],
    ]);
    // 870,710 SDG ÷ 600 = 1,451.18 USD; + 100 USD
    expect(data.grantTotal).toEqual({
      currency: 'USD',
      amount: '1551.18',
      rates: [{ currency: 'USD', rateToBase: '600', rateDate: '2026-11-01', source: 'Central Bank of Sudan' }],
    });
  });

  it('omits the grant-currency equivalent when every line is in the grant currency', async () => {
    const w = buildPrWorld();
    const pr = draft(w, {}, [{ quantity: '1', unitCost: '250.00', currency: 'USD' }]);
    await w.workflow().submit(pr.id, { expectedVersion: pr.version });

    expect((await printer(w).printData(pr.id, 'en')).grantTotal).toBeNull();
  });

  it('signs Requested By from the requester snapshot and the steps with the position at signing', async () => {
    const w = buildPrWorld();
    const pr = draft(w);
    await w.workflow().submit(pr.id, { expectedVersion: pr.version });
    await sign(w, pr.id, w.financeUserId);
    // promotions after signing do not change the printed signature
    w.db.actors.set(w.financeUserId, {
      nameAr: 'المدقق المالي',
      nameEn: 'Fatima Finance',
      position: 'Head of Finance',
    });
    await sign(w, pr.id, w.approverUserId);
    const submittedAt = (await w.db.find(pr.id))!.submittedAt;

    expect((await printer(w).printData(pr.id, 'en')).signatures).toEqual({
      requestedBy: { name: 'Amna Requester', position: 'WASH Officer', signedAt: submittedAt },
      financeCheck: {
        name: 'Fatima Finance',
        position: 'Finance Officer',
        signedAt: '2026-11-15T09:00:00.000Z',
      },
      finalApproval: {
        name: 'Omer Approver',
        position: 'Area Manager',
        signedAt: '2026-11-15T09:00:00.000Z',
      },
    });
    expect((await printer(w).printData(pr.id, 'ar')).signatures.requestedBy?.name).toBe(
      'مقدم الطلب'
    );
  });

  it('leaves unsigned boxes empty and uses only signatures of the latest cycle', async () => {
    const w = buildPrWorld();
    const pr = draft(w);
    await w.workflow().submit(pr.id, { expectedVersion: pr.version });
    await sign(w, pr.id, w.financeUserId);

    let data = await printer(w).printData(pr.id, 'en');
    expect(data.signatures.financeCheck?.position).toBe('Finance Officer');
    expect(data.signatures.finalApproval).toBeNull();

    // the approver returns; the requester resubmits → cycle 2 with no signatures yet
    const { pr: current, step } = await w.current(pr.id);
    await w
      .as(w.approverUserId)
      .return(pr.id, { expectedVersion: current.version, stepId: step!.id, reason: 'Fix' });
    const returned = (await w.db.find(pr.id))!;
    await w.workflow().submit(pr.id, { expectedVersion: returned.version });

    data = await printer(w).printData(pr.id, 'en');
    expect(data.signatures.financeCheck).toBeNull();
    expect(data.signatures.finalApproval).toBeNull();
    expect(data.signatures.requestedBy?.name).toBe('Amna Requester');
  });

  it('prints a draft from live labels with no Requested By signature', async () => {
    const w = buildPrWorld();
    const pr = draft(w);

    const data = await printer(w).printData(pr.id, 'en');
    expect(data.document.number).toBeNull();
    expect(data.document.watermark).toBe('DRAFT');
    expect(data.signatures).toEqual({ requestedBy: null, financeCheck: null, finalApproval: null });

    w.db.snapshots.set(
      pr.id,
      liveLabels(w, pr, { requestingOffice: { code: 'MAD', nameAr: 'ود مدني', nameEn: 'Wad Madani' } })
    );
    expect((await printer(w).printData(pr.id, 'en')).header.requestingOffice).toEqual({
      code: 'MAD',
      name: 'Wad Madani',
    });
  });

  it.each<[PrStatus, string | null]>([
    ['draft', 'DRAFT'],
    ['returned', 'DRAFT'],
    ['pending_finance_check', 'PENDING'],
    ['pending_approval', 'PENDING'],
    ['rejected', 'REJECTED'],
    ['cancelled', 'CANCELLED'],
    ['approved', null],
  ])('watermarks a %s PR with %s (US7-2)', async (status, watermark) => {
    const w = buildPrWorld();
    const pr = draft(w, { status, number: status === 'draft' ? null : 'PR-MAD-2026-0010' });

    expect((await printer(w).printData(pr.id, 'en')).document.watermark).toBe(watermark);
  });

  it('keeps an approved PR’s printout when configuration changes afterwards (Principle VI)', async () => {
    const w = buildPrWorld();
    const pr = await approved(w);
    const before = await printer(w).printData(pr.id, 'en');

    // rename the organization and the office, replace the logo, re-code the budget line
    const live = liveLabels(w, pr, {
      organization: {
        nameAr: 'اسم جديد',
        nameEn: 'Renamed NGO',
        logoPath: 'tenant-1/logo-b.png',
        address: 'Khartoum',
        phone: null,
        email: null,
      },
      requestingOffice: { code: 'MAD', nameAr: 'ود مدني', nameEn: 'Wad Madani' },
    });
    for (const line of Object.values(live.lines)) line.budgetLineCode = '99999';
    w.db.snapshots.set(pr.id, live);

    expect(await printer(w).printData(pr.id, 'en')).toEqual(before);
  });

  it('is NOT_FOUND for a PR the caller cannot see', async () => {
    const w = buildPrWorld();
    await expect(
      printer(w).printData('00000000-0000-4000-8000-000000000000', 'en')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
