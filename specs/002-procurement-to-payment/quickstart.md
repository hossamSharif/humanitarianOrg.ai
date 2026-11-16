# Quickstart & Validation Guide

**Feature**: `002-procurement-to-payment` | Plan: [plan.md](./plan.md)

How to prove the procurement-to-payment chain and the accounting work end to end. Endpoints are
in [contracts/rest-api.md](./contracts/rest-api.md), tables in [data-model.md](./data-model.md),
and posting rules in [contracts/posting-rules.md](./contracts/posting-rules.md).

## Prerequisites

- Everything in the [001 quickstart](../001-grants-pr-foundation/quickstart.md) prerequisites:
  Node 20, pnpm 8.15, environment variables, and the cloud dev project
  `humanitairianOrg` on the session pooler.
- **Gates before `/speckit-implement`** (research R36):
  1. 001 tasks T142 and T159–T166 are complete and green. The 002 E2E extends the
     `rtha-pr-0010.json` fixture (T160) and the demo seed (T159).
  2. Constitution v1.2.0 (Principle XI and the regression-gate workflow rule) is ratified
     (2026-11-14); commit `.specify/memory/constitution.md` if it is still uncommitted.
  3. Supabase MCP connects again. It timed out in the 002 planning session. Until then, use the
     fallback from 001 R20: `pnpm --filter @ngo/database migrate` and `npx -y supabase@2 gen types`.
  4. The **pg_cron** extension is enabled on the dev project for scheduled notifications (R29).
     The API interval fallback works without it.
- One new optional environment variable, documented in `apps/api/.env.example`: `NOTIFICATION_SWEEP_INTERVAL_MS` (default 900000) for
  the fallback sweeper.

## Setup

```bash
pnpm install
pnpm --filter @ngo/database migrate     # applies 0012_* … 0022_* after 0001–0011
pnpm --filter @ngo/database gen:types
pnpm --filter @ngo/database seed:demo   # 001 RTHA data + 002 additions (data-model §11)
pnpm dev                                # web :3000, api :4000
```

The 002 additions to `seed:demo`:

- accounts `10102`, `10202`, `70205`;
- the bank account "Blue Nile Mashreq Bank – White Nile" (SDG, MAD);
- budget line `10102` on the ADRA grant;
- suppliers Al-Qabas Library, Al-Shorouk Bookstore, and Mano Services (approved, vetted);
- staff payee NasrAldin Abdullah Ahmed;
- users `procurement@`, `committee1@`, `committee2@`, `committee3@`, `store@`, `inspector@`,
  `accountant@`, `fm@`, `cashier@`, `cd@`;
- November 2026 and September 2026 periods open;
- BPV sequence MAD/2026 = 34.

## Regression gate (after the foundation phase)

```bash
pnpm lint && pnpm type-check
pnpm --filter @ngo/api test:unit && pnpm --filter @ngo/api test:integration
pnpm --filter @ngo/database test        # RLS lint incl. every new table
pnpm --filter @ngo/web e2e -- rtha-pr-0010
```

Expected: every **001** suite is green with no test-case edits. The only allowed test-support
change is the TRUNCATE table list in `apps/api/tests/integration/helpers/setup.ts` (base tables
`doc_approval_step` and `doc_signature` replace the compatibility views). The PR print output is
byte-identical after the print-kit extraction.

## Automated checks (whole feature)

```bash
pnpm --filter @ngo/shared test          # scoring, method resolution, match, voucher generator, words
pnpm --filter @ngo/api test:unit        # BR-1…BR-22, segregation per doc type
pnpm --filter @ngo/api test:integration
pnpm --filter @ngo/web e2e              # ar + en projects
```

