// Quotation analysis scoring (research R22, FR-023…FR-028). Pure and decimal.js-based; the
// analysis service feeds it the opened offers, the committee's scores and the comparison rates
// at the opening date, and stores the result as the analysis snapshot. Price points are always
// computed here, never entered.
//
// * An essential criterion failed (or a manual disqualification) disqualifies the offer, with
//   the reason (FR-025). Without split award, an offer missing a line is non-compliant.
// * Price is compared on totals converted to the event currency (FR-023).
// * Price points = weight × lowest ÷ price, rounded half-up to 2 dp.
// * Other criteria = weight × average(member scores) ÷ 5, the average kept exact and the points
//   rounded to 2 dp. The weighted total is the sum of the rounded points.
// * Split award: price points per line (lowest line price), non-price points per supplier; each
//   line ranks its offers. Two-stage (tender): only technically compliant offers get financial
//   points.
import { Decimal, parseAmount } from '../money';
import { halfUp2 } from '../accounting/rates';

export interface ScoringCriterion {
  id: string;
  code: string;
  stage: 'single' | 'technical' | 'financial';
  kind: 'essential' | 'weighted';
  weightPct: string | null;
  isPrice: boolean;
}

export interface ScoringOffer {
  offerId: string;
  currency: string;
  /** offer currency → base; the event currency's rate is `eventRateToBase` */
  rateToBase: string;
  /** criterion id → result; a missing entry is "not checked" (not a fail) */
  essential: Readonly<Record<string, 'pass' | 'fail' | undefined>>;
  lines: readonly { sourcingLineId: string; lineTotal: string }[];
  /** set by the committee (POST /bid-analyses/:id/disqualify) */
  disqualificationReason?: string | null;
}

export interface MemberScore {
  offerId: string;
  criterionId: string;
  /** 1–5 */
  score: number;
}

export interface ScoringInput {
  criteria: readonly ScoringCriterion[];
  offers: readonly ScoringOffer[];
  scores: readonly MemberScore[];
  /** every sourcing line of the event */
  lineIds: readonly string[];
  eventRateToBase: string;
  splitAward: boolean;
  /** tender two-stage evaluation */
  twoStage?: boolean;
}

export interface OfferResult {
  offerId: string;
  /** null for the whole offer, else one line of a split comparison */
  sourcingLineId: string | null;
  disqualified: boolean;
  disqualificationReason: string | null;
  totalOfferCurrency: string;
  totalEventCurrency: string;
  pricePoints: string;
  /** criterion id → rounded points (non-price) */
  criteriaPoints: Record<string, string>;
  technicalPass: boolean | null;
  weightedTotal: string;
  /** 1 = best; null when disqualified or not competing on the line */
  rank: number | null;
}

export interface ScoringResult {
  offers: OfferResult[];
  /** per line, split award only */
  lines: OfferResult[];
  /** rank 1 of the whole comparison (null when every offer is disqualified) */
  highestOfferId: string | null;
  /** sourcing line id → rank-1 offer (split award) */
  highestPerLine: Record<string, string>;
}

const ZERO = new Decimal(0);

/** weight × lowest ÷ price; a zero price takes the full weight. */
export function pricePoints(weightPct: string, lowest: string, price: string): string {
  const p = parseAmount(price);
  const weight = parseAmount(weightPct);
  if (p.isZero()) return halfUp2(weight);
  return halfUp2(weight.times(parseAmount(lowest)).dividedBy(p));
}

/** weight × average ÷ 5; no score = 0. */
export function criterionPoints(weightPct: string, scores: readonly number[]): string {
  if (scores.length === 0) return '0.00';
  const avg = scores.reduce((s, x) => s.plus(x), ZERO).dividedBy(scores.length);
  return halfUp2(parseAmount(weightPct).times(avg).dividedBy(5));
}

function toEvent(amount: Decimal, offerRate: string, eventRate: string): Decimal {
  return amount.times(parseAmount(offerRate)).dividedBy(parseAmount(eventRate));
}

/** Ranks by weighted total (desc), then by price (asc); disqualified rows get null. */
function rank(rows: OfferResult[]): void {
  const competing = rows
    .filter((r) => !r.disqualified)
    .sort((a, b) => {
      const byTotal = parseAmount(b.weightedTotal).comparedTo(parseAmount(a.weightedTotal));
      if (byTotal !== 0) return byTotal;
      return parseAmount(a.totalEventCurrency).comparedTo(parseAmount(b.totalEventCurrency));
    });
  competing.forEach((r, i) => {
    r.rank = i + 1;
  });
}

