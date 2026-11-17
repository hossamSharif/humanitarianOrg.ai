// Supplier registry and vetting (002 US2, FR-009…FR-012): suppliers with categories,
// documents and insert-only vetting; status changes (suspend and blacklist need a reason and
// suppliers:manage, approval needs suppliers:vet and a clear vetting within the re-vetting
// period); duplicate
// warnings that never block; and the eligibility check later stories use for invitation (a
// warning unless the supplier is not approved), award and payment (a block, unless a waiver
// covers an expired document, FR-011).
import {
  PERMISSIONS_002,
  SUPPLIER_REASON_STATUSES,
  SUPPLIER_STATUS_TRANSITIONS,
  type CreateSupplierInput,
  type EligibilityPurpose,
  type ListResponse,
  type Supplier,
  type SupplierDocumentInput,
  type SupplierEligibility,
  type SupplierIneligibleReason,
  type SupplierListQuery,
  type SupplierStatusInput,
  type SupplierSummary,
  type SupplierVettingInput,
  type UpdateSupplierInput,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { ProcurementSettingRepository } from '../repositories/procurement-setting.repository';
import { SupplierDocumentRepository } from '../repositories/supplier-document.repository';
import { SupplierVettingRepository } from '../repositories/supplier-vetting.repository';
import { SupplierRepository, type SupplierRecord } from '../repositories/supplier.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';

export interface SupplierRepos {
  tx: TenantTx;
  suppliers: SupplierRepository;
  documents: SupplierDocumentRepository;
  vettings: SupplierVettingRepository;
  settings: ProcurementSettingRepository;
}

/**
 * Reasons an approved waiver covers for this supplier (FR-011: `expired_document`). Waivers
 * arrive with US10; until then nothing is waived.
 */
export type WaivedReasonsLookup = (
  repos: SupplierRepos,
  supplierId: string
) => Promise<readonly SupplierIneligibleReason[]>;

export interface SupplierServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: SupplierRepos) => Promise<T>): Promise<T>;
  waivedReasons: WaivedReasonsLookup;
}

export const defaultSupplierDeps: SupplierServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn({
        tx,
        suppliers: new SupplierRepository(tx.sql, ctx.tenantId),
        documents: new SupplierDocumentRepository(tx.sql, ctx.tenantId),
        vettings: new SupplierVettingRepository(tx.sql, ctx.tenantId),
        settings: new ProcurementSettingRepository(tx.sql, ctx.tenantId),
      });
    }),
  waivedReasons: async () => [],
};

/** Every reason the supplier cannot be awarded or paid now (US2-1, US2-4). */
export function ineligibleReasons(s: SupplierRecord): SupplierIneligibleReason[] {
  const reasons: SupplierIneligibleReason[] = [];
  if (s.status === 'blacklisted') reasons.push('blacklisted');
  else if (s.status !== 'approved') reasons.push('not_approved');
  if (s.compliance.vettingOverdue) reasons.push('vetting_overdue');
  if (s.compliance.hasExpiredRequiredDoc) reasons.push('expired_document');
  return reasons;
}

/** Only an expired document can be waived (FR-011). */
const WAIVABLE: readonly SupplierIneligibleReason[] = ['expired_document'];

async function assertCategories(repos: SupplierRepos, ids: readonly string[]): Promise<void> {
  const found = await repos.suppliers.existingCategoryIds(ids);
  if (ids.some((id) => !found.has(id))) {
    throw new AppError('VALIDATION_ERROR', 'Unknown supplier category', [
      { field: 'categoryIds', message: 'invalid_reference' },
    ]);
  }
}

export class SupplierService {
  constructor(private readonly deps: SupplierServiceDeps = defaultSupplierDeps) {}

  private async detail(repos: SupplierRepos, id: string): Promise<Supplier> {
    const record = await repos.suppliers.getById(id);
    const [documents, vettings, duplicateWarnings] = await Promise.all([
      repos.documents.list(id),
      repos.vettings.list(id),
      repos.suppliers.duplicates(id),
    ]);
    const { ratingAvgOnTime, ratingAvgQuality, ratingAvgDocs, ratingCount, ...rest } = record;
    return {
      ...rest,
      ratings: {
        onTime: ratingAvgOnTime,
        quality: ratingAvgQuality,
        documentation: ratingAvgDocs,
        count: ratingCount,
      },
      documents,
      vettings,
      duplicateWarnings,
    };
  }

  list(ctx: RequestContext, query: SupplierListQuery): Promise<ListResponse<SupplierSummary>> {
    const { page, pageSize, sort, ...filters } = query;
    return this.deps.run(ctx, ({ suppliers }) =>
      suppliers.list({ pagination: { page, pageSize }, sort, ...filters })
    );
  }

