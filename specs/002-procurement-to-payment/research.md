# Phase 0 Research: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

**Feature**: `002-procurement-to-payment` | **Date**: 2026-11-16 | **Plan**: [plan.md](./plan.md)

**Input**: `docs/plan002.md` (decisions D1–D10). This feature keeps the 001 stack, layout, and
conventions unchanged ([001 research](../001-grants-pr-foundation/research.md) R1–R20 still
apply). Items D1–D10 follow the plan input. Items R21–R36 resolve the remaining unknowns found
while reading the spec, the 001 code, and the RTHA samples.

Facts from the codebase that shape these decisions:

- The latest migration is `0011_approval_rule_guard.sql`, so 002 migrations start at **`0012_*`**.
  The plan input's "continue from `0009_*`" was written before 0009–0011 existed.
- 001 integration tests write to `budget_commitment` and `approval_action` directly with SQL
  (`budget-concurrency`, `funding`, `segregation`, `bulk.ts`), and `helpers/setup.ts` TRUNCATEs
  `pr_approval_step` and `approval_action` by name.
- `audit_history.pr_id` ties child rows to the PR timeline (0006). `notification.pr_id` is
  `not null` (0005). `numbering_config.doc_type`, `document_sequence.doc_type`, and
  `approval_rule.doc_type` all have `check (doc_type = 'PR')`.
- `exchange_rate_locked_when_used()` only looks at PR tables.
- Supabase MCP failed to connect in this planning session. Same fallback as 001 R20: SQL files
  in `packages/database/migrations`, applied with MCP `apply_migration` when it connects,
  otherwise with the Supabase CLI.

---

## D1. One generic approval engine (refactor now)

- **Decision**: Add the generic tables **`doc_approval_step`** and **`doc_signature`**, keyed by
  `(doc_type, doc_id)`. They have the same columns and rules as 001's `pr_approval_step` and
  `approval_action`: cycle, step_order, kind, required role, assignee, rule-step provenance,
  status, name/position snapshot, insert-only, and the unique partial index
  `(doc_type, doc_id, cycle, user_id) where action = 'approve'`. Migration `0012` copies every
  PR row into them, keeping the same ids so FKs and history stay valid. It then drops the old
  tables and creates **auto-updatable compatibility views** with the old names and columns:
  - `pr_approval_step` = `select id, tenant_id, doc_id as pr_id, … from doc_approval_step where doc_type = 'PR'`;
  - `approval_action` = the same over `doc_signature`.

  Both views use `security_invoker = true` and `with cascaded check option`, and have a view
  column default of `doc_type = 'PR'`. Raw SQL `insert into approval_action (…, pr_id, …)` in
  the 001 tests and supabase-js `.from('pr_approval_step')` therefore keep working unchanged.
  The one test-support change is the TRUNCATE list in `apps/api/tests/integration/helpers/setup.ts`,
  which must name the base tables, because views cannot be truncated. That is a helper, not a
  test case, so it is allowed under the regression gate.
- **Other details**:
  - `doc_id` cannot carry an FK to many parents. A `BEFORE INSERT` trigger,
    `app.doc_ref_check()`, checks that the parent row exists in the table registered for the
    `doc_type` (registry: `app.doc_type_registry`).
  - RLS on both tables uses the single tenant helper plus `app.can_read_doc(doc_type, doc_id)`.
    That helper applies the parent's office scope; for PRs it is the same rule as 001.
  - `approval_rule.doc_type` and `approval_rule_step.kind` gain the new values (see D8 and the
    data model).
  - The 0011 rule guard becomes per-doc-type:
    - PR: step 1 is `finance_check`.
    - Vouchers (`PV`, `RV`, `JV`): step 1 is `check`.
    - All other types: no required first kind.
    - Every type: contiguous bands on the final step.
- **Service shape**: `pr-workflow.service.ts` is generalized into
  `document-workflow.service.ts`. It runs submit, approve, reject, return, cancel, and reassign
  for any doc type through a small adapter per type:
  - `loadForUpdate`, `doaAmount`, `officeId`, `creatorId`;
  - `segregationPolicy`;
  - `onSubmit`, `onApproved`, `onReleased`;
  - `notificationParams`.

  The PR adapter wraps the existing PR rules, so `prs.routes.ts` and the PR contract do not
  change. Approval routing (`ApprovalRoutingService.routeFor/pickRule`) already works by
  doc type, office, and amount; it is reused unchanged.
- **Segregation**: all separation-of-duties checks move into one place,
  **`apps/api/src/services/segregation.service.ts`**. It exports one policy per doc type and
  answers `canSign(doc, user, stepKind, priorSignatures)` with a reason code. Business Rule 8
  rows, one unit test each:
  - PR creator ✗ award approval;
  - document creator ✗ its own approval (all types);
  - GRN `received_by ≠ inspected_by`;
  - SCC signer 1 ≠ signer 2;
  - payment request: preparer, GRN receivers/inspectors, and SCC signers of the matched lines
    ✗ approve;
  - voucher: entered ≠ checked ≠ approved;
  - committee member without a declaration ✗ score.

  The 001 PR checks (creator, one step per user across cycles) are re-expressed as the PR policy
  and keep their existing tests.
- **Rationale**: The spec adds 12 approvable types. One engine keeps "one person, one step",
  signature snapshots, and the immutable store in one place (Principle II). The views keep every
  001 test and contract untouched (plan input gate).
- **Alternatives considered**:
  - A second engine per document type. Rejected: it would duplicate signature immutability, the
    eligibility rules, and My-tasks queries 12 times, and segregation could drift between types.
  - Keeping PR tables and adding generic tables only for new types. Rejected: My tasks, the
    history timeline, and the trail would need to union two engines forever.
  - INSTEAD OF triggers on the views. Rejected: auto-updatable views cover the 001 statements
    without hand-written triggers.

## D2. Generalized budget commitments

