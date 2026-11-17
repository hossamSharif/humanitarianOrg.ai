// Goods received notes (002 US7, FR-039–FR-042; research R24). A GRN is recorded against an
// approved purchase order — acknowledged first when the organization requires it — and inherits
// its supplier and PO number. It is numbered on creation and completed by two signatures from
// two different people, Received By and Inspected By (receiver_is_inspector). Completion locks
// the PO lines and refuses an accepted quantity above ordered × (1 + tolerance) − already
// accepted (OVER_RECEIPT); the PO's receipt status is then recomputed, and a fully received PO
// asks its creator for a supplier rating (supplier_rating_due, FR-013).
import {
  Decimal,
  PERMISSIONS_002,
  parseAmount,
  type CreateGrnInput,
  type GrnCancelInput,
  type GrnDetail,
  type GrnListQuery,
  type GrnReturnInput,
  type GrnSignInput,
  type GrnSignatureView,
  type GrnSummary,
  type ListResponse,
  type Permission,
  type PoRatingInput,
  type ReceiptSignRole,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { DocSignatureRepository } from '../repositories/doc-signature.repository';
import { GrnLineRepository } from '../repositories/grn-line.repository';
import { GrnRepository, type GrnRecord } from '../repositories/grn.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { NumberingRepository } from '../repositories/numbering.repository';
import { SupplierRatingRepository } from '../repositories/supplier-rating.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { NumberingService, numberingTxStore } from './numbering.service';
import { poRepos, refreshReceiptStatus, type PoRepos } from './purchase-order.service';
import { assertCanSign } from './segregation.service';

export interface ReceiptRepos extends PoRepos {
  grns: GrnRepository;
  grnLines: GrnLineRepository;
  ratings: SupplierRatingRepository;
  signatures: DocSignatureRepository;
  notifications: NotificationRepository;
  numbering: NumberingService;
}

export interface ReceiptServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: ReceiptRepos) => Promise<T>): Promise<T>;
}

export function receiptRepos(tx: TenantTx, ctx: RequestContext): ReceiptRepos {
  const t = ctx.tenantId;
  return {
    ...poRepos(tx, ctx),
    grns: new GrnRepository(tx.sql, t),
    grnLines: new GrnLineRepository(tx.sql, t),
    ratings: new SupplierRatingRepository(tx.sql, t),
    signatures: new DocSignatureRepository(tx.sql, t, 'GRN'),
    notifications: new NotificationRepository(tx.sql, t),
    numbering: new NumberingService(new NumberingRepository(ctx), numberingTxStore(t)),
  };
}

export const defaultReceiptDeps: ReceiptServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(receiptRepos(tx, ctx));
    }),
};

const RECEIVABLE = new Set(['approved', 'acknowledged', 'partially_received']);

const ROLE_PERMISSION: Record<ReceiptSignRole, Permission> = {
  received: PERMISSIONS_002.GRN_CREATE,
  inspected: PERMISSIONS_002.GRN_INSPECT,
};

