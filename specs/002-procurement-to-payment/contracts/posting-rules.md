# Posting Rules Contract — Voucher Generation and Budget Movements

**Feature**: `002-procurement-to-payment` | Research: [D2, D5, R25–R27](../research.md)

The voucher generator is a pure function in
`packages/shared/src/accounting/generate-voucher.ts`:
`generateVoucher(input): Result<VoucherDraft, GenerationError>`. It does no I/O. Every row below
is a unit-test case. Notation:

- `B` = tenant base currency;
- `T` = transaction (payment) currency;
- `G` = grant currency;
- `r(X)` = rate of X to B on the voucher date (1 if X = B);
- `half-up₂` = round half-up to 2 dp.

## 1. Line amounts

For every line:

- `base_debit = half-up₂(debit × r(T))`, and the same for credit.
- `actual_grant_amount = half-up₂((debit − credit) × r(T) ÷ r(G))`, set only when the account
  type is `expense` and the line has a budget line.
- `commitment_consumed_grant = half-up₂(matched_amount_in_PO_currency × commit_rate_PO ÷ commit_grant_rate)`
  for PO-based expense lines. That is the PO's **locked** rate (D2). Direct payments and
  advances use their own commitment rates.
- Rounding residue: if `Σ base_debit ≠ Σ base_credit` only because of rounding (|diff| ≤ 0.01 ×
  number of lines), the residue is added to the largest line on the bank/cash side. An
  unbalanced result beyond that is `UNBALANCED` (a bug, not a user error).

## 2. Payment voucher from a payment request (BPV if the money account is a bank, CPV if cash)

| Case | Debit | Credit |
|---|---|---|
| **Goods/service payment** | per charge-to row (budget line × location × activity): expense account of the budget line, `gross` share | money account GL: `net` |
| + deductions | — | each deduction's payable account: `amount` |
| + retention withheld | — | retention payable: `retention_amount` |
| + advance clearing (final/partial after an advance) | — | supplier advances: `advance_deduction` |
| **Advance to supplier** (`is_advance`) | supplier advances (dims kept, no Actual) | money account: net |
| **Retention release** | retention payable | money account |
| **Direct payment** (salary, rent …) | expense account per line | money account |
| **Cash advance to staff** | staff advances (dims kept, no Actual) | money account |

Invariants (checked in the generator and again by the DB):

1. `T` = money account currency, else `CURRENCY_MISMATCH` (FR-075).
2. Every expense line resolves an account (`BUDGET_LINE_UNMAPPED` lists all unmapped lines at
   once).
3. Dimensions on expense lines are copied from the request lines and never computed from user
   input.

### Worked samples (unit tests)

**RTHA PO payment.** PO 870,710.00 SDG on budget line 10202, grant in USD, no deductions,
bank SDG:

| No | A/c | Cur | Debit | Credit | Rate | Dr (base) | Cr (base) |
|---|---|---|---|---|---|---|---|
| 1 | 10202 (expense) | SDG | 870,710.00 | | 1.000000 | 870,710.00 | |
| 2 | bank GL | SDG | | 870,710.00 | 1.000000 | | 870,710.00 |

Effects:

- Actual on 10202 = `870,710.00 ÷ r(USD)` in USD.
- PO commitment consumed = `870,710.00 × 1 ÷ commit_grant_rate` (locked at PO approval).
- The difference between the two, if the rates moved, stays visible on the budget line.

**BPV-35** (direct salary). Payee NasrAldin Abdullah Ahmed, cheque 35, Blue Nile Mashreq Bank –
White Nile (SDG), donor ADRA, contract text "Staff Contract/Admin Expenditures", voucher date
24/09/2026:

| No | A/c | Account name | Cur | Donor | Contract | Debit | Credit | Rate |
|---|---|---|---|---|---|---|---|---|
| 1 | 10102 | Field Supervision Officer | SDG | ADRA | Staff Contract/Admin Expenditures | 3,040,800.00 | 0.00 | 1.0000 |
| 2 | 70205 | Blue Nile Mashreq Bank – White Nile | SDG | | | 0.00 | 3,040,800.00 | 1.0000 |

The amount in words is "Three Million Forty Thousand Eight Hundred Sudanese Pounds" (en) plus
the Arabic equivalent. Unlike the paper sample, line 1 is labelled SDG (the currency of its
amount), not USD.

**WHT 5% on services** of 1,000,000 SDG:

- Dr expense 1,000,000;
- Cr WHT payable 50,000;
- Cr bank 950,000.

**Advance 30% then final** on a 1,000,000 PO:

- Advance: Dr supplier advances 300,000 / Cr bank 300,000.
- Final: Dr expense 1,000,000 / Cr supplier advances 300,000 / Cr bank 700,000.
- Total paid on the PO is 1,000,000 (US11-4).

**Foreign-currency payment.** USD bank pays an SDG-denominated PO. This is blocked
(`CURRENCY_MISMATCH`) because the payment currency is SDG. The user must first transfer, or
raise the request in USD, which converts the PO amount with the request-date rate and stores it.

## 3. Receipts, journals, transfers

| Voucher | Debit | Credit |
|---|---|---|
| BRV donor tranche | bank GL (T) | grant funds received (control, `grant_id`) |
| CRV advance return | cash GL | staff advances (dims of the advance lines) |
| BRV supplier refund | bank GL | expense account of the refunded budget line (reduces Actual) or supplier advances |
| BRV/CRV bid-security cash deposit | bank/cash GL | suspense (bid securities held) |
| JV reclassification | expense, target budget line | expense, source budget line (negative Actual on source) |
| JV settlement (STL) | expense per settlement line | staff advances |
| TRF | destination GL at the entered rate | source GL at the source carrying rate; exchange gain/loss line for the base difference |

## 4. Budget movements by event (D2)

All of these happen in one `withTenantTx`, with budget lines locked in ascending id order and
the guard deferred to commit.

| Event | `budget_commitment` | Actual |
|---|---|---|
| Direct payment / advance submitted | insert `reserved` (source DPR/ADV, rate locked) | — |
| … approved | `reserved → committed` | — |
| … returned/rejected/cancelled | release with the matching reason | — |
| PO/contract approved | PR rows of ordered lines released `converted_to_po` (+ remainder row); insert PO `committed` per budget line at the PO rate | — |
| Amendment approved | PO row released `amended`; insert the new open amount | — |
| PV posted (order) | split the PO row: release `commitment_consumed_grant` as `consumed_by_payment`, insert remainder | + `actual_grant_amount` |
| PV posted (direct) | release the consumed part `consumed_by_payment` | + |
| PV posted (staff advance) | none (stays committed) | none (asset) |
| Settlement posted | release the settled part of the advance row `settled`; on full settlement release the remainder `settled` | + per settlement line |
| JV / allocation posted | none | ± per line |
| PO closed / cancelled | release the remaining open row `po_closed` / `cancelled` | — |
| Reversal posted | insert `committed` rows restoring each consumed amount at the original locked rate (`supersedes_id` → consumed row) | − original `actual_grant_amount` (mirrored lines) |

Guard at commit, per touched budget line:
`budget − reserved − committed − Σ actual_grant_amount(posted) ≥ 0`. Otherwise
`BUDGET_EXCEEDED`. The service computes the same figure first, under the locks, so the user sees
the shortfall per line (001 shape).