- **Decision**: Extend `budget_commitment` in place, so the table name is unchanged and the 001
  SQL keeps working.
  - New columns:
    - `source_doc_type`, with default `'PR'` so 001 inserts stay valid;
    - `source_doc_id`;
    - `source_line_id` (nullable);
    - `supersedes_id` (FK to the row this one continues);
    - `rate_to_grant` with `rate_date`, `rate_source`, and `exchange_rate_id`, holding the rate
      locked when the row was created.
  - `pr_id` becomes nullable and stays populated for PR rows. A check enforces
    `(source_doc_type = 'PR') = (pr_id is not null)`, and a trigger copies `pr_id` into
    `source_doc_id` for PR rows.
  - `cycle` stays. Non-PR rows use their document's submission cycle.
  - The unique `(pr_id, budget_line_id, cycle)` becomes the partial unique index
    `(source_doc_type, source_doc_id, budget_line_id, cycle) where status in ('reserved','committed')`.
    That allows one open row per source × line × cycle, plus any number of released rows.
  - `release_reason` gains `converted_to_po`, `po_closed`, `consumed_by_payment`, `amended`,
    `settled`, and `reversal_restore`.
- **Partial consumption uses a "split chain"**: amounts are never edited.
  - To reduce a commitment, the service releases the open row with a reason and, when something
    remains, inserts a new `committed` row for the remainder with `supersedes_id` pointing at the
    old row.
  - Ordering some lines of a PR, PO receipts paid in parts, and amendments all use the same
    pattern.
  - `budget_line_balance` keeps summing by status, so the view and the 001 report queries do not
    change shape.
- **Transitions** (all inside `withTenantTx`, budget lines locked `FOR UPDATE` in ascending id
  order as in 001 R4):

| Event | Effect |
|---|---|
| Award approved | Check only. Awarded amount per budget line ≤ PR committed amount for the awarded lines + Available (FR-030). Nothing is written. |
| PO/contract approved | PR rows for the ordered lines: release `converted_to_po`, keeping a remainder row if some PR lines on that budget line stay unordered. New PO row `committed` at the PO line amounts in grant currency, at the rate of the PO currency on the approval date, locked. The net increase is checked against Available. |
| Amendment approved | PO row released `amended`. New row at the new open amount; an increase is checked. |
| Payment voucher posted (PO/contract) | For each budget line, the PO row is split: matched amount × the PO's **locked** rate is released `consumed_by_payment`. Actual is recorded from the voucher lines at the **posting** rate (clarification Q2). |
| Direct payment request / cash advance | Same as a PR: `reserved` on submit, `committed` on approval. DPR: `consumed_by_payment` on BPV/CPV posting. Advance: stays committed when the advance is paid (an asset, not Actual), and is consumed `settled` when the settlement is posted. The unused part is released `settled`. |
| PO/contract closed or cancelled | Remaining open row released `po_closed` / `cancelled`. Cancelled unordered PR lines go back to Not sourced. Their PR commitment was already converted, so a cancelled PO's lines get **no** new PR reservation. |
| Voucher reversal | Actual is negated at the original voucher's rates. Consumed commitment is restored with a new `committed` row (`reversal_restore`) at the original locked rate (US13-6). |

- **Actual**: `voucher_line.actual_grant_amount` is set when a voucher is generated, and only for
  lines whose account type is `expense` and that carry a `budget_line_id`. It is signed: debit
  positive, credit negative, in grant currency. `voucher_line.posted_period` (a `date`, first of
  the month) is stamped in the posting transaction. `budget_line_balance.actual` is
  `Σ actual_grant_amount where posted_period is not null`.
- **Guard**: the 001 deferred trigger `budget_commitment_available_guard` is replaced by one
  function, `app.assert_budget_line_available(budget_line_id)`, computing
  `budget − reserved − committed − actual`. It is called by deferred constraint triggers on both
  `budget_commitment` and `voucher_line`; the latter fires when `posted_period` is set. If the
  view becomes slow, trigger-maintained totals in `budget_line_total` can be added behind the
  same view (001 R5 allowed this), and SC-005 performance tests decide.
- **Rationale**: One table and one view keep "Available is derived, never typed"
  (Principle III). The split chain gives a complete, append-only history of every movement,
  which is the spec's "Budget Movement" entity, without a second ledger.
- **Alternatives considered**:
  - A `budget_movement` ledger with signed deltas. Rejected: a second source of truth beside
    `budget_commitment`, and the 001 report and tests would need rewriting.
  - Mutating `amount` on partial consumption. Rejected: it loses the history and breaks
    "released rows are kept for audit".

## D3. Sealed quotations and bids

- **Decision**: RFQs and tenders share one **sourcing** data model (see R21). Offers are split
  into three tables:
  - **`offer`**: the receipt log. Supplier, received at, received by, status
    `logged | replaced | late | withdrawn`. Always readable.
  - **`offer_terms`**: currency, delivery days, validity days, payment terms, compliance per
    essential criterion, scanned-offer attachment id.
  - **`offer_line_price`**: unit price, and quantity if different, per sourcing line.

  `offer_terms` and `offer_line_price` (the "sealed" tables) have RLS **select and insert**
  policies that require the parent event's opening to exist:
  `app.sourcing_opened(sourcing_event_id)` returns `sourcing_event.opened_at is not null`. This is
  the same for RFQs and tenders.

  - Before the opening, an insert is impossible for every role, including org admin. A select
    returns zero rows.
  - The service also refuses with `SOURCING_NOT_OPENED`.
  - The scanned-offer upload URL is issued only after the opening. The storage policy for the
    path `offers/{tenant}/{event}/{offer}/…` calls the same helper.

  This applies clarification Q6: before the deadline only receipts are logged, for RFQs as well
  as tenders.
- **Opening**: `POST /rfqs/:id/open` and `/tenders/:id/open` are `withTenantTx` commands that:
  1. lock the event;
  2. check `now() >= submission_deadline` using **database** time (`select now()`), never the
     client's clock;
  3. record the attendees (≥ 2 for an RFQ, ≥ 3 for a tender, FR-020 and FR-046) and the
     late-offer decisions (RFQ only, with a reason);
  4. set `opened_at`.

  Bid prices are read out and entered during the session; RFQ prices are entered during or after
  it. A tender's opening record is then signed by every attendee (`doc_signature`
  `action = 'attend'`, refused below 3 attendees, US9-4). Evaluation cannot start until the
  record is signed, and after signing, bid prices are frozen.
- **Committee visibility (US5-5)**: in addition to `sourcing_opened`, the price policies require
  `app.may_see_offer_prices(event_id)`. It is false while the caller is a committee member on
  that event's analysis who has not declared, or who declared a conflict. Non-members with
  `rfq:open`, `evaluation:*`, or read access see prices after the opening.
