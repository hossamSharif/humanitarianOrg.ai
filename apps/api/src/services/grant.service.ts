// Donors and grants (FR-007, FR-008, FR-013, FR-022, Business Rule 1). A grant's currency is fixed
// once its budget lines carry commitments; a status change with pending PRs must be confirmed
// with the pending count the user saw.
import {
  parseAmount,
  type Donor,
  type DonorCreate,
  type DonorListQuery,
  type DonorUpdate,
  type Grant,
  type GrantCreate,
  type GrantDetail,
  type GrantListQuery,
  type GrantStatusChange,
  type GrantStatusChangeResult,
  type GrantUpdate,
  type ListResponse,
} from '@ngo/shared';
import { AppError } from '../middleware/error';
import { DonorRepository, type DonorStore } from '../repositories/donor.repository';
import {
  GrantRepository,
  type GrantFilter,
  type GrantStore,
  type GrantValues,
} from '../repositories/grant.repository';
import type { RequestContext } from '../types/context';

export interface GrantDeps {
  donors: DonorStore;
  grants: GrantStore;
}

export interface PrGrantContext {
  prDate: string;
  officeId: string;
}

/**
 * Why a grant cannot be charged by a PR dated `prDate` from `officeId`, or null when it can:
 * only Active grants whose period covers the date and that operate in the office (FR-022).
 */
export function grantPrMismatch(
  grant: Pick<Grant, 'status' | 'startDate' | 'endDate' | 'officeIds'>,
  { prDate, officeId }: PrGrantContext
): 'GRANT_NOT_ACTIVE' | 'GRANT_PERIOD_MISMATCH' | 'GRANT_OFFICE_MISMATCH' | null {
  if (grant.status !== 'active') return 'GRANT_NOT_ACTIVE';
  if (prDate < grant.startDate || prDate > grant.endDate) return 'GRANT_PERIOD_MISMATCH';
  if (!grant.officeIds.includes(officeId)) return 'GRANT_OFFICE_MISMATCH';
  return null;
}

export function isGrantSelectableForPr(
  grant: Pick<Grant, 'status' | 'startDate' | 'endDate' | 'officeIds'>,
  context: PrGrantContext
): boolean {
  return grantPrMismatch(grant, context) === null;
}

const MISMATCH_MESSAGES = {
  GRANT_NOT_ACTIVE: 'The grant is suspended or closed',
  GRANT_PERIOD_MISMATCH: 'The PR date is outside the grant period',
  GRANT_OFFICE_MISMATCH: 'The grant does not operate in the requesting office',
} as const;

/** For PR submit and every approval step (US4/US5). */
export function assertGrantSelectableForPr(
  grant: Pick<Grant, 'status' | 'startDate' | 'endDate' | 'officeIds'>,
  context: PrGrantContext
): void {
  const code = grantPrMismatch(grant, context);
  if (code) throw new AppError(code, MISMATCH_MESSAGES[code]);
}

function periodError(): AppError {
  return new AppError('VALIDATION_ERROR', 'End date must be on or after start date', [
    { field: 'endDate', message: 'before_start_date' },
  ]);
}

export class GrantService {
  constructor(private readonly deps: GrantDeps) {}

  static forContext(ctx: RequestContext): GrantService {
    return new GrantService({ donors: new DonorRepository(ctx), grants: new GrantRepository(ctx) });
  }

  // -------------------------------------------------------------------------------------------
  // Donors
  // -------------------------------------------------------------------------------------------

  listDonors(query: DonorListQuery): Promise<ListResponse<Donor>> {
    const { page, pageSize, sort, active } = query;
    return this.deps.donors.list({ isActive: active }, { page, pageSize }, sort);
  }

  async getDonor(id: string): Promise<Donor> {
    const donor = await this.deps.donors.findById(id);
    if (!donor) throw new AppError('NOT_FOUND', 'donor not found');
    return donor;
  }

  async createDonor(input: DonorCreate): Promise<Donor> {
    await this.assertDonorNameFree(input.name);
    return this.deps.donors.insert({
      name: input.name,
      shortName: input.shortName ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      notes: input.notes ?? null,
      isActive: true,
    });
  }

  async updateDonor(id: string, input: DonorUpdate): Promise<Donor> {
    await this.getDonor(id);
    if (input.name !== undefined) await this.assertDonorNameFree(input.name, id);
    return this.deps.donors.update(id, input);
  }

  // -------------------------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------------------------

  /** GET /grants; `selectableFor=pr` lists only grants a PR on that date/office may use. */
  listGrants(query: GrantListQuery): Promise<ListResponse<Grant>> {
    const { page, pageSize, sort } = query;
    const filter: GrantFilter =
      query.selectableFor === 'pr'
        ? { status: 'active', officeId: query.officeId, coversDate: query.prDate }
        : { status: query.status, donorId: query.donorId, officeId: query.officeId };
    return this.deps.grants.search(filter, { page, pageSize }, sort);
  }