  get(ctx: RequestContext, id: string): Promise<Supplier> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  /** New suppliers start as pending vetting; the response carries duplicate warnings. */
  create(ctx: RequestContext, input: CreateSupplierInput): Promise<Supplier> {
    const { categoryIds, ...values } = input;
    return this.deps.run(ctx, async (repos) => {
      await assertCategories(repos, categoryIds);
      const id = await repos.suppliers.insert(values);
      await repos.suppliers.setCategories(id, categoryIds);
      return this.detail(repos, id);
    });
  }

  update(ctx: RequestContext, id: string, input: UpdateSupplierInput): Promise<Supplier> {
    const { categoryIds, expectedVersion, ...values } = input;
    return this.deps.run(ctx, async (repos) => {
      await repos.suppliers.lock(id);
      if (categoryIds) await assertCategories(repos, categoryIds);
      await repos.suppliers.update(id, values, expectedVersion);
      if (categoryIds) await repos.suppliers.setCategories(id, categoryIds);
      return this.detail(repos, id);
    });
  }

  changeStatus(ctx: RequestContext, id: string, input: SupplierStatusInput): Promise<Supplier> {
    const reason = input.reason?.trim() || null;
    if (SUPPLIER_REASON_STATUSES.includes(input.status) && !reason) {
      throw new AppError('REASON_REQUIRED', 'A reason is required to suspend or blacklist');
    }
    // approving is the vetting officer's decision; other changes are the registry manager's
    const needed =
      input.status === 'approved'
        ? PERMISSIONS_002.SUPPLIERS_VET
        : PERMISSIONS_002.SUPPLIERS_MANAGE;
    if (!ctx.permissions.has(needed)) {
      throw new AppError('FORBIDDEN', `Missing permission ${needed}`);
    }
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.suppliers.lock(id);
      if (current.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (!SUPPLIER_STATUS_TRANSITIONS[current.status].includes(input.status)) {
        throw new AppError(
          'INVALID_STATE',
          `A supplier cannot go from ${current.status} to ${input.status}`
        );
      }
      if (input.status === 'approved') {
        const { revettingMonths } = await repos.settings.get();
        if (!(await repos.vettings.hasCurrentClear(id, revettingMonths))) {
          throw new AppError('SUPPLIER_NOT_ELIGIBLE', 'A current clear vetting is required', {
            supplierId: id,
            reasons: ['vetting_overdue'],
          });
        }
      }
      await repos.tx.setAuditComment(reason);
      await repos.suppliers.setStatus(
        id,
        input.status,
        input.status === 'approved' ? null : reason,
        input.expectedVersion
      );
      return this.detail(repos, id);
    });
  }

  addDocument(ctx: RequestContext, id: string, input: SupplierDocumentInput): Promise<Supplier> {
    return this.deps.run(ctx, async (repos) => {
      await repos.suppliers.getById(id);
      await repos.documents.insert(id, input);
      return this.detail(repos, id);
    });
  }

  /** Insert-only (FR-010); a clear result also moves last_vetted_at (migration 0015). */
  addVetting(ctx: RequestContext, id: string, input: SupplierVettingInput): Promise<Supplier> {
    return this.deps.run(ctx, async (repos) => {
      await repos.suppliers.getById(id);
      await repos.vettings.insert(id, input);
      return this.detail(repos, id);
    });
  }

  /**
   * Whether the supplier may be invited, awarded or paid. Invitation needs an approved supplier
   * (overdue vetting and expired documents are warnings then); award and payment need every
   * reason cleared, an expired document only by an approved waiver.
   */
  eligibility(
    ctx: RequestContext,
    supplierId: string,
    purpose: EligibilityPurpose
  ): Promise<SupplierEligibility> {
    return this.deps.run(ctx, (repos) => this.eligibilityIn(repos, supplierId, purpose));
  }

  async eligibilityIn(
    repos: SupplierRepos,
    supplierId: string,
    purpose: EligibilityPurpose
  ): Promise<SupplierEligibility> {
    const record = await repos.suppliers.getById(supplierId);
    const reasons = ineligibleReasons(record);
    if (purpose === 'invite') {
      return { supplierId, purpose, eligible: record.status === 'approved', reasons };
    }
    const waived = reasons.some((r) => WAIVABLE.includes(r))
      ? await this.deps.waivedReasons(repos, supplierId)
      : [];
    const open = reasons.filter((r) => !(WAIVABLE.includes(r) && waived.includes(r)));
    return { supplierId, purpose, eligible: open.length === 0, reasons: open };
  }

  /** 422 SUPPLIER_NOT_ELIGIBLE with the reasons, for award and payment. */
  async assertEligible(
    repos: SupplierRepos,
    supplierId: string,
    purpose: EligibilityPurpose
  ): Promise<void> {
    const result = await this.eligibilityIn(repos, supplierId, purpose);
    if (!result.eligible) {
      throw new AppError('SUPPLIER_NOT_ELIGIBLE', 'The supplier is not eligible', {
        supplierId,
        reasons: result.reasons,
      });
    }
  }
}
