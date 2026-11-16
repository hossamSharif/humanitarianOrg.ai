# Plan Input — Feature 002 (Procurement to Payment, Accounting, Reports)

> Input for `/speckit.plan` (after `/speckit.clarify`). Paste as the argument.

Use exactly the stack, structure, and conventions of `001-grants-pr-foundation`
(`specs/001-grants-pr-foundation/plan.md`, `research.md`, `data-model.md`,
`contracts/`). Do not introduce new frameworks. Read those files first; this plan extends them.

## Stack (unchanged from 001)

- Monorepo pnpm 8.15 + Turborepo 2, Node 20, TypeScript 5 strict, scope `@ngo/*`.
- API: Express 4, Zod 3, routes → services → repositories, `withTenantTx` on the `postgres`
  driver (session pooler, port 5432) for every state-changing command, supabase-js for CRUD/reads,
  `AppError` → `{ code, message, details? }`, idempotency middleware on all mutations, decimal.js,
  exceljs.
- Web: Next.js 14 `[locale]` (ar default, en), next-intl, shadcn/ui + Tailwind (logical
  properties only), TanStack Query/Table/Virtual, React Hook Form + Zod, Zustand,
  **@react-pdf/renderer 4.9** with `direction: 'rtl'` on every `Text` and `row-reverse` rows in
  Arabic templates (research R13 spike result).
- Supabase Postgres 17 (cloud project via Supabase MCP), Auth, Storage. Migrations continue from
  `0009_*` in `packages/database/migrations`, applied with Supabase MCP `apply_migration`; types via
  `generate_typescript_types`.
- Shared helpers already built are reused, never duplicated: money/convert/rounding, amount in
  words (ar/en), DD/MM/YYYY formatter, numbering service, exchange-rate lookup and locking, audit
  trigger, RLS helpers `app.current_tenant_id()` and `app.has_office_access()`.

## Prerequisite

Feature 001 tasks T142–T166 (US8 lists/notifications/history/report, seed, E2E, security, README)
must be complete and green before implementing 002: 002 generalizes My tasks, notifications,
history, and the budget report, and its E2E extends the RTHA PR 0010 fixture.

## Key design decisions to make in research.md

### D1. Generalize the approval engine (preferred: refactor now)

001 has PR-specific `pr_approval_step` and `approval_action`. 002 adds ~12 approvable document
types. Preferred approach: introduce generic tables `doc_approval_step` and `doc_signature` keyed
by `(doc_type, doc_id)` (same columns and rules as 001: cycle, step_order, kind, required role,
assignee, snapshot name/position, insert-only signatures, one-signature-per-user-per-cycle index),
migrate existing PR rows into them in a migration, and keep the PR API contract and all 001 tests
unchanged (compatibility views named `pr_approval_step` / `approval_action` if needed). The
routing service already resolves rules by `doc_type`, office, and amount; extend
`approval_rule.doc_type` to the new types. Segregation rules become per-document-type policies in
one service (`segregation.service.ts`) with unit tests per rule (spec BR-8).

Reject in research only with a written reason (e.g. a second engine per document type).

### D2. Generalize budget commitments

Extend `budget_commitment` with `source_doc_type`, `source_doc_id`, `source_line_id` (PR line, PO
line, contract milestone, direct payment line, advance line); keep `pr_id` populated for PR rows
for compatibility, or migrate it. Statuses stay `reserved | committed | released`; add
`release_reason` values `converted_to_po`, `po_closed`, `consumed_by_payment`, `amended`.
Transitions:

| Event | Effect |
|---|---|
| PO/contract approved | PR line commitments for ordered lines → `released (converted_to_po)`; new PO commitment `committed` at PO amount (grant currency, rate locked at PO approval); increase checked against Available under the 001 row-lock pattern |
| PO amendment approved | PO commitment adjusted (release + new row), increase checked |
| Payment voucher posted | PO commitment reduced by matched amount (`consumed_by_payment`), Actual recorded via journal lines |
| PO/contract closed or cancelled | remaining commitment `released` |
| Direct payment request / advance | same lifecycle as PR: reserve on submit, commit on approval, consumed on posting/settlement |

