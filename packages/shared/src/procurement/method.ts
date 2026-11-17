// Procurement method resolution (research D4, FR-002, FR-003). Bands are `(min, max]` in the
// DoA reference currency; null min = 0 (the lowest band also admits 0), null max = no limit.
// The required method is the stricter of the tenant band and the grant band for the estimated
// value, and the minimum number of quotations is the larger of both minimums for that method.
import { Decimal, parseAmount } from '../money';
import { halfUp2 } from '../accounting/rates';

export const PROCUREMENT_METHODS = ['direct', 'rfq', 'tender'] as const;
export type ProcurementMethod = (typeof PROCUREMENT_METHODS)[number];

/** direct 1 < rfq 2 < tender 3 */
export const METHOD_RANK: Record<ProcurementMethod, number> = { direct: 1, rfq: 2, tender: 3 };

export interface MethodBand {
  method: ProcurementMethod;
  minAmount: string | null;
  maxAmount: string | null;
  minQuotations: number;
}

/** `[min, max]` of a gap or an overlap; null max = no limit. */
export type BandRange = [string | null, string | null];

export interface BandIssues {
  gaps: BandRange[];
  overlaps: BandRange[];
}

const ZERO = new Decimal(0);
const lower = (b: Pick<MethodBand, 'minAmount'>) =>
  b.minAmount === null ? ZERO : parseAmount(b.minAmount);
const upper = (b: Pick<MethodBand, 'maxAmount'>) =>
  b.maxAmount === null ? null : parseAmount(b.maxAmount);
const text = (d: Decimal | null) => (d === null ? null : d.toFixed(2));

/**
 * Gaps and overlaps of one band set. A valid set starts at 0, is contiguous and
 * non-overlapping, and ends open: a set that does not start at 0 has the gap `[0, first min]`,
 * a set with a closed top has the gap `[last max, null]`, an empty set the gap `[0, null]`.
 */
export function validateBands(bands: readonly MethodBand[]): BandIssues {
  const gaps: BandRange[] = [];
  const overlaps: BandRange[] = [];
  if (bands.length === 0) return { gaps: [['0.00', null]], overlaps };

  const sorted = [...bands].sort((a, b) => {
    const byMin = lower(a).comparedTo(lower(b));
    if (byMin !== 0) return byMin;
    const ua = upper(a);
    const ub = upper(b);
    if (ua === null) return ub === null ? 0 : 1;
    return ub === null ? -1 : ua.comparedTo(ub);
  });

  const first = lower(sorted[0]!);
  if (!first.isZero()) gaps.push(['0.00', text(first)]);

  // the furthest upper bound covered so far (null = open)
  let reach: Decimal | null = upper(sorted[0]!);
  for (const band of sorted.slice(1)) {
    const min = lower(band);
    const max = upper(band);
    if (reach === null) {
      overlaps.push([text(min), text(max)]);
      continue;
    }
    if (min.lt(reach)) {
      overlaps.push([text(min), text(max === null || max.gt(reach) ? reach : max)]);
    } else if (min.gt(reach)) {
      gaps.push([text(reach), text(min)]);
    }
    if (max === null || max.gt(reach)) reach = max;
  }
  if (reach !== null) gaps.push([text(reach), null]);
  return { gaps, overlaps };
}

export function bandsAreValid(bands: readonly MethodBand[]): boolean {
  const { gaps, overlaps } = validateBands(bands);
  return gaps.length === 0 && overlaps.length === 0;
}

/** `min < value ≤ max`; the lowest band (min 0) also admits 0. */
export function bandContainsValue(band: MethodBand, value: string): boolean {
  const v = parseAmount(value);
  const min = lower(band);
  const max = upper(band);
  const aboveMin = min.isZero() ? v.gte(ZERO) : v.gt(min);
  return aboveMin && (max === null || v.lte(max));
}

export function findBand(bands: readonly MethodBand[], value: string): MethodBand | null {
  return bands.find((b) => bandContainsValue(b, value)) ?? null;
}

/** A selected PR line with the rates its PR locked at submission (001 R7). */
export interface MethodLine {
  lineTotal: string;
  /** line currency → base */
  rateToBase: string;
  /** DoA reference currency → base, from the line's PR */
  doaRateToBase: string;
}

export interface ResolvedMethod {
  /** in the DoA reference currency, 2 decimals */
  estimatedValue: string;
  requiredMethod: ProcurementMethod;
  minQuotations: number;
  bandsUsed: { tenant: MethodBand; grant: MethodBand | null };
}

/** Σ line_total × rate_to_base ÷ doa_rate_to_base, rounded half-up once at the end. */
export function estimatedValue(lines: readonly MethodLine[]): string {
  let total = ZERO;
  for (const line of lines) {
    const doaRate = parseAmount(line.doaRateToBase);
    if (doaRate.lte(0)) throw new RangeError('Exchange rates must be greater than zero');
    total = total.plus(
      parseAmount(line.lineTotal).times(parseAmount(line.rateToBase)).dividedBy(doaRate)
    );
  }
  return halfUp2(total);
}

export function resolveProcurementMethod(input: {
  lines: readonly MethodLine[];
  tenantBands: readonly MethodBand[];
  grantBands?: readonly MethodBand[];
}): ResolvedMethod {
  const value = estimatedValue(input.lines);
  const tenant = findBand(input.tenantBands, value);
  if (!tenant) throw new RangeError(`No procurement band contains ${value}`);
  const grant = input.grantBands?.length ? findBand(input.grantBands, value) : null;

  const requiredMethod =
    grant && METHOD_RANK[grant.method] > METHOD_RANK[tenant.method] ? grant.method : tenant.method;
  const minimumFor = (bands: readonly MethodBand[] | undefined, own: MethodBand | null) => {
    if (own && own.method === requiredMethod) return own.minQuotations;
    // the set's band for the required method, when the value fell in a band of another method
    const sameMethod = (bands ?? []).filter((b) => b.method === requiredMethod);
    return sameMethod.length ? Math.max(...sameMethod.map((b) => b.minQuotations)) : 0;
  };
  const minQuotations = Math.max(
    minimumFor(input.tenantBands, tenant),
    minimumFor(input.grantBands, grant),
    1
  );

  return { estimatedValue: value, requiredMethod, minQuotations, bandsUsed: { tenant, grant } };
}
