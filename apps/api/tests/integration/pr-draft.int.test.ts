// T100 — the US4 flow through HTTP: create a draft, autosave with optimistic versions, the
// creator-only rules, an attachment through Storage signed URLs, then submit (FR-024, FR-027).
import { addDays } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTestData,
  createBudgetLine,
  createGrant,
  createPrRouting,
  createRate,
  createTenant,
  createUser,
  todayInKhartoum,
  tokenFor,
  type TestTenant,
} from './helpers/factories';
import { as } from './helpers/http';
import { closeOwnerDb, ensureMigrated, integrationEnabled, ownerDb, truncateTenantTables } from './helpers/setup';

// long HTTP flows and Storage round trips: ~0.3 s per round trip to a remote dev database
describe.runIf(integrationEnabled)('PR drafts and submit (US4)', { timeout: 180_000 }, () => {
  let tenant: TestTenant;
  let requesterToken: string;
  let colleagueToken: string;
  let kostiToken: string;
  let grantId: string;
  let budgetLineId: string;
  let prId: string;
  let version: number;
  const prDate = todayInKhartoum();

  const header = () => ({
    prDate,
    requestingOfficeId: tenant.offices.MAD,
    grantId,
    deliverToOfficeId: tenant.offices.MAD,
    deliveryAddress: 'Madani warehouse',
    requiredByDate: addDays(prDate, 14),
    prType: 'goods',
  });
  const line = (overrides: Record<string, unknown> = {}) => ({
    description: 'Jerrycan 20 L',
    quantity: '10',
    unitId: tenant.unitId,
    unitCost: '87071.00',
    budgetLineId,
    ...overrides,
  });

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Drafts Org' });
    await createPrRouting(tenant);
    const requester = await createUser(tenant, { roles: ['requester'] });
    const colleague = await createUser(tenant, { roles: ['requester'] });
    const kosti = await createUser(tenant, { roles: ['viewer'], offices: ['KST'] });
    await createUser(tenant, { roles: ['finance_checker'] });
    await createUser(tenant, { roles: ['approver'] });
    [requesterToken, colleagueToken, kostiToken] = await Promise.all([
      tokenFor(requester),
      tokenFor(colleague),
      tokenFor(kosti),
    ]);
    ({ id: grantId } = await createGrant(tenant, {
      startDate: addDays(prDate, -365),
      endDate: addDays(prDate, 365),
    }));
    ({ id: budgetLineId } = await createBudgetLine(tenant, grantId, { budgetAmount: '10000.00' }));
    await createRate(tenant, { currency: 'USD', rateToBase: '600', rateDate: addDays(prDate, -5) });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('creates a draft with lines; the line takes the base currency and the deliver-to office', async () => {
    const res = await as(requesterToken).post('/prs', { header: header(), lines: [line()] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), version: 1, status: 'draft' });
    prId = res.body.id;
    version = res.body.version;

    const detail = await as(requesterToken).get(`/prs/${prId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.lines).toEqual([
      expect.objectContaining({
        lineNo: 1,
        currency: 'SDG',
        locationOfficeId: tenant.offices.MAD,
        quantity: '10.000',
        lineTotal: '870710.00',
      }),
    ]);
    expect(detail.body.totals).toEqual([{ amount: '870710.00', currency: 'SDG' }]);
    expect(detail.body.availableActions).toEqual(['update', 'submit', 'delete']);
  });

  it('autosaves with expectedVersion; a stale version gets 409 VERSION_CONFLICT', async () => {
    const detail = await as(requesterToken).get(`/prs/${prId}`);
    const stored = detail.body.lines[0];

    const save = await as(requesterToken).patch(`/prs/${prId}`, {
      expectedVersion: version,
      header: { ...header(), purpose: 'Emergency WASH response' },
      lines: [{ ...line(), id: stored.id }, line({ description: 'Soap bar', quantity: '100', unitCost: '500.00' })],
    });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ version: version + 1, changed: true });
    expect(save.body.lineIds[0]).toBe(stored.id);
    const lineIds: string[] = save.body.lineIds;
    version = save.body.version;

    // the same document again: nothing written, version unchanged
    const same = await as(requesterToken).patch(`/prs/${prId}`, {
      expectedVersion: version,
      header: { ...header(), purpose: 'Emergency WASH response' },
      lines: [
        { ...line(), id: lineIds[0] },
        { ...line({ description: 'Soap bar', quantity: '100', unitCost: '500.00' }), id: lineIds[1] },
      ],
    });
    expect(same.body).toMatchObject({ version, changed: false });

    const stale = await as(requesterToken).patch(`/prs/${prId}`, {
      expectedVersion: version - 1,
      header: header(),
      lines: [],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('another user may read but not edit or delete the draft; another office cannot see it', async () => {
    expect((await as(colleagueToken).get(`/prs/${prId}`)).status).toBe(200);
    const edit = await as(colleagueToken).patch(`/prs/${prId}`, {
      expectedVersion: version,
      header: header(),
      lines: [],
    });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('FORBIDDEN');
    expect((await as(colleagueToken).delete(`/prs/${prId}`)).status).toBe(403);

    expect((await as(kostiToken).get(`/prs/${prId}`)).status).toBe(404);
  });

  it('uploads an attachment through a signed URL, confirms it and serves a download URL', async () => {
    const content = 'Quotation from supplier A';
    const target = await as(requesterToken).post(`/prs/${prId}/attachments/upload-url`, {
      fileName: 'quote.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
    });
    expect(target.status, JSON.stringify(target.body)).toBe(201);
    expect(target.body.path).toBe(`${tenant.id}/${prId}/${target.body.attachmentId}`);

    const put = await fetch(target.body.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
    expect(put.ok).toBe(true);

    const done = await as(requesterToken).post(
      `/prs/${prId}/attachments/${target.body.attachmentId}/complete`
    );
    expect(done.status).toBe(200);
    expect(done.body.uploadedAt).toEqual(expect.any(String));

    const url = await as(colleagueToken).get(`/prs/${prId}/attachments/${target.body.attachmentId}/url`);
    expect(url.status).toBe(200);
    const file = await fetch(url.body.url);
    expect(await file.text()).toBe(content);

    const wrongType = await as(requesterToken).post(`/prs/${prId}/attachments/upload-url`, {
      fileName: 'tool.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 10,
    });
    expect(wrongType.status).toBe(400);
  });

  it('submits: number, pending finance check, steps and reservation; then edits are refused', async () => {
    const res = await as(requesterToken).post(`/prs/${prId}/submit`, { expectedVersion: version });
    expect(res.status).toBe(200);
    const year = prDate.slice(0, 4);
    // 870,710.00 + 50,000.00 SDG at 600 → 1,451.18 + 83.33 USD
    expect(res.body).toEqual({
      id: prId,
      status: 'pending_finance_check',
      number: `PR-MAD-${year}-0001`,
      version: version + 1,
      steps: [
        { stepOrder: 1, kind: 'finance_check', status: 'pending' },
        { stepOrder: 2, kind: 'final_approval', status: 'waiting' },
      ],
      reservations: [{ budgetLineId, amount: '1534.51', currency: 'USD' }],
    });

    const [balance] = await ownerDb()<{ reserved: string }[]>`
      select reserved::text from public.budget_line_balance where budget_line_id = ${budgetLineId}`;
    expect(balance!.reserved).toBe('1534.51');

    const [notified] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from public.notification
      where pr_id = ${prId} and kind = 'pr_action_required'`;
    expect(notified!.n).toBe(1);

    const detail = await as(requesterToken).get(`/prs/${prId}`);
    expect(detail.body).toMatchObject({
      status: 'pending_finance_check',
      totalGrantCurrency: '1534.51',
      grantRateToBase: '600.000000',
      requesterName: 'Test User',
      availableActions: ['cancel'],
    });
    expect(detail.body.lines.map((l: { amountGrant: string }) => l.amountGrant)).toEqual([
      '1451.18',
      '83.33',
    ]);
    expect(detail.body.actions).toEqual([
      expect.objectContaining({ action: 'submit', userName: 'Test User', userPosition: 'Officer' }),
    ]);

    const edit = await as(requesterToken).patch(`/prs/${prId}`, {
      expectedVersion: res.body.version,
      header: header(),
      lines: [],
    });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('INVALID_STATE');
    expect((await as(requesterToken).delete(`/prs/${prId}`)).body.code).toBe('INVALID_STATE');
  });
});
