// T095 — US4 submission guards: every rule a PR must pass before it leaves draft/returned, and
// the error each failure reports (US4-2..US4-5, US2-3, FR-025, Business Rules 1 and 3).
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { KST_OFFICE_ID } from './helpers/builders';
import { buildPrWorld } from './helpers/pr-fakes';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the submit to fail');
}

describe('PR submit guards', () => {
  it('rejects a PR without lines → PR_EMPTY (US4-4)', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({}, []);
    w.db.lineRows.set(pr.id, []);
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('PR_EMPTY');
  });

  it('rejects a PR whose total is zero → PR_EMPTY (US4-4)', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({}, [{ unitCost: '0' }, { unitCost: '0.00' }]);
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('PR_EMPTY');
  });

  it('reports every missing header and line field as VALIDATION_ERROR', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({ prType: null }, [{ description: null }, { unitId: null }]);
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([
      { field: 'header.prType', message: 'required' },
      { field: 'lines.0.description', message: 'required' },
      { field: 'lines.1.unitId', message: 'required' },
    ]);
  });

  it('rejects a required-by date before the PR date (US4-3)', async () => {
    const w = buildPrWorld();
    const pr = w.seedDraft({ prDate: '2026-11-10', requiredByDate: '2026-11-09' });
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('REQUIRED_BY_BEFORE_PR_DATE');
  });

  describe('PR date window (FR-025): submission date − max_backdate_days ≤ PR date ≤ submission date', () => {
    // now = 15/11/2026 09:00 UTC = 15/11/2026 11:00 in Africa/Khartoum
    it.each([
      ['2026-11-15', 'today (0 days)'],
      ['2026-10-16', 'exactly 30 days back'],
    ])('accepts %s — %s', async (prDate) => {
      const w = buildPrWorld();
      w.rates.add({ currency: 'USD', rateDate: '2026-10-01' });
      const pr = w.seedDraft({ prDate, requiredByDate: null });
      await expect(w.workflow().submit(pr.id, { expectedVersion: 1 })).resolves.toMatchObject({
        status: 'pending_finance_check',
      });
    });

    it.each([
      ['2026-11-16', 'a future date'],
      ['2026-10-15', '31 days back'],
    ])('rejects %s — %s → PR_DATE_OUT_OF_RANGE', async (prDate) => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ prDate, requiredByDate: null });
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
      expect(err.code).toBe('PR_DATE_OUT_OF_RANGE');
      expect(err.details).toEqual({ prDate, earliest: '2026-10-16', latest: '2026-11-15' });
    });

    it('uses the tenant setting for the window', async () => {
      const w = buildPrWorld();
      w.db.settingsValue.maxBackdateDays = 0;
      const pr = w.seedDraft({ prDate: '2026-11-14', requiredByDate: null });
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
      expect(err.details).toMatchObject({ earliest: '2026-11-15', latest: '2026-11-15' });
    });

    it('applies again on resubmission of a returned PR', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({
        status: 'returned',
        number: 'PR-MAD-2026-0010',
        submissionCycle: 1,
        prDate: '2026-10-01',
        requiredByDate: null,
      });
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
      expect(err.code).toBe('PR_DATE_OUT_OF_RANGE');
    });

    it('takes the submission date in the tenant timezone, not UTC', async () => {
      const w = buildPrWorld();
      w.now = new Date('2026-11-15T23:30:00Z'); // already 16/11 in Khartoum (UTC+2)
      const pr = w.seedDraft({ prDate: '2026-11-16', requiredByDate: null });
      await expect(w.workflow().submit(pr.id, { expectedVersion: 1 })).resolves.toBeTruthy();
    });
  });

  describe('grant (Business Rule 1, US2-3)', () => {
    it.each(['suspended', 'closed'] as const)('a %s grant → GRANT_NOT_ACTIVE', async (status) => {
      const w = buildPrWorld();
      w.db.grants.get(w.grantId)!.status = status;
      const pr = w.seedDraft();
      expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }))).code).toBe(
        'GRANT_NOT_ACTIVE'
      );
    });

    it('a PR date outside the grant period → GRANT_PERIOD_MISMATCH', async () => {
      const w = buildPrWorld();
      w.db.grants.get(w.grantId)!.endDate = '2026-11-05';
      const pr = w.seedDraft({ prDate: '2026-11-10' });
      expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }))).code).toBe(
        'GRANT_PERIOD_MISMATCH'
      );
    });

    it('a requesting office the grant does not operate in → GRANT_OFFICE_MISMATCH', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ requestingOfficeId: KST_OFFICE_ID });
      expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }))).code).toBe(
        'GRANT_OFFICE_MISMATCH'
      );
    });
  });

  describe('exchange rates (US4-5)', () => {
    it('no rate for the grant / DoA currency on or before the PR date → EXCHANGE_RATE_MISSING', async () => {
      const w = buildPrWorld();
      w.rates.rows.splice(0);
      w.rates.add({ currency: 'USD', rateDate: '2026-11-11' }); // after the PR date
      const pr = w.seedDraft({ prDate: '2026-11-10' });
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
      expect(err.code).toBe('EXCHANGE_RATE_MISSING');
      expect(err.details).toEqual({ currencies: ['USD'], date: '2026-11-10' });
    });

    it('names a missing line currency too', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({}, [{ currency: 'EUR', unitCost: '10.00' }]);
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
      expect(err.code).toBe('EXCHANGE_RATE_MISSING');
      expect(err.details).toEqual({ currencies: ['EUR'], date: '2026-11-10' });
    });
  });

  it('per budget line Σ amount_grant > available → BUDGET_EXCEEDED with the shortfall (US4-2, Business Rule 3)', async () => {
    const w = buildPrWorld();
    w.ledger.lines.get(w.budgetLineId)!.budgetAmount = '2000.00';
    w.ledger.hold(w.budgetLineId, '1000.00'); // another PR's reservation
    // 2 × 870,710.00 SDG at 600 = 1,451.18 + 1,451.18 USD on the same budget line
    const pr = w.seedDraft({}, [{}, {}]);
    const lines = await w.db.lines(pr.id);
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toEqual({
      lines: [
        {
          budgetLineId: w.budgetLineId,
          code: '10202',
          requested: '2902.36',
          available: '1000.00',
          shortfall: '1902.36',
          currency: 'USD',
          prLineIds: lines.map((l) => l.id),
        },
      ],
    });
  });

  it('a step nobody can sign → NO_ELIGIBLE_APPROVER naming the step, role and rule (FR-020)', async () => {
    const w = buildPrWorld();
    w.routing.members = w.routing.members.filter((m) => m.userId !== w.approverUserId);
    const pr = w.seedDraft();
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('NO_ELIGIBLE_APPROVER');
    expect(err.details).toMatchObject({
      stepOrder: 2,
      kind: 'final_approval',
      roleId: w.roles.approver,
      ruleId: w.routing.rules[0]!.id,
    });
  });

  it('the requester is never counted as an eligible signer', async () => {
    const w = buildPrWorld();
    // the only finance checker is the requester
    w.routing.members = w.routing.members.filter((m) => m.userId !== w.financeUserId);
    w.routing.members.push({
      userId: w.requesterId,
      membershipId: 'm',
      status: 'active',
      roleIds: [w.roles.finance],
      orgWideAccess: true,
      officeIds: [],
    });
    const pr = w.seedDraft();
    const err = await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }));
    expect(err.code).toBe('NO_ELIGIBLE_APPROVER');
    expect(err.details).toMatchObject({ stepOrder: 1, kind: 'finance_check' });
  });

  describe('who and when', () => {
    it('only the creator may submit → FORBIDDEN', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const err = await failure(
        w.workflow({ userId: w.financeUserId }).submit(pr.id, { expectedVersion: 1 })
      );
      expect(err.code).toBe('FORBIDDEN');
    });

    it.each([
      'pending_finance_check',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ] as const)('a %s PR → INVALID_STATE', async (status) => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ status, number: 'PR-MAD-2026-0001', submissionCycle: 1 });
      expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }))).code).toBe(
        'INVALID_STATE'
      );
    });

    it('a stale version → VERSION_CONFLICT', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ version: 3 });
      expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 2 }))).code).toBe(
        'VERSION_CONFLICT'
      );
    });

    it('an unknown id → NOT_FOUND', async () => {
      const w = buildPrWorld();
      const err = await failure(
        w.workflow().submit('00000000-0000-4000-8000-000000000000', { expectedVersion: 1 })
      );
      expect(err.code).toBe('NOT_FOUND');
    });
  });

  it('a budget line of another grant → PR_LINE_GRANT_MISMATCH (Business Rule 2)', async () => {
    const w = buildPrWorld();
    const otherLine = '00000000-0000-4000-8000-0000000000b9';
    w.db.budgetLines.set(otherLine, 'another-grant');
    const pr = w.seedDraft({}, [{ budgetLineId: otherLine }]);
    expect((await failure(w.workflow().submit(pr.id, { expectedVersion: 1 }))).code).toBe(
      'PR_LINE_GRANT_MISMATCH'
    );
  });
});
