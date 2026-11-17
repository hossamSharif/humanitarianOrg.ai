// Quotation receipt, opening and sealed terms (002 US4, FR-019…FR-022; research D3). Before the
// deadline only receipts are logged — who and when, never a price or a file. The opening is a
// command checked against the database clock that records the attendees and the late-offer
// decisions and sets opened_at; only then do the sealed tables accept terms and prices, and the
// scanned quotation its upload. The service refuses first (SOURCING_NOT_OPENED); RLS on
// offer_terms / offer_line_price and the storage policy make it structural.
import {
  type DocAttachmentUploadTarget,
  type OfferReceiptInput,
  type OfferScanUploadInput,
  type OfferTermsInput,
  type OfferTermsView,
  type OpenSourcingInput,
  type SourcingEventDetail,
  type SourcingKind,
} from '@ngo/shared';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { DocAttachmentService } from './doc-attachment.service';
import {
  SourcingService,
  defaultSourcingDeps,
  docTypeOf,
  type SourcingRepos,
  type SourcingServiceDeps,
} from './sourcing.service';

/** Attendees an opening needs (FR-020, FR-046). */
export const MIN_OPENING_ATTENDEES: Record<SourcingKind, number> = { rfq: 2, tender: 3 };

const BEFORE_OPENING = new Set(['issued', 'closed']);
/** Terms and prices may be entered from the opening until the freeze (trigger OFFER_FROZEN). */
const TERMS_STATUSES = new Set(['opened', 'evaluated']);

function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

export class OpeningService {
  private readonly sourcing: SourcingService;

  constructor(
    private readonly kind: SourcingKind = 'rfq',
    private readonly deps: SourcingServiceDeps = defaultSourcingDeps,
    private readonly attachments: (
      ctx: RequestContext
    ) => DocAttachmentService = DocAttachmentService.forContext
  ) {
    this.sourcing = new SourcingService(kind, deps);
  }

  private get docType() {
    return docTypeOf(this.kind);
  }

  // --- receipts ------------------------------------------------------------------------------