`budget_line_balance` view: `actual` = Σ posted journal lines on expense accounts with that
`budget_line_id`, in grant currency (debits − credits). The deferred `available >= 0` trigger now
also fires on journal lines. Keep SC-005 performance: if the view becomes slow, add trigger-
maintained totals behind the same view (research R5 already allowed this).

### D3. Sealed quotations and bids

Store prices in separate tables (`quotation_line_price`, `bid_price`) whose RLS select policy
requires the parent RFQ/tender `opened_at is not null`; inserts before opening are allowed only
for RFQ quotation logging, never for tender prices (prices entered during the opening session).
Opening is a `withTenantTx` command that checks `now() >= deadline` in server time, records the
attendees, and sets `opened_at`. Integration test: before opening, `select` of prices returns no
rows for every role, including org admin.

### D4. Procurement method resolution

`procurement_method_band` (tenant-level) and `grant_procurement_rule` (grant overrides).
Resolution = stricter of both for the event's estimated value in the DoA reference currency
(rates locked as in 001). Waiver documents (`waiver`, own DoA) link to the sourcing event.
Anti-splitting check is a query (same office, grant, category within 30 days) returning a warning.

### D5. Accounting model

- `gl_account` (hierarchical, type, posting flag), `budget_line.expense_account_id` (default from
  category mapping table), `bank_account` / `cash_box` linked to GL accounts with currency and
  office, `control_account_setting`, `accounting_period` (monthly, open/closed).
- `voucher` (type BPV, CPV, BRV, CRV, JV, TRF; status draft → checked → approved → posted;
  `reversal_of_id`) and `voucher_line` (account, debit/credit in transaction currency, currency,
  rate_to_base, rate_date, rate_source, exchange_rate_id, base debit/credit, grant-currency amount,
  dimensions: grant_id, budget_line_id, donor_id, office_id, activity_id, category text,
  source links to payment request / PO line / advance).
- Balanced in base currency: deferred constraint trigger on posting. Posted rows immutable
  (trigger), reversals only. Period check on posting. Cash basis (spec assumption).
- Payment voucher generation is a pure function in `packages/shared` or a service with unit tests
  covering: simple payment, deductions (WHT), retention, advance clearing, foreign-currency payment,
  and the BPV-35 salary sample.
- Seed a default NGO chart of accounts and control accounts on tenant creation; RTHA demo seed adds
  accounts `10102`, `10202`, `70205` (Blue Nile Mashreq Bank – White Nile).

### D6. Document links and trail

Explicit FKs on lines (`rfq_line.pr_line_id`, `po_line.rfq_line_id` and `pr_line_id`,
`grn_line.po_line_id`, `invoice_line.po_line_id`, `payment_request_line.po_line_id|grn_line_id|
milestone_id|direct_line_id`, `voucher_line.payment_request_line_id`), plus a read-only SQL view or
service `document_trail(doc_type, doc_id)` returning the full chain both ways for the trail screen
(SC-006). Downstream inheritance enforced by triggers: supplier, grant, budget line cannot differ
from the source (spec BR-1, BR-2).

### D7. Numbering

Add doc types to `numbering_config` seeds: `RFQ`, `TND`, `QA`, `WVR`, `PO`, `CON`, `AMD`, `GRN`,
`SCC`, `INV` (internal registration number), `PAY`, `DPR` (direct payment), `ADV`, `STL`, `BPV`,
`CPV`, `BRV`, `CRV`, `JV`, `TRF`. Same sequence table and transaction rule as 001.

### D8. Permissions and default roles

Extend `packages/shared/src/permissions.ts` and the seed, keeping `resource:action`:
`suppliers:read|manage|vet`, `procurement:configure`, `rfq:create|issue|open`, `tender:manage|open`,
`evaluation:score|sign`, `award:approve`, `waiver:create|approve`, `po:create|approve|amend|cancel|close`,
`grn:create|inspect`, `invoice:register`, `payment:create|check|approve|override_match`,
`voucher:create|check|approve|post|reverse`, `accounts:manage`, `periods:manage`,
`bank:manage|reconcile`, `advance:request|approve|settle`, `allocation:manage`, `reports:read`,
`reports:finance`. Seed roles from the spec's role table.

