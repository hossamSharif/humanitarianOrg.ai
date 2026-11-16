// T146 — budget status report (US8-2, FR-049): per line Committed = Σ approved, non-cancelled PRs
// and Reserved = Σ pending PRs; drill-down lists the reserving / committing PRs with amounts;
// the Excel export has DD/MM/YYYY dates and numeric 2-dp cells; everything needs budget:read.
import ExcelJS from 'exceljs';
import { formatDate } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createBudgetLine } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, detail, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  truncateTenantTables,
} from './helpers/setup';

describe.runIf(integrationEnabled)('Budget status report (US8)', { timeout: 240_000 }, () => {
  let flow: Flow;
  let emptyLineId: string;
  const prs = {} as Record<'approved' | 'pending' | 'cancelled', { id: string; number: string }>;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Report Org' });
    emptyLineId = (
      await createBudgetLine(flow.tenant, flow.grantId, {
        code: '30101',
        budgetAmount: '2500.00',
        category: 'services',
      })
    ).id;

    const approve = async (id: string) => {
      expect((await actOnStep(flow.finance.token, id, 'approve')).status).toBe(200);
      expect((await actOnStep(flow.approver.token, id, 'approve')).status).toBe(200);
    };
    prs.approved = await submitPr(flow);
    await approve(prs.approved.id);
    prs.pending = await submitPr(flow);
    prs.cancelled = await submitPr(flow);
    await approve(prs.cancelled.id);
    const { version } = await detail(flow.admin.token, prs.cancelled.id);
    const res = await as(flow.admin.token).post(`/prs/${prs.cancelled.id}/cancel`, {
      expectedVersion: version,
      reason: 'Duplicate',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('per line: Committed = approved non-cancelled, Reserved = pending (US8-2)', async () => {
    const res = await as(flow.finance.token).get(`/reports/budget-status?grantId=${flow.grantId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.grant).toMatchObject({ id: flow.grantId, currency: 'USD', status: 'active' });
    expect(res.body.lines).toEqual([
      expect.objectContaining({
        budgetLineId: flow.budgetLineId,
        code: '10202',
        category: 'supplies',
        budget: '10000.00',
        reserved: '1451.18',
        committed: '1451.18',
        actual: '0.00',
        available: '7097.64',
        pctUsed: '29.02',
      }),
      expect.objectContaining({
        budgetLineId: emptyLineId,
        code: '30101',
        budget: '2500.00',
        reserved: '0.00',
        committed: '0.00',
        available: '2500.00',
        pctUsed: '0.00',
      }),
    ]);
    expect(res.body.totals).toMatchObject({
      budget: '12500.00',
      reserved: '1451.18',
      committed: '1451.18',
      available: '9597.64',
    });
  });

  it('drill-down lists the committing and the reserving PRs', async () => {
    const drill = async (status?: string) => {
      const query = status ? `?status=${status}` : '';
      const res = await as(flow.finance.token).get(
        `/reports/budget-status/lines/${flow.budgetLineId}/prs${query}`
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    };

    const committed = await drill('committed');
    expect(committed.data).toEqual([
      expect.objectContaining({
        prId: prs.approved.id,
        number: prs.approved.number,
        prStatus: 'approved',
        status: 'committed',
        amount: '1451.18',
        currency: 'USD',
        officeCode: 'MAD',
      }),
    ]);
    expect(committed.total).toBe('1451.18');

    const reserved = await drill('reserved');
    expect(reserved.data.map((r: { prId: string }) => r.prId)).toEqual([prs.pending.id]);
    expect(reserved.data[0]).toMatchObject({
      prStatus: 'pending_finance_check',
      status: 'reserved',
    });

    const both = await drill();
    expect(both.data).toHaveLength(2);
    expect(both.total).toBe('2902.36');
    expect(both.data.map((r: { prId: string }) => r.prId)).not.toContain(prs.cancelled.id);
  });

  it('exports Excel with DD/MM/YYYY dates and numeric 2-dp cells', async () => {
    const res = await as(flow.finance.token)
      .get(`/reports/budget-status/export.xlsx?grantId=${flow.grantId}&locale=en`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.xlsx"/);

    const workbook = new ExcelJS.Workbook();
    // exceljs types predate the generic Buffer of @types/node 20
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    const texts: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => texts.push(String(cell.text))));

    // grant period and generation date as DD/MM/YYYY text, never as locale-dependent dates
    const start = formatDate(
      (await as(flow.finance.token).get(`/grants/${flow.grantId}`)).body.startDate as string
    );
    expect(texts.some((t) => t.includes(start))).toBe(true);
    expect(texts.some((t) => /\b\d{2}\/\d{2}\/\d{4}\b/.test(t))).toBe(true);
    expect(texts).toContain('Committed');

    const codeCell = (code: string) => {
      let found: ExcelJS.Row | undefined;
      sheet.eachRow((row) => {
        if (row.getCell(1).text === code) found = row;
      });
      return found!;
    };
    const row = codeCell('10202');
    const numeric = [4, 5, 6, 7, 8].map((c) => row.getCell(c));
    for (const cell of numeric) {
      expect(typeof cell.value).toBe('number');
      expect(cell.numFmt).toBe('#,##0.00');
    }
    expect(numeric.map((c) => c.value)).toEqual([10000, 1451.18, 1451.18, 0, 7097.64]);
  });

  it('requires budget:read', async () => {
    for (const path of [
      `/reports/budget-status?grantId=${flow.grantId}`,
      `/reports/budget-status/lines/${flow.budgetLineId}/prs`,
      `/reports/budget-status/export.xlsx?grantId=${flow.grantId}`,
    ]) {
      const res = await as(flow.requester.token).get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });
});