function assertPermission(ctx: RequestContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

/** The largest acceptable quantity for a line: ordered × (1 + tol%) − already accepted (BR-11). */
export function maxAcceptable(ordered: string, alreadyAccepted: string, tolerancePct: string): Decimal {
  const max = parseAmount(ordered)
    .times(parseAmount(tolerancePct).dividedBy(100).plus(1))
    .minus(parseAmount(alreadyAccepted));
  return Decimal.max(max, 0).toDecimalPlaces(3, Decimal.ROUND_DOWN);
}

export class ReceiptService {
  constructor(private readonly deps: ReceiptServiceDeps = defaultReceiptDeps) {}

  // --- reads ---------------------------------------------------------------------------------

  list(ctx: RequestContext, query: GrnListQuery): Promise<ListResponse<GrnSummary>> {
    return this.deps.run(ctx, ({ grns }) =>
      grns.list({ page: query.page, pageSize: query.pageSize, status: query.status, poId: query.poId })
    );
  }

  get(ctx: RequestContext, id: string): Promise<GrnDetail> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: ReceiptRepos, id: string): Promise<GrnDetail> {
    const grn = await repos.grns.get(id);
    const [lines, signed] = await Promise.all([
      repos.grnLines.list(id),
      repos.signatures.list(id),
    ]);
    const signatures: GrnSignatureView[] = signed
      .filter((s) => s.action === 'received' || s.action === 'inspected')
      .map((s) => ({
        role: s.action as ReceiptSignRole,
        userId: s.userId,
        userName: s.userName,
        actedAt: s.actedAt,
      }));
    return { ...grn, lines, signatures, availableActions: this.actionsFor(repos.ctx, grn, lines, signatures) };
  }

  actionsFor(
    ctx: RequestContext,
    grn: GrnRecord,
    lines: GrnDetail['lines'],
    signatures: readonly GrnSignatureView[]
  ): string[] {
    const actions: string[] = [];
    const by = (role: ReceiptSignRole) => signatures.find((s) => s.role === role);
    if (grn.status === 'draft') {
      for (const role of ['received', 'inspected'] as const) {
        const other = by(role === 'received' ? 'inspected' : 'received');
        if (!by(role) && ctx.permissions.has(ROLE_PERMISSION[role]) && other?.userId !== ctx.userId) {
          actions.push(`sign_${role}`);
        }
      }
      if (ctx.permissions.has(PERMISSIONS_002.GRN_CREATE)) actions.push('cancel');
    }
    if (
      grn.status !== 'cancelled' &&
      ctx.permissions.has(PERMISSIONS_002.GRN_CREATE) &&
      lines.some((l) => parseAmount(l.rejectedQty).gt(0) && l.returnedOn === null)
    ) {
      actions.push('return');
    }
    return actions;
  }

  // --- commands ------------------------------------------------------------------------------

  /** POST /pos/:id/grns — numbered now; supplier and PO number inherited (FR-039). */
  create(ctx: RequestContext, poId: string, input: CreateGrnInput): Promise<GrnDetail> {
    assertPermission(ctx, PERMISSIONS_002.GRN_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(poId, { lock: true });
      if (!RECEIVABLE.has(po.status)) {
        throw new AppError('INVALID_STATE', 'Goods are received against an approved purchase order');
      }
      if (po.kind === 'contract' || po.isService) {
        throw new AppError(
          'INVALID_STATE',
          'Services and contracts are completed by a completion certificate, not a GRN'
        );
      }
      if (!po.acknowledgedAt && (await repos.pos.requireAcknowledgement())) {
        throw new AppError('PO_NOT_ACKNOWLEDGED', 'The supplier has not acknowledged the purchase order');
      }

      const poLines = await repos.lines.lock(poId);
      const tolerance = await repos.grns.overDeliveryTolerancePct();
      for (const l of input.lines) {
        const line = poLines.find((p) => p.id === l.poLineId);
        if (!line) {
          throw new AppError('INHERITED_FIELD_MISMATCH', 'A GRN line belongs to a line of this PO', {
            poLineId: l.poLineId,
          });
        }
        this.assertWithinOrder(line, l.acceptedQty, tolerance);
      }

      const facts = await repos.events.tenantFacts();
      const number = await repos.numbering.assignNumber(
        repos.tx.sql,
        'GRN',
        po.officeId,
        new Date(),
        facts.timeZone
      );
      const id = await repos.grns.insert({
        number,
        poId,
        officeId: po.officeId,
        supplierId: po.supplierId,
        receivedDate: input.receivedDate,
        deliveryNoteNo: input.deliveryNoteNo,
        supplierInvoiceNo: input.supplierInvoiceNo ?? null,
        shipmentType: input.shipmentType,
      });
      await repos.grnLines.insertMany(id, input.lines);
      return this.detail(repos, id);
    });
  }

  /** POST /grns/:id/sign — Received By / Inspected By; both complete the GRN (FR-041). */
  sign(ctx: RequestContext, id: string, input: GrnSignInput): Promise<GrnDetail> {
    assertPermission(ctx, ROLE_PERMISSION[input.role]);
    return this.deps.run(ctx, async (repos) => {
      const grn = await repos.grns.get(id, { lock: true });
      if (grn.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (grn.status !== 'draft') throw new AppError('INVALID_STATE', 'The GRN is not a draft');
      const prior = await repos.signatures.list(id);
      if (prior.some((s) => s.action === input.role)) {
        throw new AppError('INVALID_STATE', `The GRN is already signed as ${input.role}`);
      }
      assertCanSign(
        { docType: 'GRN', creatorId: grn.createdBy },
        ctx.userId,
        { kind: input.role },
        prior.map((s) => ({
          userId: s.userId,
          action: s.action,
          cycle: s.cycle,
          stepOrder: s.stepOrder,
        }))
      );

      const [me] = await repos.tx.sql<{ full_name_ar: string; full_name_en: string; position_title: string | null }[]>`
        select full_name_ar, full_name_en, position_title from public.membership
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}`;
      if (!me) throw new AppError('FORBIDDEN', 'No membership in this organization');
      await repos.signatures.insert({
        docId: id,
        stepId: null,
        cycle: 1,
        stepOrder: null,
        action: input.role,
        userName: me.full_name_en,
        userPosition: me.position_title,
        comment: null,
        payload: { nameAr: me.full_name_ar },
      });

      const other = input.role === 'received' ? 'inspected' : 'received';
      if (prior.some((s) => s.action === other)) {
        await this.complete(repos, grn);
      } else {
        await repos.grns.touch(id, input.expectedVersion);
      }
      return this.detail(repos, id);
    });
  }

  /** Both signatures: the over-receipt check under the PO line locks, then the PO status. */
  private async complete(repos: ReceiptRepos, grn: GrnRecord): Promise<void> {
    await repos.pos.get(grn.poId, { lock: true });
    const poLines = await repos.lines.lock(grn.poId);
    const tolerance = await repos.grns.overDeliveryTolerancePct();
    for (const l of await repos.grnLines.list(grn.id)) {
      const line = poLines.find((p) => p.id === l.poLineId)!;
      this.assertWithinOrder(line, l.acceptedQty, tolerance);
    }
    await repos.grns.complete(grn.id);

    const po = await repos.pos.get(grn.poId);
    const status = await refreshReceiptStatus(repos, po);
    if (status === 'fully_received') {
      await repos.notifications.insertMany([
        {
          userId: po.createdBy,
          kind: 'supplier_rating_due',
          docType: po.docType,
          docId: po.id,
          params: { number: po.number },
          dedupeKey: `supplier_rating_due:${po.id}`,
        },
      ]);
    }
  }

  /** 422 OVER_RECEIPT with the figures when `accepted` exceeds what the line still allows. */
  private assertWithinOrder(
    line: { id: string; quantity: string; acceptedQty: string },
    accepted: string,
    tolerancePct: string
  ): void {
    const max = maxAcceptable(line.quantity, line.acceptedQty, tolerancePct);
    if (parseAmount(accepted).gt(max)) {
      throw new AppError('OVER_RECEIPT', 'The accepted quantity exceeds the order', {
        poLineId: line.id,
        ordered: line.quantity,
        alreadyAccepted: line.acceptedQty,
        tolerancePct,
        maxAcceptable: max.toFixed(3),
      });
    }
  }

  /** POST /grns/:id/lines/:lineId/return — the rejected quantity went back to the supplier. */
  returnLine(ctx: RequestContext, id: string, lineId: string, input: GrnReturnInput): Promise<GrnDetail> {
    assertPermission(ctx, PERMISSIONS_002.GRN_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const grn = await repos.grns.get(id, { lock: true });
      if (grn.status === 'cancelled') throw new AppError('INVALID_STATE', 'The GRN is cancelled');
      if (input.returnedOn < grn.receivedDate) {
        throw new AppError('VALIDATION_ERROR', 'The return cannot be before the receipt', [
          { field: 'returnedOn', message: 'before_received_date' },
        ]);
      }
      await repos.grnLines.setReturned(id, lineId, input.returnedOn);
      return this.detail(repos, id);
    });
  }

  /** POST /grns/:id/cancel — a draft only (its number stays used). */
  cancel(ctx: RequestContext, id: string, input: GrnCancelInput): Promise<GrnDetail> {
    assertPermission(ctx, PERMISSIONS_002.GRN_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const grn = await repos.grns.get(id, { lock: true });
      if (grn.status !== 'draft') throw new AppError('INVALID_STATE', 'Only a draft GRN can be cancelled');
      await repos.tx.setAuditComment(input.reason);
      await repos.grns.cancel(id, input.expectedVersion, input.reason);
      return this.detail(repos, id);
    });
  }

  /** POST /pos/:id/rating — once per PO, after it is fully received (FR-013). */
  rate(ctx: RequestContext, poId: string, input: PoRatingInput): Promise<void> {
    if (
      !ctx.permissions.has(PERMISSIONS_002.PO_CREATE) &&
      !ctx.permissions.has(PERMISSIONS_002.GRN_CREATE)
    ) {
      throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.PO_CREATE}`);
    }
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(poId, { lock: true });
      if (po.status !== 'fully_received' && po.status !== 'closed') {
        throw new AppError('INVALID_STATE', 'A supplier is rated once the order is fully received');
      }
      await repos.ratings.insert(poId, po.supplierId, input);
    });
  }
}