- **Late offers**: `offer.received_at > submission_deadline` makes the status `late` (set by a
  trigger from the deadline, never typed). For RFQs, the opening record may accept specific late
  offers with a reason. Late tender bids can never get terms or prices (policy check).
- **Tests**: an integration test, `sealed-offers.int.test.ts`, impersonates every seeded role
  including `org_admin` and the service-role-less owner JWT. Before the opening, `select` on both
  sealed tables returns 0 rows and `insert` fails. After the opening, both work. The scanned-offer
  upload URL request returns `409 SOURCING_NOT_OPENED` before the opening (SC-009).
- **Rationale**: Principle VII (amended) and SC-009 require that prices are not *readable* by
  anyone. Enforcing it in RLS means no export, search, or report path can leak them, even one
  added later.
- **Alternatives considered**:
  - Encrypting prices until the opening (key management, for no gain over not storing them).
  - API-only checks (any future report query could leak).
  - Separate `quotation_line_price` and `bid_price` tables (plan input wording). Rejected for
    R21: the sealed policy would be written twice.

## D4. Procurement method resolution

- **Decision**:
  - **`procurement_method_band`** (tenant): method `direct | rfq | tender`, rank 1/2/3,
    `(min_amount, max_amount]` in the DoA reference currency, `min_quotations`. Defaults:
    ≤ 1,000 direct (1); > 1,000–25,000 RFQ (3); > 25,000 tender (3, open).
  - **`grant_procurement_rule`** (per grant, optional rows of the same shape): stricter bands
    and/or a higher minimum.
  - Both sets are validated on save as contiguous from 0, non-overlapping, with an open top
    (FR-002, US1-2). The existing `approval-routing` band helpers (`ruleIssues`, `bandContains`)
    are reused.
- **Resolution** (pure function `resolveProcurementMethod` in `packages/shared`):
  1. Estimated value = Σ selected PR lines' `line_total × rate_to_base ÷ doa_rate_to_base`,
     using the **PR's locked** rates (001 R7). No new rate lookup.
  2. Find the band containing the value in each set.
  3. The required method is the higher rank.
  4. `min_quotations` = max(tenant band minimum for that method, grant band minimum for that
     method, if any).

  The event stores `required_method`, `required_min_quotations`, `estimated_value_doa`, and the
  rule snapshot, so later configuration edits never change it (Principle VI, US1-4).
- **Waiver**: choosing a lower method, or inviting or receiving fewer than the minimum, requires
  an approved `waiver` whose `covered_doc_type/id` is the event. A waiver's DoA amount is the
  covered estimated value.
- **Anti-splitting** (FR-053) is a query, not a block:
  - Scope: approved PR lines from the same requesting office and grant, with the same
    **budget-line category**, on PRs dated within 30 days of the current PRs, that are in an
    open or completed sourcing event of a lower method than the combined total would require.
  - When the combined estimated value exceeds the current band's `max_amount`, the API returns
    a `splittingWarning`.
  - Submitting the event then requires `splittingAcknowledgement: { comment }`, stored on the
    event and in history.
  - "Category" means budget-line category because PR lines have no item category in 001.
    Supplier categories describe suppliers, not lines.
- **Rationale**: FR-003 says "stricter of both". Using locked PR rates keeps the result stable
  and auditable.
- **Alternatives considered**:
  - Grant rules replacing tenant rules entirely. Rejected: they could loosen controls.
  - Re-converting at today's rate. Rejected: the method would change from day to day.

## D5. Accounting model and voucher generation

- **Decision** (tables in [data-model.md](./data-model.md) §6–§7):
  - **Chart of accounts**: `gl_account`, hierarchical. `parent_id`, `code` (text, unique per
    tenant), names ar/en, `type` (`asset | liability | fund_balance | income | expense`),
    `is_posting`, `is_active`.
  - **Budget mapping**: `budget_category_account` maps budget category to a default expense
    account. `budget_line.expense_account_id` (nullable) overrides it per line.
  - **Money accounts**: `money_account` covers bank accounts and cash boxes: kind, name, bank,
    branch, number, currency, office, ledger account, custodian, opening balance and date.
  - **Control accounts**: `control_account_setting` (key, optional `grant_id`, account).
  - **Periods**: `accounting_period` (year, month, status `open | closed`).
  - **Deductions**: `deduction_type` (rate, applies to, payable account).
- **Voucher**:
  - Type `BPV | CPV | BRV | CRV | JV | TRF`.
  - Statuses `draft → pending_check → checked → approved → posted`, plus `returned` and
    `cancelled` (pre-posting only). The spec's "Draft → Checked → Approved → Posted" reads with
    `pending_check` as "submitted, waiting for the checker", which is needed so the number is
    assigned at first submission (FR-094).
  - `reversal_of_id` / `reversed_by_id`.
- **Voucher line**: account, debit/credit in transaction currency, currency, `rate_to_base`,
  `rate_date`, `rate_source`, `exchange_rate_id`, `base_debit/base_credit`,
  `actual_grant_amount`, the grant rate snapshot, dimensions (`grant_id`, `budget_line_id`,
  `donor_id`, `office_id` as location, `activity_id`, `category_text` for "Contract"), and source
  links (`payment_request_line_id`, `po_line_id`, `advance_line_id`, `settlement_line_id`).