| Suite | Proves |
|---|---|
| `shared/procurement/scoring.test.ts` | 870,710 / 910,000 / 1,020,000 @ 50% → 50.00 / 47.84 / 42.68; workbook bidders → 50.00 / 48.04 / 43.51 (US5-1) |
| `shared/procurement/method.test.ts` | org RFQ band 1,000–25,000 + grant RFQ from 500 → 800 USD requires RFQ (US1-1); band gaps/overlaps rejected (US1-2) |
| `shared/accounting/generate-voucher.test.ts` | every case in posting-rules §2–§3, incl. BPV-35 |
| `shared/amount-in-words` | 870,710.00 and 3,040,800.00 SDG, ar + en (SC-007) |
| `api/unit/segregation.service.test.ts` | one test per rule id in rls-and-permissions §3 (SC-010) |
| `api/unit/business-rules-002.index.test.ts` | maps BR-1…BR-22 to their test files (Principle X) |
| `doc-engine-compat.int.test.ts` | PR rows migrated; 001 views insert/select; signatures immutable on base tables |
| `sealed-offers.int.test.ts` | before the opening, 0 rows and failed inserts for every role incl. org admin; opening before the deadline → `DEADLINE_NOT_PASSED`; undeclared member sees no prices (SC-009, US4-1, US5-5) |
| `sourcing.int.test.ts` | PR line exclusivity, mixed grants, issue guards, late offers, re-issue link |
| `po-commitment.int.test.ts` | PR→PO conversion equal / higher (shortfall) / lower; partial ordering keeps a remainder; cancel and close release exactly (US6-1/3, US10-4, BR-21) |
| `grn-receipt.int.test.ts` | 100 ordered: 60 then 50 → second blocked; receiver = inspector blocked; fully received → status + rating notification (US7) |
| `payment-match.int.test.ts` | 900,000 invoice vs 870,710 PO → `MATCH_FAILED`; override by the preparer refused; by FM accepted; duplicate invoice blocked |
| `payment-concurrency.int.test.ts` | parallel payment requests on one PO: only those keeping Σ ≤ total succeed (FR-060) |
| `budget-concurrency-002.int.test.ts` | parallel PO approval + payment posting + JV on one line with the last Available: survivors fit, Available ≥ 0 (SC-004) |
| `voucher-integrity.int.test.ts` | 0.01 imbalance cannot be checked; USD label with rate 1 rejected; posted voucher update/delete rejected; closed period blocks posting; three-people rule; reversal restores Actual and commitment at the original rates (SC-003, US13) |
| `period.int.test.ts` | close warns with unposted approved vouchers; reopen needs permission + reason (US12-4) |
| `advance.int.test.ts` | 500,000 advance, 420,000 receipts + 80,000 CRV → Actual +420,000, 80,000 released, balance 0; overdue blocks a new advance without a waiver (US16) |
| `trail.int.test.ts` | from the RTHA BPV, every upstream document is reachable with signatures and attachments (US19-4, SC-006) |
| `reports.int.test.ts` | Budget vs Actual Actual = Σ posted voucher lines; donor previous + this = cumulative; trial balance balances (SC-011) |
| `reports.perf.test.ts` | 5,000 PRs, 3,000 POs, 20,000 voucher lines → Budget vs Actual and donor report < 3 s (SC-005) |
| `notifications-002.int.test.ts` | deadline, guarantee, vetting, and overdue sweeps create one notification each and none on rerun |

## Manual acceptance A — RTHA chain (SC-001)

Fixture: `apps/web/e2e/fixtures/rtha-chain.json` = `rtha-pr-0010.json` plus the three bidders
from sheet "Quotation Analysis" of `RTHA Procurement Forms _091811.xlsx`:

| Supplier | Total (SDG) |
|---|---|
| Al-Qabas Library | 870,710 |
| Al-Shorouk Bookstore | 1,000,600 |
| Mano Services | 906,300 |

Criteria: price 50%, quality 25%, validity 25%.

