// Procurement configuration (002 US1, FR-001…FR-004): settings, the tenant's method bands and
// stricter per-grant bands (research D4), deduction types, payment and supplier categories, and
// the method a set of approved PR lines requires. Band sets are validated here first
// (422 PROCUREMENT_BANDS_INVALID with gaps and overlaps); migration 0015 is the backstop.
// Editing configuration never changes a sourcing event already created: events store their
// method snapshot (US1-4).
import {
  resolveProcurementMethod,
  validateBands,
  type CreateDeductionTypeInput,
  type CreatePaymentCategoryInput,
  type CreateSupplierCategoryInput,
  type DeductionType,
  type MethodBand,
  type MethodBandSet,
  type MethodBandsInput,
  type PaymentCategory,
  type ProcurementSettings,
  type ProcurementSettingsInput,
  type ResolveMethodInput,
  type ResolveMethodResponse,
  type SupplierCategory,
  type UpdateDeductionTypeInput,
  type UpdatePaymentCategoryInput,
  type UpdateSupplierCategoryInput,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { DeductionTypeRepository } from '../repositories/deduction-type.repository';
import { MethodBandRepository } from '../repositories/method-band.repository';
import { PaymentCategoryRepository } from '../repositories/payment-category.repository';
import { ProcurementSettingRepository } from '../repositories/procurement-setting.repository';
import { SourcingEventRepository } from '../repositories/sourcing-event.repository';
import { SupplierCategoryRepository } from '../repositories/supplier-category.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { splittingWarningFor } from './sourcing.service';

export interface ProcurementConfigRepos {
  settings: ProcurementSettingRepository;
  bands: MethodBandRepository;
  deductions: DeductionTypeRepository;
  paymentCategories: PaymentCategoryRepository;
  supplierCategories: SupplierCategoryRepository;
  events: SourcingEventRepository;
}

export interface ProcurementConfigDeps {
  run<T>(ctx: RequestContext, fn: (repos: ProcurementConfigRepos) => Promise<T>): Promise<T>;
}

export const defaultProcurementConfigDeps: ProcurementConfigDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      // the organization's 002 defaults (seed hook 30) exist before the first read
      await ensureTenantSeeds(tx);
      return fn({
        settings: new ProcurementSettingRepository(tx.sql, ctx.tenantId),
        bands: new MethodBandRepository(tx.sql, ctx.tenantId),
        deductions: new DeductionTypeRepository(tx.sql, ctx.tenantId),
        paymentCategories: new PaymentCategoryRepository(tx.sql, ctx.tenantId),
        supplierCategories: new SupplierCategoryRepository(tx.sql, ctx.tenantId),
        events: new SourcingEventRepository(tx.sql, ctx.tenantId),
      });
    }),
};

/** 422 PROCUREMENT_BANDS_INVALID unless the set starts at 0, is contiguous and ends open. */
export function assertBands(bands: readonly MethodBand[]): void {
  const { gaps, overlaps } = validateBands(bands);
  if (gaps.length || overlaps.length) {
    throw new AppError('PROCUREMENT_BANDS_INVALID', 'The procurement bands are not valid', {
      gaps,
      overlaps,
    });
  }
}

const codeTaken = () =>
  new AppError('VALIDATION_ERROR', 'The code is already used', [
    { field: 'code', message: 'already_exists' },
  ]);

/** PR statuses whose lines may be sourced. */
const SOURCEABLE_PR_STATUSES = new Set(['approved', 'in_procurement']);

export class ProcurementConfigService {
  constructor(private readonly deps: ProcurementConfigDeps = defaultProcurementConfigDeps) {}

  // --- settings ------------------------------------------------------------------------------

  getSettings(ctx: RequestContext): Promise<ProcurementSettings> {
    return this.deps.run(ctx, ({ settings }) => settings.get());
  }

  updateSettings(
    ctx: RequestContext,
    input: ProcurementSettingsInput
  ): Promise<ProcurementSettings> {
    if (input.committeeMinSize < 2) {
      throw new AppError('VALIDATION_ERROR', 'A committee needs at least 2 members', [
        { field: 'committeeMinSize', message: 'too_small' },
      ]);
    }
    return this.deps.run(ctx, ({ settings }) => settings.update(input));
  }

  // --- method bands --------------------------------------------------------------------------

  getTenantBands(ctx: RequestContext): Promise<MethodBandSet> {
    return this.deps.run(ctx, async ({ bands }) => ({
      currency: await bands.doaReferenceCurrency(),
      bands: await bands.listTenant(),
    }));
  }

  replaceTenantBands(ctx: RequestContext, input: MethodBandsInput): Promise<MethodBandSet> {
    assertBands(input.bands);
    return this.deps.run(ctx, async ({ bands }) => {
      await bands.replaceTenant(input.bands);
      return { currency: await bands.doaReferenceCurrency(), bands: await bands.listTenant() };
    });
  }

  getGrantBands(ctx: RequestContext, grantId: string): Promise<MethodBandSet> {
    return this.deps.run(ctx, async ({ bands }) => {
      if (!(await bands.grantExists(grantId))) throw new AppError('NOT_FOUND', 'Grant not found');
      return {
        currency: await bands.doaReferenceCurrency(),
        bands: await bands.listGrant(grantId),
      };
    });
  }

  /** Empty = the grant has no stricter rule. */
  replaceGrantBands(
    ctx: RequestContext,
    grantId: string,
    input: MethodBandsInput
  ): Promise<MethodBandSet> {
    if (input.bands.length > 0) assertBands(input.bands);
    return this.deps.run(ctx, async ({ bands }) => {
      if (!(await bands.grantExists(grantId))) throw new AppError('NOT_FOUND', 'Grant not found');
      await bands.replaceGrant(grantId, input.bands);
      return {
        currency: await bands.doaReferenceCurrency(),
        bands: await bands.listGrant(grantId),
      };
    });
  }