- **DB guarantees** (Principle XI; see the plan's Constitution Check):
  1. **Currency/rate consistency** (row check):
     `currency = tenant base ⇒ rate_to_base = 1 and exchange_rate_id is null`, and
     `currency ≠ base ⇒ exchange_rate_id is not null`. The rate must equal the referenced rate
     row (trigger), and `base_debit = round(debit × rate_to_base, 2)`. "USD at 1.0000 on an SDG
     amount" cannot be stored (US13-4, SC-003).
  2. **Balance**: a deferred constraint trigger on `voucher`, fired when status moves to
     `checked` or later, raises `VOUCHER_UNBALANCED` unless `Σ base_debit = Σ base_credit` and
     both are > 0 (FR-069).
  3. **Immutability**: BEFORE UPDATE/DELETE triggers on `voucher` and `voucher_line` reject any
     change once `voucher.status = 'posted'`. The only exceptions are setting
     `reversed_by_id`/`reversed_at` on the voucher and `reconciled` match flags, which are
     stored in a separate table (R34) so lines never change (FR-073).
  4. **Period**: posting requires an `accounting_period` row for the voucher date's month with
     `status = 'open'`. This is checked in the service and re-asserted by trigger
     (`PERIOD_CLOSED`).
  5. **Basis**: cash basis (spec assumption). Expense is recognized only on posting.
- **Generation** is a pure function in
  `packages/shared/src/accounting/generate-voucher.ts` (no I/O). Its inputs are the payment
  request with lines, deductions, advance clearing, and retention, plus the account mapping,
  money account, rates, and base/grant currencies. It returns lines, or a typed error
  (`BUDGET_LINE_UNMAPPED`, `CURRENCY_MISMATCH`, `UNBALANCED`). The rules are in
  [contracts/posting-rules.md](./contracts/posting-rules.md). Unit-test table:
  - simple goods payment (RTHA 870,710 SDG: Dr expense 10202 / Cr bank);
  - WHT deduction;
  - retention withheld and later released;
  - advance paid, then cleared proportionally on the final invoice;
  - foreign-currency payment from a USD account on an SDG PO, at the posting rate, without an
    exchange difference line;
  - direct salary payment BPV-35: Dr 10102 3,040,800.00 SDG / Cr 70205 Blue Nile Mashreq Bank –
    White Nile, cheque 35, donor ADRA;
  - transfer with an exchange gain/loss line;
  - reversal (every line mirrored, the same rates).
- **Seeds**:
  - `app.bootstrap_tenant` gains a default NGO chart: groups 1 Assets (cash and bank, staff
    advances, supplier advances), 2 Liabilities (WHT payable, retention payable, payables),
    3 Fund balances (grant funds received, opening balance equity), 4 Income, 5 Expenses (one
    per budget category).
  - It also seeds control-account settings, category mappings, and the current and next month's
    `accounting_period` (open).
  - The RTHA demo seed adds accounts `10102` (Field Supervision Officer, expense), `10202`
    (expense), and `70205` (Blue Nile Mashreq Bank – White Nile, asset), and a bank
    `money_account` in SDG linked to `70205`.
- **Rationale**: The voucher is the only place Actual comes from (Principle XI). Keeping
  generation pure makes every BPV variant a fast unit test.
- **Alternatives considered**:
  - Accrual basis with AP. Out of scope per the spec's cash-basis assumption; deferred.
  - Storing only base amounts. Rejected: FR-068 requires the transaction currency and rate per
    line.

## D6. Document links and trail

- **Decision**:
  - **Explicit nullable FKs on lines**:
    - `sourcing_line.pr_line_id`;
    - `award_line.sourcing_line_id`;
    - `po_line.award_line_id`, `po_line.sourcing_line_id`, `po_line.pr_line_id`;
    - `grn_line.po_line_id`;
    - `completion_certificate.milestone_id | po_line_id`;
    - `supplier_invoice_line.po_line_id`;
    - `payment_request_line.po_line_id | grn_line_id | certificate_id | direct_budget_line`;
    - `voucher_line.payment_request_line_id | advance_line_id | settlement_line_id`.
  - **Header FKs**: PO → award; GRN → PO; invoice → PO; payment request → PO/invoice; voucher →
    payment request / advance / settlement.
  - **Inheritance triggers** (BR-1, BR-2, SC-002), one per child table, reject inserts and
    updates where the inherited columns differ from the source:
    - `po.supplier_id = award_line.supplier_id`;
    - `po.grant_id = sourcing_event.grant_id = pr.grant_id`;
    - `po_line.budget_line_id = pr_line.budget_line_id`;
    - `grn.supplier_id/po_id` from PO;
    - invoice supplier = PO supplier;
    - payment request payee = PO supplier;
    - payment request line budget line = PO line budget line;
    - voucher line grant/budget line = payment request line.

    The API never accepts these fields on downstream documents. They are copied by the service,
    and the trigger is the backstop (`INHERITED_FIELD_MISMATCH`).
  - **Trail**: the view `doc_edge(from_type, from_id, to_type, to_id)` is a `union all` over the
    FKs above. The function `app.document_trail(p_doc_type, p_doc_id)` is a recursive CTE in
    both directions, depth ≤ 12, security invoker. It returns
    `(doc_type, doc_id, number, status, date, amount, currency, depth, direction)`.
    `GET /trail/:docType/:docId` adds the signatures and attachments per node. The trail screen
    shows the whole chain on one page, each node linking to its document: one click to open,
    one to its attachment, which meets SC-006's "≤ 2 clicks".
- **Rationale**: Principle VII and US19-10. FKs give integrity, and the view gives one generic
  traversal.
- **Alternatives considered**:
  - A generic `document_link` table. Rejected: no FK integrity; links could be typed rather
    than inherited.

## D7. Numbering

- **Decision**:
  - Drop the `check (doc_type = 'PR')` on `numbering_config` and `document_sequence`. Replace it
    with an FK to `app.doc_type_registry(code)`, the same registry as D1.
  - Seed configs for `RFQ, TND, QA, WVR, PO, CON, AMD, GRN, SCC, INV, PAY, DPR, ADV, STL, BPV,
    CPV, BRV, CRV, JV, TRF`. The prefix equals the code, format
    `{prefix}-{OFFICE}-{YYYY}-{seq:4}`.
  - Same `document_sequence` increment inside the submitting transaction (001 R6). Numbers are
    assigned at first submission. GRN and SCC get theirs on creation because they have no
    approval route, and are completed by signing.
  - Office: the document's office, meaning the requesting office of the PR for sourcing and POs,
    the voucher's office, and so on.
  - `INV` is the internal registration number. The supplier's own invoice number is stored
    separately.
  - Amendments use `AMD` numbering and also carry `version` (2, 3, …) on the PO.
- **Rationale**: FR-005 and FR-094 reuse the proven mechanism.
- **Note**: BPV-35 is printed as "BPV-35". The demo seed sets the sequence so the reproduction is
  `BPV-MAD-2026-0035`. The printout reproduces fields, not the old numbering format (an admin may
  configure `includeOffice=false, includeYear=false, padding=1` to print `BPV-35`; uniqueness is
  then per tenant + year scope as in 001).

## D8. Permissions and default roles

- **Decision**: Extend `packages/shared/src/permissions.ts` and the `permission` seed with:
  - `suppliers:read|manage|vet`
  - `procurement:read|configure`
  - `rfq:create|issue|open`
  - `tender:manage|open`
  - `evaluation:score|sign`
  - `award:approve`
  - `waiver:create|approve`
  - `po:create|approve|amend|cancel|close`
  - `grn:create|inspect`
  - `invoice:register`
  - `payment:create|check|approve|override_match`
  - `voucher:create|check|approve|post|reverse`
  - `accounts:manage`
  - `periods:manage`
  - `bank:manage|reconcile`
  - `advance:request|approve|settle`
  - `allocation:manage`
  - `finance:read`
  - `reports:read`
  - `reports:finance`

  `procurement:read` and `finance:read` are added beyond the plan input so list and detail
  screens have a read permission, like 001's `pr:read`.
- **Step eligibility** (001 rule generalized): the user holds the step's role, that role grants
  the **step kind's permission for the doc type** (map in `segregation.service.ts`, e.g. `PO` +
  `final_approval` → `po:approve`, `PV` + `check` → `voucher:check`), the user has office
  access, and the segregation policy passes.
