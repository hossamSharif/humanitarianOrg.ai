// GET /prs/:id/print against the database (US7, FR-045): the frozen print snapshot and the
// currency names behind amount in words, signatures of an approved PR, the draft watermark, and
// office/tenant scoping through RLS.
import { prPrintData } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createDraftPr } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

describe.runIf(integrationEnabled)('PR print data (US7)', { timeout: 180_000 }, () => {
  let flow: Flow;
  let other: Flow;
  let approved: { id: string; number: string };

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    [flow, other] = await Promise.all([
      createFlow({ nameEn: 'Print Org' }),
      createFlow({ nameEn: 'Other Print Org' }),
    ]);
    approved = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, approved.id, 'approve')).status).toBe(200);
    expect((await actOnStep(flow.approver.token, approved.id, 'approve')).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('prints an approved PR with words, signatures and frozen labels in both languages', async () => {
    const ar = await as(flow.requester.token).get(`/prs/${approved.id}/print?locale=ar`);
    expect(ar.status, JSON.stringify(ar.body)).toBe(200);
    const data = prPrintData.parse(ar.body);

    expect(data.document).toMatchObject({
      number: approved.number,
      status: 'approved',
      watermark: null,
      locale: 'ar',
      timeZone: 'Africa/Khartoum',
    });
    expect(data.totals).toEqual([
      {
        currency: 'SDG',
        amount: '870710.00',
        amountInWordsAr: 'فقط ثمانمائة وسبعون ألفاً وسبعمائة وعشرة جنيهات سودانية لا غير',
        amountInWordsEn: 'Eight hundred seventy thousand seven hundred ten Sudanese Pounds only',
      },
    ]);
    expect(data.grantTotal).toMatchObject({ currency: 'USD', amount: '1451.18' });
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0]!.budgetLineCode).toBeTruthy();
    expect(data.header.requestingOffice?.code).toBeTruthy();
    expect(data.signatures.requestedBy?.signedAt).toBeTruthy();
    expect(data.signatures.financeCheck).not.toBeNull();
    expect(data.signatures.finalApproval).not.toBeNull();

    const en = await as(flow.requester.token).get(`/prs/${approved.id}/print?locale=en`);
    expect(en.status).toBe(200);
    expect(en.body.document.locale).toBe('en');

    // renaming the organization after approval leaves the printout unchanged (Principle VI)
    await ownerDb()`
      update public.tenant set name_en = 'Renamed Print Org' where id = ${flow.tenant.id}`;
    const again = await as(flow.requester.token).get(`/prs/${approved.id}/print?locale=en`);
    expect(again.body.organization.nameEn).toBe(en.body.organization.nameEn);
    expect(again.body.organization.nameEn).not.toBe('Renamed Print Org');
  });

  it('prints a draft with live labels, a DRAFT watermark and no number', async () => {
    const { id } = await createDraftPr(flow.tenant, flow.requester.user, {
      grantId: flow.grantId,
      budgetLineId: flow.budgetLineId,
      prDate: flow.prDate,
    });
    const res = await as(flow.requester.token).get(`/prs/${id}/print`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.document).toMatchObject({ number: null, watermark: 'DRAFT', locale: 'ar' });
    expect(res.body.organization.nameEn).toBe('Renamed Print Org');
    expect(res.body.signatures).toEqual({
      requestedBy: null,
      financeCheck: null,
      finalApproval: null,
    });
  });

  it('is 404 for another tenant and 400 for an unknown locale', async () => {
    expect((await as(other.requester.token).get(`/prs/${approved.id}/print`)).status).toBe(404);
    expect((await as(flow.requester.token).get(`/prs/${approved.id}/print?locale=fr`)).status).toBe(
      400
    );
  });
});
