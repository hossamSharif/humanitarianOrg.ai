// T068 — grants: period rule, status change with pending-PR confirmation (FR-022), currency
// locked once committed, and which grants a PR may select (US2-2, Business Rule 1).
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import {
  GrantService,
  assertGrantSelectableForPr,
  grantPrMismatch,
} from '../../src/services/grant.service';
import { KST_OFFICE_ID, MAD_OFFICE_ID } from './helpers/builders';
import { FakeDonorStore, FakeGrantStore, buildDonor, buildGrant } from './helpers/funding-fakes';

let donors: FakeDonorStore;
let grants: FakeGrantStore;
let service: GrantService;
const donor = buildDonor();

beforeEach(() => {
  donors = new FakeDonorStore().seed(donor);
  grants = new FakeGrantStore();
  service = new GrantService({ donors, grants });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const createInput = () => ({
  donorId: donor.id,
  code: 'ADRA-2026-01',
  name: 'Madani WASH',
  currency: 'USD',
  totalAmount: '50000.00',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  officeIds: [MAD_OFFICE_ID, KST_OFFICE_ID, MAD_OFFICE_ID],
});

describe('create and update', () => {
  it('creates an active grant with its offices (deduplicated)', async () => {
    const grant = await service.createGrant(createInput());
    expect(grant).toMatchObject({ status: 'active', code: 'ADRA-2026-01', version: 1 });
    expect(grant.officeIds).toEqual([MAD_OFFICE_ID, KST_OFFICE_ID].sort());
  });

  it('end_date before start_date → VALIDATION_ERROR on endDate', async () => {
    const error = await expectAppError(
      service.createGrant({ ...createInput(), startDate: '2026-06-01', endDate: '2026-05-31' }),
      'VALIDATION_ERROR'
    );
    expect(error.details).toEqual([{ field: 'endDate', message: 'before_start_date' }]);
  });

  it('a one-day grant (end = start) is valid', async () => {
    await expect(
      service.createGrant({ ...createInput(), startDate: '2026-06-01', endDate: '2026-06-01' })
    ).resolves.toBeDefined();
  });

  it('the period rule also applies to partial updates against stored dates', async () => {
    const grant = await service.createGrant(createInput());
    await expectAppError(
      service.updateGrant(grant.id, { endDate: '2025-12-31', expectedVersion: grant.version }),
      'VALIDATION_ERROR'
    );
  });

  it('unknown donor and duplicate code are field errors', async () => {
    const e1 = await expectAppError(
      service.createGrant({ ...createInput(), donorId: randomUUID() }),
      'VALIDATION_ERROR'
    );
    expect(e1.details).toEqual([{ field: 'donorId', message: 'not_found' }]);
    await service.createGrant(createInput());
    const e2 = await expectAppError(service.createGrant(createInput()), 'VALIDATION_ERROR');
    expect(e2.details).toEqual([{ field: 'code', message: 'already_exists' }]);
  });

  it('currency is immutable once any budget line has a commitment', async () => {
    const grant = await service.createGrant(createInput());
    grants.withCommitments.add(grant.id);
    await expectAppError(
      service.updateGrant(grant.id, { currency: 'EUR', expectedVersion: 1 }),
      'GRANT_CURRENCY_LOCKED'
    );
    // other fields still editable; same currency is not a change
    const updated = await service.updateGrant(grant.id, {
      name: 'Renamed',
      currency: 'USD',
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ name: 'Renamed', currency: 'USD', version: 2 });
  });

  it('currency may change while nothing is committed', async () => {
    const grant = await service.createGrant(createInput());
    expect(
      (await service.updateGrant(grant.id, { currency: 'EUR', expectedVersion: 1 })).currency
    ).toBe('EUR');
  });

  it('office-only edits still check and bump the version', async () => {
    const grant = await service.createGrant(createInput());
    const updated = await service.updateGrant(grant.id, {
      officeIds: [KST_OFFICE_ID],
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ officeIds: [KST_OFFICE_ID], version: 2 });
    await expectAppError(
      service.updateGrant(grant.id, { officeIds: [MAD_OFFICE_ID], expectedVersion: 1 }),
      'VERSION_CONFLICT'
    );
  });
});

describe('status change (FR-022)', () => {
  it('no pending PRs → applies immediately', async () => {
    const grant = await service.createGrant(createInput());
    const result = await service.changeStatus(grant.id, {
      status: 'suspended',
      expectedVersion: 1,
    });
    expect(result).toMatchObject({ requiresConfirmation: false, grant: { status: 'suspended' } });
  });

  it('pending PRs → asks for confirmation until confirmPendingCount matches', async () => {
    const grant = await service.createGrant(createInput());
    grants.pending.set(grant.id, 3);

    expect(await service.changeStatus(grant.id, { status: 'closed', expectedVersion: 1 })).toEqual({
      requiresConfirmation: true,
      pendingPrCount: 3,
    });
    expect(
      await service.changeStatus(grant.id, {
        status: 'closed',
        expectedVersion: 1,
        confirmPendingCount: 2,
      })
    ).toEqual({ requiresConfirmation: true, pendingPrCount: 3 });
    expect(grants.rows.get(grant.id)!.status).toBe('active');

    const done = await service.changeStatus(grant.id, {
      status: 'closed',
      expectedVersion: 1,
      confirmPendingCount: 3,
    });
    expect(done).toMatchObject({ requiresConfirmation: false, grant: { status: 'closed' } });
  });

  it('stale version → VERSION_CONFLICT', async () => {
    const grant = await service.createGrant(createInput());
    await expectAppError(
      service.changeStatus(grant.id, { status: 'closed', expectedVersion: 7 }),
      'VERSION_CONFLICT'
    );
  });
});

describe('grant detail', () => {
  it('reports the budget-lines difference as a warning and the pending count', async () => {
    const grant = await service.createGrant(createInput());
    grants.lineTotals.set(grant.id, '45000.00');
    grants.pending.set(grant.id, 2);
    expect(await service.getGrant(grant.id)).toMatchObject({
      budgetLinesTotal: '45000.00',
      difference: '5000.00',
      hasDifference: true,
      pendingPrCount: 2,
      currencyLocked: false,
    });
  });
});

describe('selectable for a PR (US2-2)', () => {
  const ctx = { prDate: '2026-11-10', officeId: MAD_OFFICE_ID };

  it('only active grants covering the PR date that operate in the office', async () => {
    const ok = buildGrant({ code: 'A-OK' });
    grants.seed(
      ok,
      buildGrant({ code: 'B-SUSPENDED', status: 'suspended' }),
      buildGrant({ code: 'C-CLOSED', status: 'closed' }),
      buildGrant({ code: 'D-ENDED', endDate: '2026-11-09' }),
      buildGrant({ code: 'E-FUTURE', startDate: '2026-11-11' }),
      buildGrant({ code: 'F-OTHER-OFFICE', officeIds: [KST_OFFICE_ID] }),
      buildGrant({ code: 'G-EDGE', startDate: '2026-11-10', endDate: '2026-11-10' })
    );
    const list = await service.listGrants({
      page: 1,
      pageSize: 50,
      selectableFor: 'pr',
      ...ctx,
    });
    expect(list.data.map((g) => g.code)).toEqual(['A-OK', 'G-EDGE']);
  });

  it('assertGrantSelectableForPr names the reason', () => {
    expect(grantPrMismatch(buildGrant(), ctx)).toBeNull();
    expect(grantPrMismatch(buildGrant({ status: 'closed' }), ctx)).toBe('GRANT_NOT_ACTIVE');
    expect(grantPrMismatch(buildGrant({ endDate: '2026-10-31' }), ctx)).toBe(
      'GRANT_PERIOD_MISMATCH'
    );
    expect(grantPrMismatch(buildGrant({ officeIds: [KST_OFFICE_ID] }), ctx)).toBe(
      'GRANT_OFFICE_MISMATCH'
    );
    expect(() => assertGrantSelectableForPr(buildGrant({ status: 'suspended' }), ctx)).toThrow(
      AppError
    );
  });
});

describe('donors', () => {
  it('names are unique case-insensitively', async () => {
    const error = await expectAppError(service.createDonor({ name: 'adra' }), 'VALIDATION_ERROR');
    expect(error.details).toEqual([{ field: 'name', message: 'already_exists' }]);
    const other = await service.createDonor({ name: 'UNICEF', shortName: 'UNICEF' });
    await expectAppError(service.updateDonor(other.id, { name: 'ADRA' }), 'VALIDATION_ERROR');
    expect((await service.updateDonor(other.id, { name: 'unicef' })).name).toBe('unicef');
  });
});