- **Seeded roles**: 001's roles plus
  - `procurement_officer`;
  - `committee_member`;
  - `storekeeper`;
  - `technical_inspector`;
  - `accountant`;
  - `finance_manager` (gets `periods:manage`, clarification Q4);
  - `cashier`;
  - `country_director`.

  The matrix is in [contracts/rls-and-permissions.md](./contracts/rls-and-permissions.md).
  `org_admin` again lacks every signing permission (approve, check, sign, score, post).
- **Default DoA rules** (one org-wide rule per type):
  - Award, PO, Contract, Amendment, Waiver: `approval` by Finance Manager, then
    `final_approval` by Country Director.
  - Payment Request and Direct Payment: `finance_check` by Finance Manager, then
    `final_approval` by Country Director.
  - PV, RV, JV: `check` by Finance Manager, then `final_approval` by Country Director.
  - Advance and Settlement: `approval` by Finance Manager.

  All are editable (FR-004, US1-3).

## D9. Prints

- **Decision**:
  - Extract the 001 PR print primitives (`fonts.ts`, `styles.ts`, the header band, info grid,
    signature block, watermark, and footer with page x/y) into
    `apps/web/src/features/print-kit/`. `features/pr/print/pr-document.tsx` is refactored to use
    the kit, and its output must stay identical (the 001 PR print test stays green).
  - One template per document in `apps/web/src/features/<module>/print/`.
  - The data endpoint is `GET /<docs>/:id/print`, shaped like `PrPrintData`. Labels come from
    `print_snapshot` (jsonb), which is frozen at approval, or at posting for vouchers.
  - Every template carries `direction: 'rtl'` on every `Text` in Arabic and uses `row-reverse`
    rows (001 R13 spike result, react-pdf 4.9).
  - The waiver numbers on the chain (via the trail) print on the analysis, the PO, the payment
    request, and the voucher (FR-050).
  - The RFQ-to-supplier template takes a reduced data shape with no offers, no other suppliers,
    and no prices (US20-2). The shape is enforced by its Zod schema, so leaking data is a type
    error.
- **BPV/CPV layout** reproduces BPV-35 (see the sample image in the repository root):
  - organization header with logo;
  - title "Bank Payment Voucher (BPV)" and the office/region line ("Gazira");
  - Project, Document No., Document date, Payee, Cheque No., Amount, Currency, Amount in
    Char.;
  - the table No · A/c No. · Account Name · Cur · Donor · Contract · Description · Debit ·
    Credit · Rate · Dr · Cr, with a Total row;
  - Entered By / Checked By / Approved By / Received By with names and dates from signatures;
  - the "PAID BY {org short name}" stamp **with the payment date** when posted;
  - print date and page x/y.

  Unlike the paper sample, each line prints its own currency and rate (FR-068), and the amount in
  words is generated, never typed (FR-087, SC-007, SC-008).

## D10. Reports performance

- **Decision**:
  - Reports are SQL functions (`security_invoker`, `stable`) in `0020_reports.sql`, called by
    the `postgres` driver from `report.service.ts`.
  - Budget vs Actual and the donor report read `budget_line_balance` plus
    `Σ actual_grant_amount` grouped by `posted_period` for the period/cumulative splits.
  - New indexes:
    - `voucher_line (tenant_id, budget_line_id, posted_period) where posted_period is not null`;
    - `voucher_line (tenant_id, account_id, posted_period)`;
    - `budget_commitment (tenant_id, source_doc_type, source_doc_id)`;
    - `voucher (tenant_id, money_account_id, voucher_date)`.
  - Excel export uses exceljs (as in 001). PDF is rendered client-side with the print kit.
  - Perf test `reports.perf.test.ts` seeds 5,000 PRs, 3,000 POs, and 20,000 voucher lines
    (extending `helpers/bulk.ts`) and asserts < 3 s for Budget vs Actual and the donor report
    (SC-005).
  - The trial balance and GL are computed from `voucher_line` base amounts.
  - Exchange rates listed in the donor report come from
    `distinct (currency, rate_to_base, rate_date, rate_source)` over the period's lines (US19-2).

---

## R21. RFQ and tender share one sourcing model

- **Decision**: **`sourcing_event`** has `kind = 'rfq' | 'tender'` and a common header: grant,
  office, method, deadline, currency, criteria, split-award flag, status, `opened_at`, and
  `reissued_from_id`.
  - **Shared children**:
    - `sourcing_line` (from PR lines, with an optional `lot_id`);
    - `sourcing_criterion` (essential pass/fail, or weighted by stage
      `technical | financial | single`);
    - `sourcing_invitation`;
    - `offer`, `offer_terms`, `offer_line_price`;
    - `opening_record` with `opening_attendee`.
  - **Tender-only children**: `tender_lot`, `tender_publication`, `tender_clarification`,
    `bid_security`.
  - `/rfqs` and `/tenders` are separate route modules and screens over `sourcing.service.ts`,
    with kind-specific rules: minimum attendees, late-offer acceptance (RFQ only), two-stage
    evaluation (tender), and numbering RFQ/TND.
