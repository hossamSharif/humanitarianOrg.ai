// Payment voucher generation from an approved payment request (contracts/posting-rules.md §1–§2,
// research D5). Pure: no I/O; the caller hands in the request, the resolved accounts and the
// rates of the voucher date. A bank money account gives a BPV, a cash box a CPV.
//
// * goods / service / direct payment: Dr the expense account of each charge-to row (budget line ×
//   location × activity) for its gross; Cr each deduction's payable account, the retention
//   payable, the supplier advances recovered, and the money account for the net;
// * supplier advance: Dr supplier advances per charge-to row (dimensions kept, no Actual);
// * retention release: Dr retention payable;
// * staff cash advance: Dr staff advances per row (dimensions kept, no Actual).
//
// Every line is in the payment currency at its rate; base amounts are half-up₂(amount × rate),
// as the database checks them, so a rounding residue in base is posted on a base-currency line
// to the exchange gain/loss account. Errors are values: CURRENCY_MISMATCH (FR-075),
// BUDGET_LINE_UNMAPPED (every unmapped line at once, US12-2), CONTROL_ACCOUNT_MISSING and
// UNBALANCED (a bug).
import { Decimal, parseAmount } from '../money';
import { actualGrantAmount, baseOf, baseTotals, isRoundingResidue } from './balance';
import { baseRate, type RateSnapshot } from './rates';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type PaymentVoucherKind = 'order' | 'advance' | 'retention' | 'direct' | 'staff_advance';

export interface RequestLineInput {
  id: string;
  description: string | null;
  /** payment currency */
  gross: string;
  grantId: string;
  budgetLineId: string;
  locationOfficeId: string | null;
  activityId: string | null;
  poLineId: string | null;
}

export interface DeductionInput {
  payableAccountId: string;
  amount: string;
  description: string;
}

export interface PaymentVoucherInput {
  kind: PaymentVoucherKind;
  baseCurrency: string;
  /** payment currency */
  currency: string;
  gross: string;
  advanceDeduction: string;
  retentionAmount: string;
  net: string;
  lines: readonly RequestLineInput[];
  deductions: readonly DeductionInput[];
  /** rate of the payment currency on the voucher date */
  rate: RateSnapshot;
  /** rate of the grant currency on the voucher date (Actual) */
  grantRate: RateSnapshot;
  moneyAccount: { glAccountId: string; kind: 'bank' | 'cash'; currency: string; name: string };
  /** resolved expense account per budget line (null = unmapped) */
  expenseAccounts: Readonly<Record<string, string | null>>;
  budgetLineCodes: Readonly<Record<string, string>>;
  control: {
    supplierAdvances?: string | null;
    retentionPayable?: string | null;
    staffAdvances?: string | null;
    exchangeGainLoss?: string | null;
  };
  donorId: string | null;
  /** the printed "Contract" column, e.g. "Staff Contract/Admin Expenditures" */
  categoryText: string | null;
  payeeName: string;
}

export interface VoucherDraftLine {
  accountId: string;
  description: string | null;
  currency: string;
  debit: string;
  credit: string;
  rateToBase: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
  baseDebit: string;
  baseCredit: string;
  grantId: string | null;
  budgetLineId: string | null;
  locationOfficeId: string | null;
  activityId: string | null;
  donorId: string | null;
  categoryText: string | null;
  /** expense lines with a budget line only */
  actualGrantAmount: string | null;
  paymentRequestLineId: string | null;
  poLineId: string | null;
  /** the money-account side */
  isMoneySide: boolean;
}

export interface VoucherDraft {
  type: 'BPV' | 'CPV';
  currency: string;
  /** header amount = the money-account side */
  amount: string;
  lines: VoucherDraftLine[];
}

export type GenerationError =
  | { code: 'CURRENCY_MISMATCH'; accountCurrency: string; paymentCurrency: string }
  | { code: 'BUDGET_LINE_UNMAPPED'; budgetLineIds: string[]; codes: string[] }
  | { code: 'CONTROL_ACCOUNT_MISSING'; key: string }
  | { code: 'UNBALANCED'; baseDebit: string; baseCredit: string; difference: string };

const ZERO = '0.00';