  async getGrant(id: string): Promise<GrantDetail> {
    const grant = await this.findGrant(id);
    const [budgetLinesTotal, pendingPrCount, currencyLocked] = await Promise.all([
      this.deps.grants.budgetLinesTotal(id),
      this.deps.grants.pendingPrCount(id),
      this.deps.grants.hasCommitments(id),
    ]);
    const difference = parseAmount(grant.totalAmount).minus(budgetLinesTotal);
    return {
      ...grant,
      budgetLinesTotal: parseAmount(budgetLinesTotal).toFixed(2),
      difference: difference.toFixed(2),
      hasDifference: !difference.isZero(),
      pendingPrCount,
      currencyLocked,
    };
  }

  async createGrant(input: GrantCreate): Promise<Grant> {
    if (input.endDate < input.startDate) throw periodError();
    await this.assertDonorExists(input.donorId);
    await this.assertGrantCodeFree(input.code);

    const { officeIds, ...values } = input;
    const grant = await this.deps.grants.insert({ ...values, status: 'active' });
    const offices = [...new Set(officeIds)];
    await this.deps.grants.setOffices(grant.id, offices);
    return { ...grant, officeIds: offices.sort() };
  }

  async updateGrant(id: string, input: GrantUpdate): Promise<Grant> {
    const current = await this.findGrant(id);
    const { expectedVersion, officeIds, ...changes } = input;

    const startDate = changes.startDate ?? current.startDate;
    const endDate = changes.endDate ?? current.endDate;
    if (endDate < startDate) throw periodError();
    if (changes.donorId !== undefined && changes.donorId !== current.donorId) {
      await this.assertDonorExists(changes.donorId);
    }
    if (changes.code !== undefined && changes.code !== current.code) {
      await this.assertGrantCodeFree(changes.code, id);
    }
    if (
      changes.currency !== undefined &&
      changes.currency !== current.currency &&
      (await this.deps.grants.hasCommitments(id))
    ) {
      throw new AppError(
        'GRANT_CURRENCY_LOCKED',
        'The grant has budget commitments; its currency cannot change'
      );
    }

    // Always write at least one column so the version check and bump apply to office edits too.
    const values: Partial<GrantValues> = Object.keys(changes).length
      ? changes
      : { name: current.name };
    const grant = await this.deps.grants.update(id, values, expectedVersion);
    if (officeIds === undefined) return grant;

    const offices = [...new Set(officeIds)];
    await this.deps.grants.setOffices(id, offices);
    return { ...grant, officeIds: offices.sort() };
  }

  /**
   * POST /grants/:id/status. With pending PRs the first call only reports the count; the change
   * applies once `confirmPendingCount` equals the current count (FR-022).
   */
  async changeStatus(id: string, input: GrantStatusChange): Promise<GrantStatusChangeResult> {
    const current = await this.findGrant(id);
    if (current.version !== input.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    if (current.status === input.status) return { requiresConfirmation: false, grant: current };

    const pendingPrCount = await this.deps.grants.pendingPrCount(id);
    if (pendingPrCount > 0 && input.confirmPendingCount !== pendingPrCount) {
      return { requiresConfirmation: true, pendingPrCount };
    }
    const grant = await this.deps.grants.update(
      id,
      { status: input.status },
      input.expectedVersion
    );
    return { requiresConfirmation: false, grant };
  }

  // -------------------------------------------------------------------------------------------

  private async findGrant(id: string): Promise<Grant> {
    const grant = await this.deps.grants.findById(id);
    if (!grant) throw new AppError('NOT_FOUND', 'grant not found');
    return grant;
  }

  private async assertDonorExists(donorId: string): Promise<void> {
    if (!(await this.deps.donors.findById(donorId))) {
      throw new AppError('VALIDATION_ERROR', 'Unknown donor', [
        { field: 'donorId', message: 'not_found' },
      ]);
    }
  }

  private async assertDonorNameFree(name: string, exceptId?: string): Promise<void> {
    const existing = await this.deps.donors.findByName(name);
    if (existing && existing.id !== exceptId) {
      throw new AppError('VALIDATION_ERROR', 'A donor with this name already exists', [
        { field: 'name', message: 'already_exists' },
      ]);
    }
  }

  private async assertGrantCodeFree(code: string, exceptId?: string): Promise<void> {
    const existing = await this.deps.grants.findByCode(code);
    if (existing && existing.id !== exceptId) {
      throw new AppError('VALIDATION_ERROR', 'A grant with this code already exists', [
        { field: 'code', message: 'already_exists' },
      ]);
    }
  }
}