  /**
   * POST /rfqs/:id/offers — a receipt only (supplier, time, receiver). A corrected receipt
   * before the deadline replaces the supplier's earlier one; after the deadline it is logged
   * as late and the earlier one stands (US4-4).
   */
  logReceipt(
    ctx: RequestContext,
    eventId: string,
    input: OfferReceiptInput
  ): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(eventId, this.kind);
      if (!BEFORE_OPENING.has(current.status)) {
        throw new AppError('INVALID_STATE', 'Receipts are logged between issue and opening');
      }
      const event = await repos.events.get(eventId, this.kind);
      if (!(await repos.offers.isMember(input.receivedById))) {
        throw new AppError('VALIDATION_ERROR', 'The receiver is not a member', [
          { field: 'receivedById', message: 'invalid_reference' },
        ]);
      }
      if (this.kind === 'rfq') {
        const invited = await repos.invitations.list(eventId);
        if (!invited.some((i) => i.supplierId === input.supplierId)) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Only an invited supplier can submit a quotation',
            [{ field: 'supplierId', message: 'not_invited' }]
          );
        }
      }
      const late = Date.parse(input.receivedAt) > Date.parse(event.submissionDeadline!);
      const previous = late ? null : await repos.offers.currentValid(eventId, input.supplierId);
      if (previous) await repos.offers.markReplaced(previous.id);
      await repos.offers.insert({
        eventId,
        supplierId: input.supplierId,
        receivedAt: input.receivedAt,
        receivedById: input.receivedById,
        replacesId: previous?.id ?? null,
      });
      return this.sourcing.detail(repos, eventId);
    });
  }

  // --- opening -------------------------------------------------------------------------------

  /**
   * POST /rfqs/:id/open — after the deadline by the database clock, with the attendees and the
   * late offers accepted with a reason (RFQ only). Sets opened_at; fewer valid offers than the
   * minimum then show as needing a waiver or a re-issue (FR-022).
   */
  open(
    ctx: RequestContext,
    eventId: string,
    input: OpenSourcingInput
  ): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(eventId, this.kind);
      assertVersion(current, input.expectedVersion);
      if (!BEFORE_OPENING.has(current.status)) {
        throw new AppError('INVALID_STATE', `A ${current.status} event cannot be opened`);
      }
      const event = await repos.events.get(eventId, this.kind);
      const now = await repos.openings.now();
      if (now < new Date(event.submissionDeadline!)) {
        throw new AppError('DEADLINE_NOT_PASSED', 'The submission deadline has not passed', {
          deadline: event.submissionDeadline!,
          now: now.toISOString(),
        });
      }

      const minimum = MIN_OPENING_ATTENDEES[this.kind];
      if (input.attendees.length < minimum) {
        throw new AppError('TOO_FEW_ATTENDEES', `The opening needs at least ${minimum} attendees`);
      }
      const userIds = input.attendees.flatMap((a) => (a.userId ? [a.userId] : []));
      if (new Set(userIds).size !== userIds.length) {
        throw new AppError('VALIDATION_ERROR', 'An attendee is listed twice', [
          { field: 'attendees', message: 'duplicate' },
        ]);
      }
      for (const userId of userIds) {
        if (!(await repos.offers.isMember(userId))) {
          throw new AppError('VALIDATION_ERROR', 'An attendee is not a member', [
            { field: 'attendees', message: 'invalid_reference' },
          ]);
        }
      }

      const acceptLate = input.acceptLate ?? [];
      if (acceptLate.length && this.kind !== 'rfq') {
        throw new AppError('OFFER_LATE', 'Late tender bids cannot be accepted');
      }
      for (const late of acceptLate) {
        if (!(await repos.offers.acceptLate(eventId, late.offerId, late.reason.trim()))) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Only a late offer of this event can be accepted',
            [{ field: 'acceptLate', message: 'not_late' }]
          );
        }
      }

      const record = await repos.openings.insert(eventId, {
        place: input.place ?? null,
        notes: input.notes ?? null,
      });
      await repos.openings.addAttendees(
        record.id,
        input.attendees.map((a) => ({
          userId: a.userId ?? null,
          externalName: a.externalName?.trim() || null,
          function: a.function,
        }))
      );
      await repos.events.markOpened(eventId, record.openedAt);
      return this.sourcing.detail(repos, eventId);
    });
  }

  // --- sealed terms and prices ---------------------------------------------------------------

  private async assertOpened(repos: SourcingRepos, eventId: string) {
    const event = await repos.events.get(eventId, this.kind);
    if (!event.openedAt) {
      throw new AppError('SOURCING_NOT_OPENED', 'Prices and terms are sealed until the opening');
    }
    return event;
  }

  private async assertValidOffer(repos: SourcingRepos, eventId: string, offerId: string) {
    const offer = await repos.offers.get(eventId, offerId);
    if (offer.status === 'late' || offer.status === 'replaced') {
      throw new AppError('OFFER_LATE', 'This receipt is late or replaced and takes no terms');
    }
    if (offer.status !== 'logged' && offer.status !== 'late_accepted') {
      throw new AppError('INVALID_STATE', `A ${offer.status} offer takes no terms`);
    }
    return offer;
  }

  /** PUT /rfqs/:id/offers/:offerId/terms — after the opening only. */
  enterTerms(
    ctx: RequestContext,
    eventId: string,
    offerId: string,
    input: OfferTermsInput
  ): Promise<OfferTermsView> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(eventId, this.kind);
      await this.assertOpened(repos, eventId);
      if (!TERMS_STATUSES.has(current.status)) {
        throw new AppError('INVALID_STATE', `Terms cannot change on a ${current.status} event`);
      }
      await this.assertValidOffer(repos, eventId, offerId);

      const lineIds = new Set((await repos.lines.list(eventId)).map((l) => l.id));
      if (input.linePrices.some((p) => !lineIds.has(p.sourcingLineId))) {
        throw new AppError('VALIDATION_ERROR', 'A price is for a line of another event', [
          { field: 'linePrices', message: 'invalid_reference' },
        ]);
      }
      const essentials = new Set(
        (await repos.criteria.list(eventId)).filter((c) => c.kind === 'essential').map((c) => c.id)
      );
      const compliance = input.essentialCompliance ?? {};
      if (Object.keys(compliance).some((id) => !essentials.has(id))) {
        throw new AppError('VALIDATION_ERROR', 'Compliance is recorded per essential criterion', [
          { field: 'essentialCompliance', message: 'invalid_reference' },
        ]);
      }

      await repos.terms.upsert(eventId, offerId, {
        currency: input.currency,
        deliveryDays: input.deliveryDays ?? null,
        validityDays: input.validityDays ?? null,
        paymentTerms: input.paymentTerms ?? null,
        essentialCompliance: Object.fromEntries(
          Object.entries(compliance).map(([id, c]) => [
            id,
            { result: c.result, note: c.note ?? null },
          ])
        ),
      });
      await repos.prices.upsertMany(
        eventId,
        offerId,
        input.linePrices.map((p) => ({
          sourcingLineId: p.sourcingLineId,
          unitPrice: p.unitPrice,
          quantity: p.quantity ?? null,
        }))
      );
      const saved = (await repos.terms.list(eventId)).find((t) => t.offerId === offerId);
      if (!saved) throw new AppError('FORBIDDEN', 'The offer prices are not visible to you');
      return saved;
    });
  }

  /** GET /rfqs/:id/offer-terms — every offer's terms and prices the caller may see (RLS). */
  listTerms(ctx: RequestContext, eventId: string): Promise<OfferTermsView[]> {
    return this.deps.run(ctx, async (repos) => {
      await repos.events.get(eventId, this.kind);
      return repos.terms.list(eventId);
    });
  }

  // --- scanned quotation ---------------------------------------------------------------------

  /** POST /rfqs/:id/offers/:offerId/scan-upload-url — 409 SOURCING_NOT_OPENED before the opening. */
  async scanUploadUrl(
    ctx: RequestContext,
    eventId: string,
    offerId: string,
    input: OfferScanUploadInput
  ): Promise<DocAttachmentUploadTarget> {
    await this.deps.run(ctx, async (repos) => {
      await this.assertOpened(repos, eventId);
      await this.assertValidOffer(repos, eventId, offerId);
      if (!(await repos.terms.exists(offerId))) {
        throw new AppError('VALIDATION_ERROR', 'Enter the offer terms before its scan', [
          { field: 'offerId', message: 'terms_required' },
        ]);
      }
    });
    return this.attachments(ctx).createUploadUrl(this.docType, eventId, {
      ...input,
      purpose: 'offer_scan',
    });
  }

  /** POST /rfqs/:id/offers/:offerId/scan/:attId/complete — marks it uploaded and links it. */
  async completeScan(
    ctx: RequestContext,
    eventId: string,
    offerId: string,
    attachmentId: string
  ): Promise<OfferTermsView> {
    await this.attachments(ctx).completeUpload(this.docType, eventId, attachmentId);
    return this.deps.run(ctx, async (repos) => {
      await this.assertOpened(repos, eventId);
      if (!(await repos.terms.setScan(offerId, attachmentId))) {
        throw new AppError('NOT_FOUND', 'Offer terms not found');
      }
      const saved = (await repos.terms.list(eventId)).find((t) => t.offerId === offerId);
      if (!saved) throw new AppError('NOT_FOUND', 'Offer terms not found');
      return saved;
    });
  }

  /** GET /rfqs/:id/offers/:offerId/scan-url — a signed download URL for the linked scan. */
  async scanUrl(ctx: RequestContext, eventId: string, offerId: string) {
    const scanId = await this.deps.run(ctx, async (repos) => {
      await this.assertOpened(repos, eventId);
      const terms = (await repos.terms.list(eventId)).find((t) => t.offerId === offerId);
      if (!terms?.scanAttachmentId) throw new AppError('NOT_FOUND', 'No scan for this offer');
      return terms.scanAttachmentId;
    });
    return this.attachments(ctx).downloadUrl(this.docType, eventId, scanId);
  }
}
