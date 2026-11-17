// Quotation analysis, committee and award (002 US5, contracts/rest-api.md "Analysis and award";
// research R22). Bodies are `.strict()`: price points, totals, ranks and the highest offer are
// computed by the service (scoring.ts) and never accepted.
import { z } from 'zod';
import type { BidAnalysisStatus } from '../doc-types';
import type { DocStepView } from './doc-actions';
import { expectedVersion, isoDate, listQuery, reason, uuid } from './common';
import { INVITATION_CHANNELS, type CriterionKind, type CriterionStage } from './sourcing';

export const COMMITTEE_FUNCTIONS = ['procurement', 'finance', 'program', 'other'] as const;
export type CommitteeFunction = (typeof COMMITTEE_FUNCTIONS)[number];

/** POST /bid-analyses */
export const createAnalysisBody = z.object({ sourcingEventId: uuid }).strict();
export type CreateAnalysisInput = z.input<typeof createAnalysisBody>;

export const analysisListQuery = listQuery.extend({
  status: z
    .enum([
      'draft',
      'scoring',
      'signing',
      'pending_approval',
      'approved',
      'returned',
      'rejected',
      'cancelled',
    ])
    .optional(),
});
export type AnalysisListQuery = z.infer<typeof analysisListQuery>;

/** PUT /bid-analyses/:id/committee — the whole committee; a declared member leaves only by replacement. */
export const committeeBody = z
  .object({
    expectedVersion,
    members: z
      .array(
        z
          .object({
            userId: uuid,
            function: z.enum(COMMITTEE_FUNCTIONS),
            /** the declared member this one replaces */
            replacesUserId: uuid.optional(),
          })
          .strict()
      )
      .min(1)
      .max(15),
  })
  .strict();
export type CommitteeInput = z.input<typeof committeeBody>;

/** POST /bid-analyses/:id/declaration — the caller's conflict-of-interest declaration (once). */
export const declarationBody = z
  .object({
    hasConflict: z.boolean(),
    conflictSupplierIds: z.array(uuid).max(50).default([]),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((d) => !d.hasConflict || d.conflictSupplierIds.length > 0, {
    message: 'Name the suppliers of the conflict',
    path: ['conflictSupplierIds'],
  });
export type DeclarationInput = z.input<typeof declarationBody>;

/** PUT /bid-analyses/:id/scores — the caller's scores, 1–5, on non-price criteria only. */
export const scoresBody = z
  .object({
    scores: z
      .array(
        z
          .object({ offerId: uuid, criterionId: uuid, score: z.number().int().min(1).max(5) })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();
export type ScoresInput = z.input<typeof scoresBody>;

/** POST /bid-analyses/:id/disqualify */
export const disqualifyBody = z.object({ offerId: uuid, reason }).strict();
export type DisqualifyInput = z.input<typeof disqualifyBody>;

/** PUT /bid-analyses/:id/recommendation — a whole award (offerId) or a split one (lines). */
export const recommendationBody = z
  .object({
    expectedVersion,
    offerId: uuid.optional(),
    lines: z
      .array(z.object({ sourcingLineId: uuid, offerId: uuid }).strict())
      .max(200)
      .optional(),
    justification: z.string().trim().max(4000).optional(),
    justificationCriterionIds: z.array(uuid).max(30).default([]),
  })
  .strict()
  .refine((r) => (r.offerId === undefined) !== (r.lines === undefined), {
    message: 'Recommend one offer or one offer per line',
    path: ['offerId'],
  });
export type RecommendationInput = z.input<typeof recommendationBody>;

/** POST /bid-analyses/:id/sign */
export const analysisSignBody = z.object({ expectedVersion }).strict();
export type AnalysisSignInput = z.input<typeof analysisSignBody>;

/** POST /bid-analyses/:id/notices — unsuccessful supplier notices (FR-031). */
export const noticesBody = z
  .object({
    notices: z
      .array(
        z
          .object({
            offerId: uuid,
            notifiedOn: isoDate,
            channel: z.enum(INVITATION_CHANNELS),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
export type NoticesInput = z.input<typeof noticesBody>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface ComparisonRate {
  currency: string;
  rateToBase: string;
  rateDate: string;
  source: string;
  exchangeRateId: string | null;
}

export interface CommitteeMemberView {
  id: string;
  userId: string;
  nameAr: string;
  nameEn: string;
  function: CommitteeFunction;
  declaredAt: string | null;
  hasConflict: boolean | null;
  conflictSupplierIds: string[];
  excluded: boolean;
  replacedById: string | null;
  signedAt: string | null;
}

export interface AnalysisResultView {
  offerId: string;
  sourcingLineId: string | null;
  disqualified: boolean;
  disqualificationReason: string | null;
  /** null while the caller may not see prices (undeclared or conflicted member) */
  totalOfferCurrency: string | null;
  totalEventCurrency: string | null;
  pricePoints: string | null;
  criteriaPoints: Record<string, string>;
  technicalPass: boolean | null;
  weightedTotal: string | null;
  rank: number | null;
}

export interface AnalysisOfferView {
  offerId: string;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  status: string;
  currency: string | null;
  disqualificationReason: string | null;
}

export interface AnalysisCriterionView {
  id: string;
  stage: CriterionStage;
  kind: CriterionKind;
  code: string;
  nameAr: string;
  nameEn: string;
  weightPct: string | null;
  isPrice: boolean;
}

export interface AwardLineView {
  sourcingLineId: string;
  lineNo: number;
  description: string | null;
  offerId: string;
  supplierId: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  amount: string;
}

export type AnalysisAction =
  'committee' | 'declare' | 'score' | 'disqualify' | 'recommend' | 'sign' | 'submit' | 'notices';

export interface BidAnalysisSummary {
  id: string;
  number: string | null;
  status: BidAnalysisStatus;
  sourcingEventId: string;
  eventNumber: string | null;
  eventTitle: string;
  awardedAmount: string | null;
  eventCurrency: string;
  createdAt: string;
}

export interface BidAnalysisDetail extends BidAnalysisSummary {
  version: number;
  officeId: string;
  createdBy: string;
  splitAwardAllowed: boolean;
  requiredMinQuotations: number;
  validOfferCount: number;
  /** an approved fewer-quotations waiver covers the event */
  waiverId: string | null;
  comparisonRates: ComparisonRate[];
  /** the caller may see prices (not an undeclared or conflicted member) */
  pricesVisible: boolean;
  committeeMinSize: number;
  eligibleMemberCount: number;
  criteria: AnalysisCriterionView[];
  lines: { id: string; lineNo: number; description: string | null; quantity: string }[];
  offers: AnalysisOfferView[];
  committee: CommitteeMemberView[];
  /** the caller's own scores */
  myScores: { offerId: string; criterionId: string; score: number }[];
  results: AnalysisResultView[];
  lineResults: AnalysisResultView[];
  highestOfferId: string | null;
  recommendedOfferId: string | null;
  justification: string | null;
  justificationCriterionIds: string[];
  awardLines: AwardLineView[];
  awardedAmountDoa: string | null;
  doaCurrency: string | null;
  frozenAt: string | null;
  notices: { offerId: string; notifiedOn: string | null; channel: string | null }[];
  steps: DocStepView[];
  availableActions: string[];
}