  /**
   * The method the selected approved PR lines require (research D4): the estimated value uses
   * the PRs' locked rates, and the stricter of the tenant and grant bands applies.
   */
  resolveMethod(ctx: RequestContext, input: ResolveMethodInput): Promise<ResolveMethodResponse> {
    const ids = [...new Set(input.prLineIds)];
    return this.deps.run(ctx, async ({ bands, settings, events }) => {
      const lines = await bands.prLines(ids);
      if (lines.length !== ids.length) throw new AppError('NOT_FOUND', 'PR line not found');

      const notSourceable = lines.filter((l) => !SOURCEABLE_PR_STATUSES.has(l.prStatus));
      if (notSourceable.length) {
        throw new AppError('INVALID_STATE', 'Only lines of approved PRs can be sourced');
      }
      const grants = new Set(lines.map((l) => l.grantId));
      const offices = new Set(lines.map((l) => l.officeId));
      if (grants.size > 1 || offices.size > 1) {
        throw new AppError('MIXED_GRANTS', 'The PR lines belong to different grants or offices');
      }

      const grantId = lines[0]!.grantId;
      const tenantBands = await bands.listTenant();
      const grantBands = grantId ? await bands.listGrant(grantId) : [];
      const resolved = resolveProcurementMethod({
        lines: lines.map((l) => {
          // approved PRs always carry their locked rates (001 R7)
          if (l.rateToBase === null || l.doaRateToBase === null) {
            throw new AppError('INVALID_STATE', 'The PR has no locked exchange rates');
          }
          return {
            lineTotal: l.lineTotal,
            rateToBase: l.rateToBase,
            doaRateToBase: l.doaRateToBase,
          };
        }),
        tenantBands,
        grantBands,
      });
      const splittingWarning = await splittingWarningFor(
        { events, settings },
        await events.prLines(ids, { lock: false }),
        resolved,
        null
      );
      return {
        ...resolved,
        currency: await bands.doaReferenceCurrency(),
        ...(splittingWarning ? { splittingWarning } : {}),
      };
    });
  }

  // --- deduction types -----------------------------------------------------------------------

  listDeductionTypes(ctx: RequestContext): Promise<DeductionType[]> {
    return this.deps.run(ctx, ({ deductions }) => deductions.list());
  }

  createDeductionType(
    ctx: RequestContext,
    input: CreateDeductionTypeInput
  ): Promise<DeductionType> {
    return this.deps.run(ctx, async ({ deductions }) => {
      await assertPayableAccount(deductions, input.payableAccountId);
      return deductions.getById(await deductions.insert(input));
    });
  }

  updateDeductionType(
    ctx: RequestContext,
    id: string,
    input: UpdateDeductionTypeInput
  ): Promise<DeductionType> {
    return this.deps.run(ctx, async ({ deductions }) => {
      if (input.payableAccountId) await assertPayableAccount(deductions, input.payableAccountId);
      await deductions.update(id, input);
      return deductions.getById(id);
    });
  }

  // --- categories ----------------------------------------------------------------------------

  listPaymentCategories(ctx: RequestContext): Promise<PaymentCategory[]> {
    return this.deps.run(ctx, ({ paymentCategories }) => paymentCategories.list());
  }

  createPaymentCategory(
    ctx: RequestContext,
    input: CreatePaymentCategoryInput
  ): Promise<PaymentCategory> {
    return this.deps.run(ctx, async ({ paymentCategories: repo }) => {
      if (await repo.findByCode(input.code)) throw codeTaken();
      return repo.getById(await repo.insert(input));
    });
  }

  updatePaymentCategory(
    ctx: RequestContext,
    id: string,
    input: UpdatePaymentCategoryInput
  ): Promise<PaymentCategory> {
    const { expectedVersion, ...values } = input;
    return this.deps.run(ctx, async ({ paymentCategories: repo }) => {
      if (values.code !== undefined) {
        const other = await repo.findByCode(values.code);
        if (other && other.id !== id) throw codeTaken();
      }
      await repo.update(id, values, expectedVersion);
      return repo.getById(id);
    });
  }

  listSupplierCategories(ctx: RequestContext): Promise<SupplierCategory[]> {
    return this.deps.run(ctx, ({ supplierCategories }) => supplierCategories.list());
  }

  createSupplierCategory(
    ctx: RequestContext,
    input: CreateSupplierCategoryInput
  ): Promise<SupplierCategory> {
    return this.deps.run(ctx, async ({ supplierCategories: repo }) => {
      if (await repo.findByCode(input.code)) throw codeTaken();
      return repo.getById(await repo.insert(input));
    });
  }

  updateSupplierCategory(
    ctx: RequestContext,
    id: string,
    input: UpdateSupplierCategoryInput
  ): Promise<SupplierCategory> {
    const { expectedVersion, ...values } = input;
    return this.deps.run(ctx, async ({ supplierCategories: repo }) => {
      if (values.code !== undefined) {
        const other = await repo.findByCode(values.code);
        if (other && other.id !== id) throw codeTaken();
      }
      await repo.update(id, values, expectedVersion);
      return repo.getById(id);
    });
  }
}

async function assertPayableAccount(repo: DeductionTypeRepository, accountId: string) {
  if (!(await repo.isPayableAccount(accountId))) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The payable account must be a liability posting account',
      [{ field: 'payableAccountId', message: 'invalid_reference' }]
    );
  }
}