interface ChargeRow {
  key: string;
  lines: RequestLineInput[];
  gross: Decimal;
}

/** Groups the request lines into charge-to rows (budget line × location × activity). */
function chargeRows(lines: readonly RequestLineInput[]): ChargeRow[] {
  const rows = new Map<string, ChargeRow>();
  for (const l of lines) {
    if (parseAmount(l.gross).isZero()) continue;
    const key = `${l.budgetLineId}|${l.locationOfficeId ?? ''}|${l.activityId ?? ''}`;
    const row = rows.get(key) ?? { key, lines: [], gross: new Decimal(0) };
    row.lines.push(l);
    row.gross = row.gross.plus(parseAmount(l.gross));
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function generatePaymentVoucher(
  input: PaymentVoucherInput
): Result<VoucherDraft, GenerationError> {
  if (input.moneyAccount.currency !== input.currency) {
    return {
      ok: false,
      error: {
        code: 'CURRENCY_MISMATCH',
        accountCurrency: input.moneyAccount.currency,
        paymentCurrency: input.currency,
      },
    };
  }

  const rate = input.currency === input.baseCurrency ? baseRate(input.rate.rateDate) : input.rate;
  const line = (
    accountId: string,
    side: 'debit' | 'credit',
    amount: string,
    extra: Partial<VoucherDraftLine> = {}
  ): VoucherDraftLine => {
    const debit = side === 'debit' ? amount : ZERO;
    const credit = side === 'credit' ? amount : ZERO;
    return {
      accountId,
      description: null,
      currency: input.currency,
      debit,
      credit,
      rateToBase: rate.rateToBase,
      rateDate: rate.rateDate,
      rateSource: rate.rateSource,
      exchangeRateId: rate.exchangeRateId,
      ...baseOf({ debit, credit, rateToBase: rate.rateToBase }),
      grantId: null,
      budgetLineId: null,
      locationOfficeId: null,
      activityId: null,
      donorId: null,
      categoryText: null,
      actualGrantAmount: null,
      paymentRequestLineId: null,
      poLineId: null,
      isMoneySide: false,
      ...extra,
    };
  };
  const control = (key: keyof PaymentVoucherInput['control']): string | GenerationError => {
    const id = input.control[key];
    return id ? id : { code: 'CONTROL_ACCOUNT_MISSING', key };
  };

  const rows = chargeRows(input.lines);
  const dims = (row: ChargeRow) => {
    const first = row.lines[0]!;
    return {
      description: row.lines.length === 1 ? first.description : null,
      grantId: first.grantId,
      budgetLineId: first.budgetLineId,
      locationOfficeId: first.locationOfficeId,
      activityId: first.activityId,
      donorId: input.donorId,
      categoryText: input.categoryText,
      paymentRequestLineId: row.lines.length === 1 ? first.id : null,
      poLineId: row.lines.length === 1 ? first.poLineId : null,
    };
  };

  const lines: VoucherDraftLine[] = [];
  const expense = input.kind === 'order' || input.kind === 'direct';

  if (expense) {
    const unmapped = rows.filter((r) => !input.expenseAccounts[r.lines[0]!.budgetLineId]);
    if (unmapped.length > 0) {
      const ids = [...new Set(unmapped.map((r) => r.lines[0]!.budgetLineId))];
      return {
        ok: false,
        error: {
          code: 'BUDGET_LINE_UNMAPPED',
          budgetLineIds: ids,
          codes: ids.map((id) => input.budgetLineCodes[id] ?? id),
        },
      };
    }
    for (const r of rows) {
      const amount = r.gross.toFixed(2);
      lines.push(
        line(input.expenseAccounts[r.lines[0]!.budgetLineId]!, 'debit', amount, {
          ...dims(r),
          actualGrantAmount: actualGrantAmount({
            debit: amount,
            credit: ZERO,
            rateToBase: rate.rateToBase,
            grantRateToBase: input.grantRate.rateToBase,
          }),
        })
      );
    }
  } else if (input.kind === 'retention') {
    const account = control('retentionPayable');
    if (typeof account !== 'string') return { ok: false, error: account };
    lines.push(
      line(account, 'debit', parseAmount(input.gross).toFixed(2), {
        description: 'Retention release',
      })
    );
  } else {
    // supplier or staff advance: an asset, dimensions kept, no Actual
    const account = control(input.kind === 'advance' ? 'supplierAdvances' : 'staffAdvances');
    if (typeof account !== 'string') return { ok: false, error: account };
    for (const r of rows) lines.push(line(account, 'debit', r.gross.toFixed(2), dims(r)));
  }

  // credits: deductions (one line per payable account), retention, advance recovered, money
  if (expense) {
    const byAccount = new Map<string, { amount: Decimal; description: string }>();
    for (const d of input.deductions) {
      if (parseAmount(d.amount).isZero()) continue;
      const cur = byAccount.get(d.payableAccountId);
      byAccount.set(d.payableAccountId, {
        amount: (cur?.amount ?? new Decimal(0)).plus(parseAmount(d.amount)),
        description: cur ? `${cur.description}, ${d.description}` : d.description,
      });
    }
    for (const [accountId, d] of byAccount) {
      lines.push(line(accountId, 'credit', d.amount.toFixed(2), { description: d.description }));
    }
    if (parseAmount(input.retentionAmount).gt(0)) {
      const account = control('retentionPayable');
      if (typeof account !== 'string') return { ok: false, error: account };
      lines.push(
        line(account, 'credit', parseAmount(input.retentionAmount).toFixed(2), {
          description: 'Retention withheld',
        })
      );
    }
    if (parseAmount(input.advanceDeduction).gt(0)) {
      const account = control('supplierAdvances');
      if (typeof account !== 'string') return { ok: false, error: account };
      lines.push(
        line(account, 'credit', parseAmount(input.advanceDeduction).toFixed(2), {
          description: 'Advance recovered',
        })
      );
    }
  }
  const net = parseAmount(input.net).toFixed(2);
  if (parseAmount(net).gt(0)) {
    lines.push(
      line(input.moneyAccount.glAccountId, 'credit', net, {
        description: input.moneyAccount.name,
        isMoneySide: true,
      })
    );
  }

  // rounding residue in base: a base-currency line on exchange gain/loss
  let totals = baseTotals(lines);
  if (!parseAmount(totals.difference).isZero()) {
    if (!isRoundingResidue(totals.difference, lines.length)) {
      return { ok: false, error: { code: 'UNBALANCED', ...totals } };
    }
    const account = control('exchangeGainLoss');
    if (typeof account !== 'string') return { ok: false, error: account };
    const diff = parseAmount(totals.difference);
    const base = baseRate(input.rate.rateDate);
    const amount = diff.abs().toFixed(2);
    lines.push({
      ...line(account, diff.gt(0) ? 'credit' : 'debit', amount, { description: 'Rounding' }),
      currency: input.baseCurrency,
      rateToBase: base.rateToBase,
      rateDate: base.rateDate,
      rateSource: base.rateSource,
      exchangeRateId: null,
      baseDebit: diff.gt(0) ? ZERO : amount,
      baseCredit: diff.gt(0) ? amount : ZERO,
    });
    totals = baseTotals(lines);
    if (!parseAmount(totals.difference).isZero()) {
      return { ok: false, error: { code: 'UNBALANCED', ...totals } };
    }
  }

  return {
    ok: true,
    value: {
      type: input.moneyAccount.kind === 'bank' ? 'BPV' : 'CPV',
      currency: input.currency,
      amount: net,
      lines,
    },
  };
}

/**
 * The reversing lines (US13-6): every line mirrored — debit ↔ credit, Actual negated — at the
 * original rates, so the reversal restores exactly what the posting moved.
 */
export function mirrorLines<
  L extends {
    debit: string;
    credit: string;
    baseDebit: string;
    baseCredit: string;
    actualGrantAmount: string | null;
  },
>(lines: readonly L[]): L[] {
  return lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
    baseDebit: l.baseCredit,
    baseCredit: l.baseDebit,
    actualGrantAmount:
      l.actualGrantAmount === null ? null : parseAmount(l.actualGrantAmount).negated().toFixed(2),
  }));
}

/** The generator named in contracts/posting-rules.md; payment vouchers are its first input. */
export const generateVoucher = generatePaymentVoucher;