- **Rationale**: Sealing, invitations, the opening, analysis, and award are the same control.
  Writing them once halves the RLS and test surface.
- **Alternatives considered**: Separate `rfq_*` and `tender_*` trees. Rejected: duplicate sealed
  policies and evaluation logic.

## R22. Analysis, scoring, and award as one approvable document

- **Decision**: **`bid_analysis`** (number `QA-…`, DoA doc type `AWARD`) is one per sourcing
  event; it is replaced when the event is re-issued. It owns:
  - `committee_member`: user, function label, `declared_at`, `has_conflict`, `conflict_note`,
    `excluded`, `replaced_by_id`;
  - `evaluation_score`: member × offer × criterion × stage, integer 1–5;
  - `analysis_result`: the computed snapshot per offer, and per line when splitting;
  - `award_line`: sourcing line → winning offer, supplier, quantity, unit price, currency,
    amount;
  - `unsuccessful_notice`: offer, date, channel.

  Committee signatures go in `doc_signature` (`action = 'committee_sign'`).
- **Scoring math** (pure, `packages/shared/src/procurement/scoring.ts`, decimal.js):
  - **Disqualification**: any essential criterion failed means disqualified, with the reason
    (FR-025).
  - **Price comparison**: on totals converted to the event currency at the **opening-date** rate
    (FR-023). The rates used are stored on `analysis_result`.
  - **Price score**: `weight × lowest ÷ price`, rounded half-up to 2 dp, never stored as input.
  - **Other criteria**: `weight × average(member scores) ÷ 5`, average kept at full precision and
    the result rounded to 2 dp. Weighted total = Σ of the rounded criterion points.
  - **Split award allowed**: price score is per line (lowest line price) and the non-price
    points are per supplier. The recommendation per line goes to the highest weighted total
    for that line. **Not allowed**: offers missing any line are non-compliant, and the
    comparison is on whole-offer totals.
  - **Tender**: stage 1 technical scores and pass/fail; only compliant bids get stage 2
    financial scores. The combined score uses the stage weights per lot.
  - **Tests**: the spec example 870,710 / 910,000 / 1,020,000 at 50% gives 50.00 / 47.84 /
    42.68. The RTHA workbook bidders, Al-Qabas Library 870,710 / Mano Services 906,300 /
    Al-Shorouk Bookstore 1,000,600, give 50.00 / 48.04 / 43.51 (E2E fixture).
- **Recommendation**:
  - The default is the highest valid total.
  - Choosing another supplier requires `justification` (text) and
    `justification_criterion_ids` (≥ 1 published criterion); otherwise `JUSTIFICATION_REQUIRED`
    (FR-027, US5-3).
  - Signing freezes `analysis_result`. All non-excluded members must sign (FR-029).
  - The analysis then enters DoA with the **awarded amount** in the DoA currency, and the
    segregation policy blocks the PR creator(s) at every approval step.
  - The award approval also runs the FR-030 budget check.
- **Committee size**: `procurement_setting.committee_min_size` (default 3, check ≥ 2,
  clarification Q1). Scoring is blocked while `count(non-excluded, declared, no conflict)` is
  below the minimum.

## R23. PO and contract as one document with kinds

- **Decision**: `purchase_order` has `kind = 'po' | 'contract'` and numbering `PO` or `CON`.
  - **Created only from** an approved `bid_analysis`, one per awarded supplier. Lines are copied
    from `award_line` with an inherited budget line, location, and activity.
  - **Contract-only fields**: `scope_text`, `tor_attachment_id`, `start_date`, `end_date`,
    `contract_milestone` (deliverable, `pct` or `amount`, due date; Σ = 100% and
    Σ amount = total), and `performance_guarantee` (type, amount, expiry).
  - **Payment terms**: `advance_pct` and `retention_pct` (0–100), plus a `retention_release_date`
    rule.
  - **Service PO**: a PO for services (lines with unit "Person", like the RTHA catering at 80 ×
    16,775) uses a single completion certificate on its lines instead of GRNs. `po.is_service`
    is derived from the award's PR type and editable before approval.
- **Versions**: `purchase_order.version` starts at 1. Each approved `po_amendment` freezes the
  previous header and lines as a jsonb row in `purchase_order_version` and applies the
  after-values. Earlier versions are readable unchanged (US10-3, FR-051).
- **Acknowledgement**: `acknowledged_at`, `acknowledged_by_name`, and the attachment.
  `procurement_setting.require_po_acknowledgement` (default true) blocks GRN and SCC until it is
  set (FR-036).
- **Status machine**: draft → pending_approval → approved → acknowledged → partially_received →
  fully_received → closed, or cancelled. Closing is automatic when fully received and fully paid,
  or manual with a reason.

## R24. Receipt and completion

- **GRN**: `grn` and `grn_line` (delivered, accepted, rejected, reject reason, returned date,
  condition, `is_asset`).
  - Over-acceptance is checked under a lock on `po_line`:
    `accepted ≤ ordered × (1 + over_delivery_tolerance) − Σ accepted on completed GRNs`
    (FR-040).
  - The GRN completes when both signatures exist: `doc_signature` `received` and `inspected`,
    from different users (segregation policy).
  - PO status is recomputed in the same transaction. When it becomes fully received, a
    `supplier_rating_due` notification is created.
- **SCC**: `completion_certificate` (milestone or service PO, `completion_pct`, certified
  amount), with signatures `certified` and `confirmed` from different users. Payable for a
  milestone is ≤ `certified pct × milestone amount` − already requested (FR-043). Partial
  certificates are cumulative.

## R25. Invoices, payment requests, and three-way match

- **Supplier invoice**: unique index `(tenant_id, supplier_id, lower(btrim(supplier_invoice_no)))`
  (FR-054).
- **Payment request**: `payment_request.kind` is one of:
  - `order` (PO/contract, including advance and final payments);
  - `retention` (release);
  - `direct` (no PO, FR-061, numbered `DPR`);
  - `bid_security_return`.

  Order requests take their supplier, bank details, grant, and lines from the PO and never
  reserve or commit budget (clarification Q3).