### D9. Prints

One react-pdf template per document in `apps/web/src/features/<module>/print/`, sharing a common
header/footer/signature-block/watermark kit extracted from the 001 PR print. The BPV template
reproduces the RTHA BPV-35 columns: No, A/c No., Account Name, Cur, Donor, Contract, Description,
Debit, Credit, Rate, Dr, Cr, Total; Entered/Checked/Approved/Received By; PAID stamp with date;
print date; page x/y. Print data endpoints follow `contracts/print-layout.md` style with
`print_snapshot` frozen at approval.

### D10. Reports performance

Reports run as SQL views/functions with `security_invoker`; donor report and Budget vs Actual over
`budget_line_balance` plus period filters on journal lines. Add indexes on
`voucher_line (tenant_id, budget_line_id, posted_period)` and similar. Perf test seeds 5,000 PRs,
3,000 POs, 20,000 voucher lines (SC-005 < 3 s).

## Modules and suggested API routes (adjust in contracts)

`/suppliers`, `/procurement-settings`, `/rfqs`, `/rfqs/:id/quotations`, `/rfqs/:id/open`,
`/evaluations`, `/waivers`, `/tenders` (+ `/clarifications`, `/bids`, `/open`, `/securities`),
`/pos`, `/contracts`, `/amendments`, `/grns`, `/completion-certificates`, `/invoices`,
`/payment-requests`, `/direct-payments`, `/advances`, `/settlements`, `/vouchers`
(+ `/check`, `/approve`, `/post`, `/reverse`), `/gl-accounts`, `/bank-accounts`, `/cash-boxes`,
`/periods`, `/allocations`, `/bank-reconciliations`, `/reports/*`, `/trail/:docType/:docId`,
`/my-tasks` (generalized), `/notifications` (new kinds).

Web navigation groups: Procurement (Suppliers, RFQs, Tenders, Evaluations, POs & Contracts,
Receiving), Finance (Invoices, Payment Requests, Direct Payments, Advances, Vouchers, Bank & Cash,
Chart of Accounts, Periods), Reports, Settings.

## Implementation order (tasks.md phases follow spec priorities)

1. Foundation migrations and refactors: D1 approval engine, D2 commitments, D7 numbering, D8
   permissions; all 001 tests must stay green after this phase (gate).
2. P1 path end to end: US1 → US2 → US3 → US4 → US5 → US6 → US7 → US11 → US12 → US13 → US19 (1–3).
   Gate: RTHA chain E2E (SC-001) passes in `ar` and `en`.
3. P2: US8, US9, US10, US14, US15, US16, US19 (4–10), US20, US21.
4. P3: US17, US18.
5. Polish: perf tests, security pass, quickstart update, screenshots.

Run `/speckit.implement` one phase at a time and commit after each (constitution workflow).

## Testing

- Unit: every spec business rule (BR-1 … BR-22) has a named test; voucher generation cases (D5);
  price-score calculation (spec US5 acceptance 1: 50.00 / 47.84 / 42.68); method resolution;
  segregation per document type; amount in words for 870,710.00 and 3,040,800.00 SDG.
- Integration: sealed prices (D3), commitment transitions (D2) including concurrency of PO approval,
  payment posting, and JV on the same budget line (SC-004), three-way match and override, period
  lock, voucher immutability and reversal, trail completeness.
- E2E (Playwright, `ar` and `en`): RTHA full chain extending fixture `rtha-pr-0010.json` with the
  three bidders from sheet "Quotation Analysis" of `RTHA Procurement Forms _091811.xlsx`; BPV-35
  direct salary payment; advance and settlement; print comparisons with the paper forms.

## Constitution

The constitution amendment in `docs/constitution-amendment-002.md` (v1.2.0) is applied before
`/speckit.specify`. Include a Constitution Check table covering all principles, including the new accounting
principle. Expected Complexity Tracking items: the D1 refactor of 001 tables and DB-level
balance/immutability triggers.