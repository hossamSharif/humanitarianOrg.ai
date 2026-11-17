// T008 — budget commitments for any source document (migration 0013, research D2): 001-style
// PR inserts keep working, the PR / source check, one open row per source × line × cycle, the
// split chain (release + remainder superseding it) keeps budget_line_balance right, a reversal
// restores the consumed part, and the deferred guard refuses Available < 0 (BUDGET_EXCEEDED).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantTx } from '../../src/db/tx';
import { BudgetTxRepository } from '../../src/repositories/budget-line.repository';
import { SourceCommitmentRepository } from '../../src/repositories/source-commitment.repository';
import { BudgetService } from '../../src/services/budget.service';
import type { RequestContext } from '../../src/types/context';
import { cleanupTestData, createBudgetLine, createDraftPr, createGrant } from './helpers/factories';
import { createFlow, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

async function pgError(promise: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { message: string; code?: string };
  }
  throw new Error('expected the statement to fail');
}

describe.runIf(integrationEnabled)('budget commitments for any source (002 D2)', () => {
  let flow: Flow;
  let lineId: string;

  const balance = async (id = lineId) => {
    const [row] = await ownerDb()<{ reserved: string; committed: string; available: string }[]>`
      select reserved::text, committed::text, available::text
      from public.budget_line_balance where budget_line_id = ${id}`;
    return row!;
  };

  /** BudgetService over the owner connection, inside one transaction. */
  const inTx = <T>(fn: (budget: BudgetService, tx: TenantTx) => Promise<T>) =>
    ownerDb().begin(async (sql) => {
      const tx = { sql, setAuditComment: async () => {} } as TenantTx;
      const budget = new BudgetService({
        grants: null as never,
        lines: null as never,
        txStore: new BudgetTxRepository({ tenantId: flow.tenant.id } as RequestContext),
        runTx: (f) => f(tx),
        sources: new SourceCommitmentRepository(flow.tenant.id),
      });
      return fn(budget, tx);
    }) as Promise<T>;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Commitment Org' });
    ({ id: lineId } = await createBudgetLine(flow.tenant, flow.grantId, {
      code: '20101',
      budgetAmount: '5000.00',
    }));
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('a 001-style PR insert gets source_doc_type PR and source_doc_id = pr_id', async () => {
    const sql = ownerDb();
    const { id: prId } = await createDraftPr(flow.tenant, flow.requester.user, {
      grantId: flow.grantId,
      budgetLineId: lineId,
      prDate: flow.prDate,
    });
    const [row] = await sql<{ source_doc_type: string; source_doc_id: string; pr_id: string }[]>`
      insert into public.budget_commitment (tenant_id, budget_line_id, pr_id, cycle, amount)
      values (${flow.tenant.id}, ${lineId}, ${prId}, 1, 100)
      returning source_doc_type, source_doc_id, pr_id`;
    expect(row).toEqual({ source_doc_type: 'PR', source_doc_id: prId, pr_id: prId });
    expect(await balance()).toMatchObject({ reserved: '100.00', available: '4900.00' });
    await sql`
      update public.budget_commitment set status = 'released', released_at = now(),
             release_reason = 'cancelled'
      where pr_id = ${prId}`;
  });

  it('checks (source_doc_type = PR) = (pr_id is not null)', async () => {
    const sql = ownerDb();
    const { id: prId } = await createDraftPr(flow.tenant, flow.requester.user, {
      grantId: flow.grantId,
      budgetLineId: lineId,
      prDate: flow.prDate,
    });
    const poWithPr = await pgError(sql`
      insert into public.budget_commitment
        (tenant_id, budget_line_id, pr_id, source_doc_type, source_doc_id, cycle, amount)
      values (${flow.tenant.id}, ${lineId}, ${prId}, 'PO', gen_random_uuid(), 1, 10)`);
    expect(poWithPr.code).toBe('23514');
    const prWithout = await pgError(sql`
      insert into public.budget_commitment
        (tenant_id, budget_line_id, source_doc_type, source_doc_id, cycle, amount)
      values (${flow.tenant.id}, ${lineId}, 'PR', gen_random_uuid(), 1, 10)`);
    expect(prWithout.code).toBe('23514');
  });

  it('one open row per source × line × cycle; released rows do not count', async () => {
    const sql = ownerDb();
    const source = randomUUID();
    const insert = (status: string) => sql`
      insert into public.budget_commitment
        (tenant_id, budget_line_id, source_doc_type, source_doc_id, cycle, amount, status,
         committed_at)
      values (${flow.tenant.id}, ${lineId}, 'PO', ${source}, 1, 50, ${status}, now())
      returning id`;
    const [first] = await insert('committed');
    expect((await pgError(insert('committed'))).code).toBe('23505');
    await sql`
      update public.budget_commitment set status = 'released', released_at = now(),
             release_reason = 'po_closed'
      where id = ${first!.id}`;
    await expect(insert('committed')).resolves.toHaveLength(1);
    await sql`
      update public.budget_commitment set status = 'released', released_at = now(),
             release_reason = 'po_closed'
      where source_doc_id = ${source} and status = 'committed'`;
  });

  it('a split chain keeps the balance: release + remainder superseding it; restore on reversal', async () => {
    const po = { docType: 'PO' as const, docId: randomUUID() };
    const rate = {
      rateToGrant: '0.001667',
      rateDate: flow.prDate,
      rateSource: 'CBOS',
      exchangeRateId: null,
    };
    const before = await balance();

    const [row] = await inTx((budget, tx) =>
      budget.commitDirect(tx, po, 1, [{ budgetLineId: lineId, amount: '1000.00' }], rate)
    );
    expect(await balance()).toMatchObject({
      committed: (Number(before.committed) + 1000).toFixed(2),
    });

    const split = await inTx((budget, tx) =>
      budget.splitConsume(tx, row!.id, '400.00', 'consumed_by_payment')
    );
    expect(split.released).toMatchObject({
      id: row!.id,
      status: 'released',
      releaseReason: 'consumed_by_payment',
      amount: '1000.00',
    });
    expect(split.remainder).toMatchObject({
      status: 'committed',
      amount: '600.00',
      supersedesId: row!.id,
      rateToGrant: '0.001667',
    });
    expect(await balance()).toMatchObject({
      committed: (Number(before.committed) + 600).toFixed(2),
    });

    const restored = await inTx((budget, tx) => budget.restore(tx, row!.id, '400.00'));
    expect(restored).toMatchObject({
      status: 'committed',
      amount: '1000.00',
      supersedesId: split.remainder!.id,
    });
    const [old] = await ownerDb()<{ status: string; release_reason: string }[]>`
      select status, release_reason from public.budget_commitment where id = ${split.remainder!.id}`;
    expect(old).toEqual({ status: 'released', release_reason: 'reversal_restore' });
    expect(await balance()).toMatchObject({
      committed: (Number(before.committed) + 1000).toFixed(2),
    });

    await inTx((budget, tx) => budget.releaseFor(tx, po, 'po_closed'));
    expect(await balance()).toEqual(before);
  });

  it('reserveFor / commitFor / releaseFor for a reserved source (direct payment)', async () => {
    const dpr = { docType: 'DPR' as const, docId: randomUUID() };
    const before = await balance();
    await inTx((budget, tx) =>
      budget.reserveFor(tx, dpr, 1, [{ budgetLineId: lineId, amount: '250.00' }])
    );
    expect(await balance()).toMatchObject({
      reserved: (Number(before.reserved) + 250).toFixed(2),
    });
    await inTx((budget, tx) => budget.commitFor(tx, dpr, 1));
    expect(await balance()).toMatchObject({
      reserved: before.reserved,
      committed: (Number(before.committed) + 250).toFixed(2),
    });
    await inTx((budget, tx) => budget.releaseFor(tx, dpr, 'cancelled'));
    expect(await balance()).toEqual(before);
  });

  it('the service explains a shortfall before writing (BUDGET_EXCEEDED with lines)', async () => {
    const err = await pgError(
      inTx((budget, tx) =>
        budget.commitDirect(tx, { docType: 'PO', docId: randomUUID() }, 1, [
          { budgetLineId: lineId, amount: '999999.00' },
        ])
      )
    );
    expect(err).toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('the deferred guard refuses Available < 0 at commit, whatever writes the row', async () => {
    const { id: grantId } = await createGrant(flow.tenant, {
      code: `G-${randomUUID().slice(0, 4)}`,
    });
    const { id: small } = await createBudgetLine(flow.tenant, grantId, { budgetAmount: '100.00' });
    const err = await pgError(ownerDb()`
      insert into public.budget_commitment
        (tenant_id, budget_line_id, source_doc_type, source_doc_id, cycle, amount, status,
         committed_at)
      values (${flow.tenant.id}, ${small}, 'PO', gen_random_uuid(), 1, 100.01, 'committed', now())`);
    expect(err.message).toBe('BUDGET_EXCEEDED');
    expect(await balance(small)).toMatchObject({ committed: '0.00', available: '100.00' });
  });
});