1. `procurement@`: from approved PR-MAD-2026-0010 create an RFQ with all 9 lines. Method
   proposed: **RFQ** (870,710 SDG in USD). Set weights to 90% and see issuing blocked. Fix to
   100%, invite the 3 suppliers, and issue → `RFQ-MAD-2026-0001`. The PR lines show
   "In RFQ".
2. Log three receipts. Confirm that no price field exists anywhere. Try to open before the
   deadline and see it blocked. After the deadline, record the opening with two attendees and
   enter the prices.
3. Create the analysis and seat committee1–3:
   - committee1 tries to view prices before declaring and is blocked;
   - all three declare and score;
   - price points read 50.00 / 48.04 / 43.51, read-only;
   - Al-Qabas is recommended;
   - all sign, then submit.
4. `fm@`, then `cd@`, approve the award. `requester@` (the PR creator) is not eligible.
5. `procurement@` creates the PO. Supplier and lines are read-only. `fm@` and `cd@` approve.
   Budget line 10202: PR commitment replaced by the PO commitment, Available unchanged. Upload
   the acknowledgement. PR status becomes **Closed**.
6. `store@` creates a GRN for all 9 lines and signs Received By; `inspector@` signs Inspected
   By. PO is **Fully Received** and a rating is requested.
7. `accountant@` registers the invoice and creates the payment request:
   - gross **870,710.00 SDG**;
   - words "Eight Hundred Seventy Thousand Seven Hundred Ten Sudanese Pounds";
   - match OK;
   - `store@` cannot approve it.

   `fm@` checks and `cd@` approves.
8. `accountant@` generates the BPV (Dr 10202 / Cr bank). `fm@` checks, `cd@` approves, and
   `accountant@` posts. 10202 Actual increases and Committed decreases by the matched amount.
   The payment request is **Paid** with a date.
9. From the BPV, open the trail and reach PR, RFQ, analysis, award, PO, GRN, and invoice, each
   with signatures.
10. Print every document in `ar` and `en`; check the watermarks and amounts in words.
    Run Budget vs Actual, the donor report, and the procurement register for ADRA.

## Manual acceptance B — BPV-35 (SC-007, SC-008)

`accountant@` creates a direct payment request:

- payee NasrAldin Abdullah Ahmed;
- category salary, "September 2026";
- budget line 10102, 3,040,800.00 SDG;
- donor ADRA;
- cheque;
- Blue Nile Mashreq Bank – White Nile.

Approve it, generate the BPV dated 24/09/2026 with cheque 35, check, approve, record Received
By, and post → `BPV-MAD-2026-0035`. Compare the print with
`WhatsApp Image 2026-11-13 at 9.30.57 PM.jpeg` field by field:

- the words read "Three Million Forty Thousand Eight Hundred Sudanese Pounds";
- line 1 shows **SDG** with rate 1.0000;
- "PAID" shows the posting date.

## Negative checks (spot)

- Combine PRs of two grants in one RFQ → `MIXED_GRANTS`.
- Supplier with an expired registration certificate: invite → warning; award → blocked
  (`SUPPLIER_NOT_ELIGIBLE`).
- Two 600 USD PRs, same office/grant/category within 30 days, sourced as Direct → splitting
  warning that must be acknowledged with a comment.
- Contract milestones totalling 90% → `MILESTONES_INVALID`. Certificate signed twice by the same
  user → blocked.
- Amendment raising the PO above Available → `BUDGET_EXCEEDED` with the shortfall. The original
  version is still viewable.
- Direct payment in category "goods" → `PROCUREMENT_ONLY_CATEGORY`.
- Pay from a USD account in SDG → `CURRENCY_MISMATCH`.
- JV without a reason → `REASON_REQUIRED`. JV moving 100,000 SDG to a line with 80,000 Available
  → `BUDGET_EXCEEDED`.
- Delete a used account → `ACCOUNT_IN_USE`; deactivate works.
- Allocation template totalling 95% → `ALLOCATION_NOT_100`.
- Bank reconciliation that does not balance → sign-off blocked with the difference.