- **Match** (pure `packages/shared/src/procurement/match.ts`), per line:
  - `invoiced_qty ≤ accepted_qty (GRN) × (1 + qty_tol)`;
  - `invoiced_price ≤ po_price × (1 + price_tol)`.

  For service lines the match is against the certified amount. Mismatches are stored per line.
  Submission is blocked (`MATCH_FAILED`) unless a `payment_match_override` row exists, created
  by a user with `payment:override_match`, with a reason. That user is not the preparer, so the
  segregation policy applies (FR-056).
- **Advance and retention** (FR-057):
  - An advance request is ≤ `advance_pct × PO total` − advances already requested.
  - Later payments deduct `advance_paid × (this gross ÷ PO total)`, rounded half-up, and the
    final payment clears the remainder.
  - Retention is `retention_pct × gross`, credited to retention payable, and released by a
    `retention` request after `retention_release_date`.
- **Concurrency** (FR-060, edge case): submit locks the `purchase_order` row `FOR UPDATE`, then
  checks Σ(gross of non-cancelled, non-rejected requests) + this ≤ PO total including amendments.
  Parallel submissions serialize on the PO lock, and only those that fit succeed. An integration
  test fires parallel submits.
- **Amount fields**: gross, deductions, net, amount in words, and the charge-to table are
  computed in `payment-request.service.ts` from shared helpers. The API schema has no writable
  amount fields (FR-058, US11-1).
- **Currency**: payment currency may differ from PO currency. The conversion uses 001 rate
  rules on the request date and stores the rate, date, and source. The money account's currency
  must equal the payment currency (`CURRENCY_MISMATCH`, FR-075).

## R26. Direct payments, advances, settlements

- **Direct payment request**: lines have a budget line, location, activity, and amount. The
  lifecycle is the PR one: reserve on submit, commit on approval, consume on posting. Categories
  come from the `payment_category` config, with a `procurement_only` flag that blocks
  submission (US15-3). Payees are a supplier, a staff payee, or other (name).
- **Staff payee**: `staff_payee` has an optional `membership_id`, names, and bank details. It is
  used for direct payments, advances, and the duplicate bank-account check (FR-012; spec
  assumption that HR is out of scope).
- **Advance**: `cash_advance` and `cash_advance_line`. It is reserved and committed like a PR
  and paid by a BPV/CPV debiting the staff-advance control account. Those lines carry the
  budget-line dimension but no `actual_grant_amount`, because the account type is `asset`
  (US16-3).
  - The overdue check (FR-081) runs on submit: is any posted advance of the payee older than
    `expected_settlement_date + advance_overdue_days` and not fully settled? If so, a `waiver`
    (`reason_category = 'overdue_advance'`) is required.
- **Settlement**: `advance_settlement` with lines (budget line, amount, receipt attachments).
  On posting a JV-type settlement voucher (`STL` numbering on the document; the voucher type is
  `JV`):
  - Dr expense per line and Cr staff advance (Actual is recorded);
  - the advance commitment for those lines is released `settled`;
  - the unused part is returned by a CRV (Dr cash, Cr staff advance), releasing the remaining
    commitment;
  - an extra amount is paid by a BPV/CPV (Dr staff advance, Cr cash) with a new reservation
    check.

  Lines lacking Available block the settlement (FR-080).

## R27. Receipts, JVs, transfers, exchange differences

- **BRV/CRV**:
  - Donor tranche: Cr grant funds received for that grant, using the control setting with
    `grant_id`.
  - Supplier refund, advance return, other income: generated from a small receipt form.
  - Bid-security cash deposits post a BRV/CRV on receipt and a BPV/CPV on return (clarification
    Q5). Other security types are tracked only.
- **JV**:
  - The reason is mandatory (`check`).
  - Lines may carry `actual_grant_amount` on expense accounts, and credits reduce Actual.
  - The budget lines touched are locked and Available is rechecked on approval and posting
    (US14-2).
- **Transfer (TRF)**:
  - Two money accounts are involved.
  - The source line is credited at the source currency's carrying rate, which is the rate of the
    latest posted entry for that account (`money_account_carrying_rate` view).
  - The destination line is debited at the entered conversion rate.
  - The base difference is posted to the exchange gain/loss control account, so the voucher
    balances (US14-3).
  - The conversion rate is stored with date and source, taken from a manual entry on the
    transfer and validated > 0.
