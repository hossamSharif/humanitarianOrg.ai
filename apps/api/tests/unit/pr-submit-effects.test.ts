// T096 — what a successful submit writes: locked rates and grant-currency amounts per line, the
// DoA amount, the number (first submission only), the new cycle and its steps, one reservation
// per budget line, the `submit` action and step-1 notifications (Business Rule 11, FR-028).
import { describe, expect, it } from 'vitest';
import { MAD_OFFICE_ID } from './helpers/builders';
import { buildPrWorld } from './helpers/pr-fakes';

describe('PR submit effects', () => {
  it('locks each line rate and its amount in the grant currency, rounded half-up per line', async () => {
    const w = buildPrWorld();
    const usdRate = w.rates.rows[0]!;
    // 870,710.00 SDG / 600 = 1,451.18333 → 1,451.18; 1.00 SDG / 600 = 0.001666 → 0.00;
    // 3.00 SDG / 600 = 0.005 → 0.01 (half-up)
    const pr = w.seedDraft({}, [
      {},
      { quantity: '1', unitCost: '1.00' },
      { quantity: '1', unitCost: '3.00' },
    ]);
    await w.workflow().submit(pr.id, { expectedVersion: 1 });

    const lines = await w.db.lines(pr.id);
    expect(lines.map((l) => l.amountGrant)).toEqual(['1451.18', '0.00', '0.01']);
    // SDG is the base currency: rate 1, PR date, source 'base', no rate row
    expect(lines[0]).toMatchObject({
      rateToBase: '1',
      rateDate: '2026-11-10',
      rateSource: 'base',
      exchangeRateId: null,
    });

    const s = w.db.submitted!;
    expect(s.totalGrantCurrency).toBe('1451.19');
    expect(s).toMatchObject({
      grantRateToBase: '600',
      grantRateDate: '2026-11-01',
      grantRateSource: 'Central Bank of Sudan',
      grantExchangeRateId: usdRate.id,
      doaCurrency: 'USD',
      doaAmount: '1451.19',
      doaRateToBase: '600',
      doaExchangeRateId: usdRate.id,
    });
  });

  it('copies a foreign line currency rate and its id onto the line', async () => {
    const w = buildPrWorld();
    const eur = w.rates.add({ currency: 'EUR', rateToBase: '650', rateDate: '2026-11-09' });
    const pr = w.seedDraft({}, [{ currency: 'EUR', quantity: '2', unitCost: '100.00' }]);
    await w.workflow().submit(pr.id, { expectedVersion: 1 });
    const [line] = await w.db.lines(pr.id);
    // 200 EUR × 650 / 600 = 216.666… → 216.67 USD
    expect(line).toMatchObject({
      rateToBase: '650',
      rateDate: '2026-11-09',
      exchangeRateId: eur.id,
      amountGrant: '216.67',
    });
  });

  it('uses the latest rate on or before the PR date, ignoring later ones', async () => {
    const w = buildPrWorld();
    w.rates.add({ currency: 'USD', rateToBase: '610', rateDate: '2026-11-10' });
    w.rates.add({ currency: 'USD', rateToBase: '700', rateDate: '2026-11-12' });
    const pr = w.seedDraft({ prDate: '2026-11-10' });
    await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(w.db.submitted!.grantRateToBase).toBe('610');
  });

  it('assigns the next number of the office and submission year, moves to pending_finance_check', async () => {
    const w = buildPrWorld();
    w.numbering.sequences.set(`${MAD_OFFICE_ID}:2026`, 9);
    const pr = w.seedDraft();
    const result = await w.workflow().submit(pr.id, { expectedVersion: 1 });

    expect(result).toMatchObject({
      id: pr.id,
      status: 'pending_finance_check',
      number: 'PR-MAD-2026-0010',
      version: 2,
    });
    const stored = (await w.db.find(pr.id))!;
    expect(stored).toMatchObject({
      status: 'pending_finance_check',
      number: 'PR-MAD-2026-0010',
      submissionCycle: 1,
      currentStepOrder: 1,
      submittedAt: '2026-11-15T09:00:00.000Z',
      requesterName: 'Amna Requester',
      requesterPosition: 'WASH Officer',
    });
  });

  it('takes the year from the submission date, not the PR date (FR-004)', async () => {
    const w = buildPrWorld();
    w.now = new Date('2026-01-02T08:00:00Z');
    w.db.grants.get(w.grantId)!.startDate = '2025-01-01';
    w.rates.add({ currency: 'USD', rateDate: '2025-12-01' });
    const pr = w.seedDraft({ prDate: '2025-12-28', requiredByDate: null });
    const result = await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(result.number).toBe('PR-MAD-2026-0001');
  });

  it('keeps the number on resubmission and opens the next cycle', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({
      status: 'returned',
      number: 'PR-MAD-2026-0010',
      submissionCycle: 1,
      version: 4,
    });
    const result = await w.workflow().submit(pr.id, { expectedVersion: 4 });
    expect(result.number).toBe('PR-MAD-2026-0010');
    expect(w.numbering.sequences.size).toBe(0);
    expect((await w.db.find(pr.id))!.submissionCycle).toBe(2);
    expect(w.steps.rows.map((s) => s.cycle)).toEqual([2, 2]);
  });

  it('materialises the resolved route: step 1 pending, the rest waiting', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft();
    const result = await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(result.steps).toEqual([
      { stepOrder: 1, kind: 'finance_check', status: 'pending' },
      { stepOrder: 2, kind: 'final_approval', status: 'waiting' },
    ]);
    expect(w.steps.rows.map((s) => [s.requiredRoleId, s.status])).toEqual([
      [w.roles.finance, 'pending'],
      [w.roles.approver, 'waiting'],
    ]);
  });

  it('routes by the DoA amount in the reference currency (band of the final approval)', async () => {
    const w = buildPrWorld();
    const rule = w.routing.rules[0]!;
    const bigApprover = w.routing.roles[1]!; // reuse the approver role set for both bands
    rule.steps[1] = { ...rule.steps[1]!, minAmount: null, maxAmount: '1000.00' };
    rule.steps.push({
      id: 'band-2',
      stepOrder: 2,
      kind: 'final_approval',
      roleId: bigApprover.id,
      minAmount: '1000.00',
      maxAmount: null,
    });
    const pr = w.seedDraft(); // 1,451.19 USD → band 2
    await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(w.steps.rows[1]!.ruleStepId).toBe('band-2');
  });

  it('reserves one amount per budget line for the cycle', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({}, [{}, { quantity: '1', unitCost: '60000.00' }]);
    const result = await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(result.reservations).toEqual([
      { budgetLineId: w.budgetLineId, amount: '1551.18', currency: 'USD' },
    ]);
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({
        prId: pr.id,
        budgetLineId: w.budgetLineId,
        cycle: 1,
        amount: '1551.18',
        status: 'reserved',
      }),
    ]);
  });

  it('records the submit action with the requester name and position snapshot', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft();
    await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(w.actions.rows).toEqual([
      expect.objectContaining({
        prId: pr.id,
        action: 'submit',
        cycle: 1,
        stepOrder: null,
        stepId: null,
        userId: w.requesterId,
        userName: 'Amna Requester',
        userPosition: 'WASH Officer',
      }),
    ]);
  });

  it('notifies the users eligible for step 1 only', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft();
    const result = await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(w.notifications.rows).toEqual([
      {
        userId: w.financeUserId,
        kind: 'pr_action_required',
        prId: pr.id,
        params: { number: result.number, stepKind: 'finance_check', actorName: 'Amna Requester' },
      },
    ]);
  });

  it('stores the print snapshot taken at submission', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft();
    await w.workflow().submit(pr.id, { expectedVersion: 1 });
    expect(w.db.submitted!.printSnapshot.organization.nameEn).toBe('RTHA');
    expect(w.db.submitted!.printSnapshot.grant).toEqual({ code: 'ADRA-2026-01', name: 'WASH' });
  });
});