export function scoreAnalysis(input: ScoringInput): ScoringResult {
  const weighted = input.criteria.filter((c) => c.kind === 'weighted' && c.weightPct !== null);
  const essentials = input.criteria.filter((c) => c.kind === 'essential');
  const priceCriteria = weighted.filter((c) => c.isPrice);
  const otherCriteria = weighted.filter((c) => !c.isPrice);
  const technical = new Set(input.twoStage ? ['technical'] : []);

  const scoresOf = (offerId: string, criterionId: string) =>
    input.scores
      .filter((s) => s.offerId === offerId && s.criterionId === criterionId)
      .map((s) => s.score);

  // --- per offer: compliance, totals, non-price points ---------------------------------------
  const base = input.offers.map((offer) => {
    let reason = offer.disqualificationReason?.trim() || null;
    if (!reason) {
      const failed = essentials.find((c) => offer.essential[c.id] === 'fail');
      if (failed) reason = `essential:${failed.code}`;
    }
    const priced = new Set(offer.lines.map((l) => l.sourcingLineId));
    if (!reason && !input.splitAward && input.lineIds.some((id) => !priced.has(id))) {
      reason = 'missing_lines';
    }
    const total = offer.lines.reduce((s, l) => s.plus(parseAmount(l.lineTotal)), ZERO);
    const totalEvent = toEvent(total, offer.rateToBase, input.eventRateToBase);
    const criteriaPoints: Record<string, string> = {};
    for (const c of otherCriteria) {
      criteriaPoints[c.id] = criterionPoints(c.weightPct!, scoresOf(offer.offerId, c.id));
    }
    const technicalPoints = otherCriteria
      .filter((c) => technical.has(c.stage))
      .reduce((s, c) => s.plus(parseAmount(criteriaPoints[c.id]!)), ZERO);
    return {
      offer,
      reason,
      total,
      totalEvent,
      criteriaPoints,
      // two-stage: compliant offers with technical points pass to the financial stage
      technicalPass: input.twoStage ? reason === null && technicalPoints.gt(0) : null,
    };
  });

  const eligibleForPrice = (b: (typeof base)[number]) =>
    b.reason === null && (b.technicalPass === null || b.technicalPass);
  const nonPriceSum = (b: (typeof base)[number]) =>
    Object.values(b.criteriaPoints).reduce((s, p) => s.plus(parseAmount(p)), ZERO);

  // --- whole-offer comparison ----------------------------------------------------------------
  const priced = base.filter(eligibleForPrice);
  const lowest = priced.length
    ? priced.reduce((m, b) => (b.totalEvent.lt(m) ? b.totalEvent : m), priced[0]!.totalEvent)
    : null;

  const offers: OfferResult[] = base.map((b) => {
    let price = ZERO;
    if (eligibleForPrice(b) && lowest !== null) {
      for (const c of priceCriteria) {
        price = price.plus(pricePoints(c.weightPct!, lowest.toFixed(2), b.totalEvent.toFixed(2)));
      }
    }
    return {
      offerId: b.offer.offerId,
      sourcingLineId: null,
      disqualified: b.reason !== null || b.technicalPass === false,
      disqualificationReason: b.reason ?? (b.technicalPass === false ? 'technical_fail' : null),
      totalOfferCurrency: halfUp2(b.total),
      totalEventCurrency: halfUp2(b.totalEvent),
      pricePoints: halfUp2(price),
      criteriaPoints: b.criteriaPoints,
      technicalPass: b.technicalPass,
      weightedTotal: halfUp2(price.plus(nonPriceSum(b))),
      rank: null,
    };
  });
  rank(offers);

  // --- per line (split award) ----------------------------------------------------------------
  const lines: OfferResult[] = [];
  const highestPerLine: Record<string, string> = {};
  if (input.splitAward) {
    for (const lineId of input.lineIds) {
      const rows = base
        .map((b) => {
          const line = b.offer.lines.find((l) => l.sourcingLineId === lineId);
          return line
            ? {
                b,
                amount: parseAmount(line.lineTotal),
                event: toEvent(
                  parseAmount(line.lineTotal),
                  b.offer.rateToBase,
                  input.eventRateToBase
                ),
              }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const competing = rows.filter((r) => eligibleForPrice(r.b));
      const lineLowest = competing.length
        ? competing.reduce((m, r) => (r.event.lt(m) ? r.event : m), competing[0]!.event)
        : null;
      const lineRows: OfferResult[] = rows.map((r) => {
        let price = ZERO;
        if (eligibleForPrice(r.b) && lineLowest !== null) {
          for (const c of priceCriteria) {
            price = price.plus(
              pricePoints(c.weightPct!, lineLowest.toFixed(2), r.event.toFixed(2))
            );
          }
        }
        return {
          offerId: r.b.offer.offerId,
          sourcingLineId: lineId,
          disqualified: !eligibleForPrice(r.b),
          disqualificationReason: r.b.reason,
          totalOfferCurrency: halfUp2(r.amount),
          totalEventCurrency: halfUp2(r.event),
          pricePoints: halfUp2(price),
          criteriaPoints: r.b.criteriaPoints,
          technicalPass: r.b.technicalPass,
          weightedTotal: halfUp2(price.plus(nonPriceSum(r.b))),
          rank: null,
        };
      });
      rank(lineRows);
      const best = lineRows.find((r) => r.rank === 1);
      if (best) highestPerLine[lineId] = best.offerId;
      lines.push(...lineRows);
    }
  }

  return {
    offers,
    lines,
    highestOfferId: offers.find((o) => o.rank === 1)?.offerId ?? null,
    highestPerLine,
  };
}