- **Grant funding summary** (US14 and report 9): budget, Σ tranches received (credits to that
  grant's funds-received account), Σ Actual, and fund balance = received − actual.

## R28. Allocation and reconciliation (P3)

- **Allocation**: `allocation_template` and `allocation_line` (grant, budget line, pct;
  Σ = 100.00, effective from/to).
  - Applying the template to a posted expense voucher line creates a JV:
    - Cr the source budget line for the full amount;
    - Dr each target for pct × amount, half-up, with the last line taking the rounding residue.
  - Available is rechecked on every target, and the JV is linked to the source line (US17).
- **Bank reconciliation**:
  - `bank_statement`: money account, month, opening, closing, status `open | signed_off`.
  - `bank_statement_line`: date, description, amount, reference; entered or imported by
    exceljs/CSV, with the same preview pattern as 001 R12.
  - `reconciliation_match`: statement line ↔ voucher line, many-to-many with amounts.
  - Sign-off requires reconciled balance = closing balance. Reopening needs a reason, and
    matches are frozen while signed off (US18).

## R29. Scheduled notifications

- **Problem**: 001 notifications are written inside the acting transaction. 002 adds
  time-based events:
  - RFQ/tender deadline reached;
  - guarantee or supplier document expiring;
  - vetting due;
  - advance overdue;
  - retention release due.
- **Decision**: A Postgres function `app.emit_due_notifications()` (security definer, fixed
  `search_path`) inserts `notification` rows with a `dedupe_key`, for example
  `deadline:{eventId}` or `guarantee:{id}:{expiry}`. A unique partial index on
  `(tenant_id, user_id, dedupe_key)` makes reruns harmless.
  - It is scheduled with **pg_cron** every 15 minutes (Supabase supports the extension), in
    migration `0022_scheduled_notifications.sql`.
  - If pg_cron is unavailable, `apps/api` runs the same function every 15 minutes with a plain
    `setInterval`, guarded by `pg_try_advisory_lock` so only one machine runs it.
  - The function is also called lazily when My tasks or the notification list loads, so local
    dev needs no scheduler.
- **Generalization**: `notification` gains `doc_type`, `doc_id`, and `dedupe_key`; `pr_id`
  becomes nullable and stays filled for PR rows, so the 001 queries are unchanged. `kind` gets
  the new values (data model §9).
- **Alternatives considered**:
  - Supabase Edge Function cron (another runtime to deploy).
  - Computing only on read. Rejected: unread badges would not appear until someone opens a
    page.

## R30. My tasks generalized

- **Decision**: The view `my_task_candidates` (security invoker) unions:
  - pending `doc_approval_step` rows of every doc type;
  - unsigned committee declarations and signatures;
  - GRN/SCC awaiting the second signature;
  - opening records awaiting attendee signatures;
  - vouchers awaiting posting for holders of `voucher:post`.

  The service filters by eligibility with the same function used to approve. `GET /my-tasks`
  returns them grouped by type. `/prs/my-tasks` remains, with its 001 contract.
- **History**: `audit_history` gains `doc_type`/`doc_id`, filled by `audit.log_change` from the
  registry, alongside `pr_id`. `GET /:docs/:id/history` returns the 001 timeline shape for every
  type (US21-3).

## R31. Attachments

- **Decision**: Add a generic `doc_attachment` table (tenant, doc_type, doc_id, purpose, storage
  path, name, mime, size, uploader, `deleted_at`) and the private bucket `doc-attachments` at
  `{tenant}/{doc_type}/{doc_id}/{id}`.
  - Same limits and MIME allow-list as 001 R11: 10 MB per file, 20 per document.
  - `pr_attachment` is unchanged.
  - The storage RLS checks tenant + `app.can_read_doc`. For the `offer_scan` purpose it also
    checks `app.sourcing_opened`.
  - Attachments lock when the owning document leaves draft, except for documents whose
    attachments are *the act*, such as the signed PO acknowledgement, the received-by signed
    copy, and settlement receipts. Those are added through their specific action endpoints.

## R32. Opening data import

- **Decision**: `import_batch` (kind `opening_balances | budget_line_opening | open_pos |
  prior_transactions`, status `previewed | committed`, summary, file path). The two-step preview
  and commit flow reuses `budget-import.service` patterns (exceljs, text cells, Zod row schema).
  - Account opening balances and prior transactions become **posted** JV vouchers with
    `is_imported = true` and `import_batch_id`, balanced (US12-3). Nothing is written if they do
    not balance.
  - Budget-line actual to date becomes imported JV lines (Dr expense with the budget-line
    dimension / Cr opening balance equity).
  - Budget-line committed to date and open POs become `budget_commitment` rows with
    `source_doc_type = 'OPENING'` or imported `purchase_order` rows with
    `is_imported = true, status = 'approved'`.
  - Imported vouchers bypass the three-signature rule (signature action `imported`) but keep
    the balance, period (target period must be open), and immutability rules.

## R33. Closing periods

- **Decision**: `POST /periods/:id/close` lists unposted approved vouchers dated in the period
  and requires `confirm: true` after the warning (FR-065). Reopening requires `periods:manage`
  and `reason`, which is stored in `app.audit_comment` and the period's `reopen_reason`.
  Posting checks the period under `FOR SHARE` on the period row, so a concurrent close
  serializes.

## R34. Bank and cash book running balance

- **Decision**: The function `app.money_account_book(account_id, from, to)` returns posted lines
  with a window-function running balance in the account currency, starting from the opening
  balance plus everything before `from`.

## R35. Testing strategy (extends 001 R18)

- **Unit** (`apps/api/tests/unit`, `packages/shared` tests):
  - one named test per BR-1…BR-22: `business-rules-002.index.test.ts` maps each rule to its
    files;
  - segregation per doc type;
  - method resolution (US1-1 example);
  - band validation;
  - price scores (spec and workbook figures);
  - match and tolerance;
  - advance/retention math;
  - voucher generation (D5 table);
  - amount in words: 870,710.00 and 3,040,800.00 SDG in ar/en ("Eight Hundred Seventy Thousand
    Seven Hundred Ten Sudanese Pounds", "Three Million Forty Thousand Eight Hundred Sudanese
    Pounds").
- **Integration** (`apps/api/tests/integration`, local Supabase or the disposable dev project
  with `ALLOW_DB_TRUNCATE=1` as in 001):
  - sealed offers (D3);
  - commitment transitions for PO approval, amendment, cancel, close, payment, and reversal;
  - SC-004 concurrency: parallel PO approval, payment posting, and JV on one budget line with
    the last available amount. Exactly the ones that fit succeed and Available is ≥ 0;
  - parallel payment requests on one PO;
  - three-way match and override;
  - period lock and reopen;
  - voucher balance, immutability, reversal, and the currency/rate check;
  - trail completeness;
  - RLS isolation for every new table (the rls-lint test must pass with the new policies);
  - notifications dedupe.
- **Regression gate**: the full 001 unit, integration, and E2E suites run unchanged after the
  foundation phase (D1, D2, D7, D8 migrations).
- **E2E** (Playwright, `ar` and `en`):
  - `rtha-chain.spec.ts` extends `rtha-pr-0010.json` with the three bidders from sheet
    "Quotation Analysis", then: RFQ → offers → opening → committee → award → PO (870,710 SDG) →
    GRN (9 lines) → invoice → payment request → BPV posted. It asserts SC-001 and the budget
    line 10202 figures;
  - `bpv-35.spec.ts`: direct salary payment, printout fields (SC-008);
  - `advance-settlement.spec.ts`;
  - print text comparisons.

## R36. Prerequisite and constitution status

- **Finding 1**: 001 tasks T142 and T159–T166 are still open in
  `specs/001-grants-pr-foundation/tasks.md` (T143–T158 are done). The plan input requires
  T142–T166 green before 002 implementation starts, because the 002 E2E extends the RTHA PR 0010
  fixture (T160) and the demo seed (T159).
- **Finding 2**: `.specify/memory/constitution.md` is now **v1.2.0** (ratified 2026-11-14):
  Principle XI Accounting Integrity, expanded II, III, and VII, and the regression-gate
  workflow rule.
- **Decision**: The plan's Constitution Check covers v1.2.0, and the design satisfies it.
  Finishing 001 T142/T159–T166 remains a precondition for `/speckit-implement`. It does not
  block `/speckit-tasks`.
