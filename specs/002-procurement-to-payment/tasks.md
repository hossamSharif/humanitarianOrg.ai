---

description: "Task list for 002-procurement-to-payment"
---

# Tasks: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

**Input**: Design documents from `specs/002-procurement-to-payment/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10, R21–R36), data-model.md, contracts/
(rest-api.md, rls-and-permissions.md, posting-rules.md, print-layout.md), quickstart.md,
`.specify/memory/constitution.md` (v1.2.0)

**Tests**: INCLUDED. Constitution Principle X requires a named test for every business rule
(BR-1…BR-22), a segregation test per doc type, and end-to-end acceptance from real samples
(the RTHA chain and BPV-35). research R35 and the quickstart table name the suites. Within each
story, write the tests first and confirm they fail before implementing.

**Organization**: Phases follow the plan's implementation order (plan.md "Implementation Order"):
Foundation with the 001 regression gate → the P1 chain (US1 → US2 → US3 → US4 → US5 → US6 → US7 →
US11 → US12 → US13 → US19 reports 1–3) with the RTHA E2E gate → P2 stories → P3 stories →
Polish. Each migration file is written whole in the first phase that needs it, so it is applied
once (`migrate.ts` applies pending files by name).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: User story the task belongs to (US1–US21)
- Every task names its exact file path(s)

## Path Conventions

Monorepo as in 001: `apps/api/src/`, `apps/api/tests/{unit,integration}/`, `apps/web/src/`,
`apps/web/e2e/`, `packages/shared/src/`, `packages/shared/tests/`, `packages/database/`.
Workspace scope `@ngo/*`. New API document adapters live in `apps/api/src/services/doc-adapters/`.

## Conventions every task must follow

- All 001 conventions stay: `numeric(18,2)` money, `numeric(18,3)` quantity, `numeric(18,6)`
  rates, `numeric(5,2)` percentages and scores; decimal strings in JSON; decimal.js through
  `packages/shared/src/money/`; DD/MM/YYYY only via `packages/shared/src/format/date.ts`; every
  label in both `apps/web/src/messages/ar.json` and `en.json`; logical Tailwind properties only.
- Every new table: `tenant_id`, RLS in its creating migration via `app.setup_tenant_table`, the
  `audit.log_change` trigger, `created_at/updated_at/created_by`; policies only in the shapes of
  contracts/rls-and-permissions.md §1 with `(select app.current_tenant_id())`.
- **Computed fields are never accepted in request bodies**: Zod schemas use `.strict()`, so
  `gross`, `net`, `supplierId` on a GRN, price scores, rates on voucher lines, and similar are
  rejected (rest-api.md).
- Routes validate and delegate; business rules live in services; errors are
  `AppError(code, message, details?)` with the codes in rest-api.md "New error codes".
- Every state change runs in one `withTenantTx`, locking the document row first, then budget
  lines `FOR UPDATE` in ascending id order (001 R4). Every mutation uses the idempotency
  middleware and `expectedVersion`.
- Every approvable type goes through `document-workflow.service.ts` with a doc adapter; every
  separation-of-duties rule lives in `segregation.service.ts` only.
- Downstream documents copy supplier, grant, budget line, donor, location, and activity from
  their source in the service; the API never accepts them (BR-1, BR-2).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the implement-time gates and lay out the new module folders

- [X] T001 Verify the implement-time gates from quickstart.md "Prerequisites" and research R36: constitution v1.2.0 (Principle XI, regression-gate rule) is present in `.specify/memory/constitution.md` and committed; 001 tasks T142 and T159–T166 are checked in `specs/001-grants-pr-foundation/tasks.md` (002 extends `seed-demo.ts` and `rtha-pr-0010.json`); the `pg_cron` extension is enabled on the dev project or the R29 fallback is chosen. Record the result in `specs/002-procurement-to-payment/checklists/gates.md`
- [X] T002 [P] Create the shared module folders and barrels: `packages/shared/src/procurement/index.ts`, `packages/shared/src/accounting/index.ts`, `packages/shared/src/doc-types.ts` (empty export), and re-export them from `packages/shared/src/index.ts`; create `packages/shared/tests/procurement/` and `packages/shared/tests/accounting/`
- [X] T003 [P] Add empty i18n namespaces `procurement`, `suppliers`, `sourcing`, `analysis`, `orders`, `receiving`, `invoices`, `payments`, `vouchers`, `accounting`, `reports002`, `trail`, `documents` to `apps/web/src/messages/ar.json` and `apps/web/src/messages/en.json`
- [X] T004 [P] Add the navigation groups Procurement (Suppliers, RFQs, Tenders, Evaluations, POs & Contracts, Receiving), Finance (Invoices, Payment Requests, Direct Payments, Advances, Vouchers, Bank & Cash, Chart of Accounts, Periods), Reports, and Settings to the app shell in `apps/web/src/features/shell/`, each item hidden unless the user holds its read permission (`procurement:read`, `finance:read`, `reports:read`)

---

## Phase 2: Foundational (Blocking Prerequisites) + Regression Gate

**Purpose**: The generic document engine (D1), generalized commitments (D2), accounting setup
tables, numbering (D7), permissions and roles (D8), and the print kit (D9). Every later story
builds on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete **and** every 001
suite is green with no test-case edits (regression gate).

### Tests for the foundation ⚠️

- [X] T005 [P] Integration test `apps/api/tests/integration/doc-engine-compat.int.test.ts`: after 0012, every 001 PR step and signature row exists in `doc_approval_step`/`doc_signature` with the same ids; raw `insert into approval_action (…, pr_id, …)` and supabase-js `.from('pr_approval_step')` work through the compatibility views with `doc_type` defaulting to `'PR'`; update and delete on `doc_signature` are rejected; `app.doc_ref_check` rejects a step whose `(doc_type, doc_id)` parent does not exist; `app.block_delete_after_draft` rejects deleting a submitted document and allows deleting an unsubmitted draft (FR-093)
  - *Status (2026-11-17)*: passed 11/11 against the dev database (includes the lazy seed hooks)
- [X] T006 [P] Unit test `apps/api/tests/unit/segregation.service.test.ts`: one `it` per rule id in contracts/rls-and-permissions.md §3 (`creator_approves`, `same_user_two_steps`, `pr_creator_approves_award`, `receiver_is_inspector`, `certifier_is_confirmer`, `preparer_approves_payment`, `receiver_approves_payment`, `voucher_three_people`, `override_by_preparer`, `undeclared_member_scores`), each asserting `canSign` returns the rule as the reason code (SC-010)
- [X] T007 [P] Unit test `apps/api/tests/unit/document-workflow.service.test.ts` with an in-memory fake adapter: submit assigns a number on first submission only and materializes the route; approve checks eligibility + segregation and runs `onApproved` on the final step; reject/return require a reason; cancel calls `onReleased`; reassign requires `<type>:reassign` or `settings:manage`; `VERSION_CONFLICT` on a stale `expectedVersion`; approve on a document whose grant is Suspended is refused (FR-096)
- [X] T008 [P] Integration test `apps/api/tests/integration/budget-commitment-002.int.test.ts`: 001-style inserts without `source_doc_type` still work (`'PR'` default, `pr_id` copied to `source_doc_id`); check `(source_doc_type = 'PR') = (pr_id is not null)`; the partial unique index allows one open row per source × line × cycle plus any number of released rows; a split chain (release + remainder with `supersedes_id`) keeps `budget_line_balance` totals; the deferred guard raises `BUDGET_EXCEEDED` when Available would go below 0
  - *Status (2026-11-17)*: passed 7/7 against the dev database
- [X] T009 [P] Integration test `apps/api/tests/integration/numbering-002.int.test.ts`: `numbering_config`/`document_sequence` accept every registry code and reject an unknown one (FK); `PO-MAD-2026-0001` then `PO-MAD-2026-0002`; separate sequences per type, office, and year; a rolled-back transaction never reuses a number (FR-094)
  - *Status (2026-11-17)*: passed 5/5 against the dev database
- [X] T010 [P] Unit test `packages/shared/tests/permissions.test.ts`: the catalogue contains every code in rls-and-permissions.md §2; each seeded role in §4 has exactly its listed permissions; `org_admin` holds none of `award:approve`, `po:approve`, `waiver:approve`, `payment:check`, `payment:approve`, `voucher:check`, `voucher:approve`, `evaluation:score`, `evaluation:sign`, `advance:approve`, `grn:inspect`; the step-kind → permission map per DoA type matches §2
- [X] T011 [P] Unit test `apps/api/tests/unit/doc-attachment.service.test.ts`: 10 MB limit, MIME allow-list, ≤ 20 per document, path `{tenant}/{doc_type}/{doc_id}/{id}`, attachments locked once the document leaves draft except action purposes (`po_acknowledgement`, `received_by_copy`, `receipt`) (R31)

### Database migrations (sequential)

- [X] T012 Write `packages/database/migrations/0012_doc_engine.sql` per data-model §1: global `app.doc_type_registry (code text PK, table_name regclass, office_column text, approval_doc_type text null)` seeded with `PR, RFQ, TND, QA, WVR, PO, CON, AMD, GRN, SCC, INV, PAY, DPR, ADV, STL, BPV, CPV, BRV, CRV, JV, TRF` (DoA types `PR, AWARD, PO, CON, AMD, WAIVER, PAY, DPR, PV, RV, JV, ADV, STL`; null for GRN, SCC, INV, RFQ, TND); `doc_approval_step` (001 `pr_approval_step` columns with `doc_type`/`doc_id`, `kind` ∈ `finance_check | check | approval | final_approval`, `unique (doc_type, doc_id, cycle, step_order)`, indexes `(tenant_id, status)` and `(doc_type, doc_id)`); `doc_signature` (001 `approval_action` columns with `doc_type`/`doc_id`; actions add `committee_sign, declare_coi, attend, received, inspected, certified, confirmed, acknowledge_warning, override_match, post, reverse, imported`; insert-only via `app.block_modification`, update/delete revoked; unique partial `(doc_type, doc_id, cycle, user_id) where action = 'approve'`; unique `(doc_type, doc_id, user_id, action) where action in ('received','inspected','certified','confirmed','committee_sign','declare_coi','attend')`; reason-required check extended to `override_match` and `reverse`); `app.doc_ref_check()` BEFORE INSERT; copy PR rows with ids preserved, re-point FKs to the base tables, drop the old tables, create auto-updatable `security_invoker` views `pr_approval_step` and `approval_action` `with cascaded check option` and `alter column doc_type set default 'PR'`; `app.can_read_doc(doc_type, doc_id)` (stable security definer, `search_path = ''`); generalize the 0011 `app.approval_rule_check` (PR step 1 `finance_check`, PV/RV/JV step 1 `check`); `approval_rule.doc_type`, `numbering_config.doc_type`, `document_sequence.doc_type` checks → FKs to the registry; `notification` changes (`pr_id` nullable, add `doc_type`, `doc_id`, `dedupe_key`, check `(pr_id is not null) or (doc_type is not null and doc_id is not null)`, PR-fill trigger, unique partial `(tenant_id, user_id, dedupe_key) where dedupe_key is not null`); `audit_history` add `doc_type`, `doc_id` filled by `audit.log_change` from a per-table parent map + index `(doc_type, doc_id, occurred_at)`; `purchase_requisition.status` adds `in_procurement`, `closed`; `pr_line` adds `sourcing_status text not null default 'not_sourced'` (`not_sourced | in_sourcing | ordered | cancelled`) and `cancel_reason text null`; `doc_attachment` (purpose ∈ `general | offer_scan | po_acknowledgement | received_by_copy | receipt | publication_evidence | tor | guarantee | supplier_document | vetting_evidence | statement_import`) with private bucket `doc-attachments` and storage policies via `app.can_read_doc`; a seed-hook mechanism `app.tenant_seed_hook (seq smallint, fn regprocedure)` called by a replaced `app.bootstrap_tenant` after its 001 body, so later migrations register their own seeds; a generic `app.block_delete_after_draft()` BEFORE DELETE trigger function (same shape as 001's `app.pr_delete_only_unsubmitted_draft()`: raises `INVALID_STATE` with `restrict_violation` unless `old.status = 'draft'`, and also unless `old.number is null` for types numbered at submission; a status-only variant for GRN, SCC, and INV, which are numbered on creation), attached by each document-creating migration (FR-093, Principle I)
- [X] T013 Write `packages/database/migrations/0013_budget_commitment_generalize.sql` per research D2: add `source_doc_type text not null default 'PR'`, `source_doc_id uuid`, `source_line_id uuid null`, `supersedes_id uuid null` (self FK), `rate_to_grant numeric(18,6)`, `rate_date`, `rate_source`, `exchange_rate_id`; `pr_id` nullable with check `(source_doc_type = 'PR') = (pr_id is not null)` and a trigger copying `pr_id` into `source_doc_id`; replace unique `(pr_id, budget_line_id, cycle)` with partial unique `(source_doc_type, source_doc_id, budget_line_id, cycle) where status in ('reserved','committed')`; extend `release_reason` with `converted_to_po, po_closed, consumed_by_payment, amended, settled, reversal_restore`; index `(tenant_id, source_doc_type, source_doc_id)`; replace the 001 guard trigger with `app.assert_budget_line_available(budget_line_id)` (`budget − reserved − committed ≥ 0` for now; 0019 adds Actual) called from a deferred constraint trigger on `budget_commitment`; extend `exchange_rate_locked_when_used()` to read an `app.exchange_rate_usage` view (union of ⟨rate⟩ columns, extended by later migrations)
- [X] T014 Write `packages/database/migrations/0014_accounting_setup.sql` per data-model §6: `gl_account` (`parent_id` self FK whose parent must have `is_posting = false`; `code text` unique per tenant; `type` ∈ `asset | liability | fund_balance | income | expense` inherited from the parent by trigger; `is_posting`, `is_active`); `budget_category_account` unique `(tenant_id, category)` → `expense_account_id`; `budget_line.expense_account_id uuid null` FK `gl_account` (posting, type `expense`); `money_account` (`kind` ∈ `bank | cash`, `currency`, `office_id`, `gl_account_id` asset posting **unique**, `custodian_user_id`, `opening_balance`, `opening_date`, `is_active`); `control_account_setting` (`key` ∈ `staff_advances | supplier_advances | retention_payable | grant_funds_received | exchange_gain_loss | opening_balance_equity | suspense`, `grant_id null` only for `grant_funds_received`, unique `(tenant_id, key, grant_id)` nulls not distinct); `accounting_period` (`year smallint`, `month smallint 1..12` unique per tenant, `status` ∈ `open | closed`, `closed_at/by`, `reopened_at/by`, `reopen_reason` required when reopening); `app.seed_accounting_defaults(tenant)` registered as a seed hook (default chart per data-model §11 item 5, control settings, category mappings, current and next month open) and run for existing tenants
- [X] T015 Write `packages/database/migrations/0021_bootstrap_002.sql` (only 001 tables + the registry, so it can be applied now): `app.seed_doc_defaults_002(tenant)` registered as a seed hook and backfilled for existing tenants, seeding the D8 permission catalogue, the eight new roles with the exact permission sets in rls-and-permissions.md §4 (plus `advance:request` on `requester` and the `viewer` additions), `numbering_config` for every new code (prefix = code, `{prefix}-{OFFICE}-{YYYY}-{seq:4}`), and the default org-wide DoA rules from research D8 (Award/PO/CON/AMD/WAIVER: `approval` FM → `final_approval` CD; PAY/DPR: `finance_check` FM → `final_approval` CD; PV/RV/JV: `check` FM → `final_approval` CD; ADV/STL: `approval` FM)
  - *Implementation note (2026-11-16)*: seed hooks run **lazily**, not inside `app.bootstrap_tenant`: the registering migration backfills existing tenants, and a new tenant gets them the first time a 002 command runs (`app.ensure_tenant_seeds()`, called by `docWorkflowFor`). Seeding at creation would break the 001 `org-setup.int.test.ts` count of 5 roles / 1 rule, and the regression gate forbids test edits (decision by the user). The accounting chart adds a `14 Suspense` posting account for the `suspense` control key, which data-model §11 item 5 does not list.
- [ ] T016 Update the TRUNCATE list in `apps/api/tests/integration/helpers/setup.ts` to name the base tables `doc_approval_step` and `doc_signature` instead of the views (the only allowed 001 test-support change), then apply 0012–0014 and 0021 with `pnpm --filter @ngo/database migrate` (or Supabase MCP `apply_migration`) and regenerate `packages/database/src/types.ts` with `pnpm --filter @ngo/database gen:types`
  - *Status (2026-11-17)*: TRUNCATE list updated and 0012–0014 + 0021 applied to the dev database; `gen:types` still open (needs `SUPABASE_PROJECT_ID` and a Supabase login)
- [X] T017 Run `pnpm --filter @ngo/database test` and make `packages/database/tests/rls-lint.test.ts` pass for every new table and helper (no policy without the tenant check)

### Shared package

- [X] T018 [P] Implement `packages/shared/src/doc-types.ts`: registry codes, DoA types and the code → DoA type map, state enums per document (data-model §12), and `DocTypeSlug` ↔ route path (`bid-analyses`, `waivers`, `pos`, `contracts`, `amendments`, `payment-requests`, `direct-payments`, `advances`, `settlements`, `vouchers`)
- [X] T019 [P] Extend `packages/shared/src/permissions.ts` with the catalogue in rls-and-permissions.md §2, the seeded role matrix §4, and `stepPermission(doaType, stepKind)` (§2 table)
- [X] T020 [P] Add every new error code from rest-api.md "New error codes" (with their `details` types) to `packages/shared/src/errors.ts`, and extend `SEGREGATION_OF_DUTIES.details.rule` with the §3 rule ids
- [X] T021 [P] Add `packages/shared/src/schemas/doc-actions.ts` (`.strict()` bodies for submit, approve, reject, return, cancel, reassign; history item; attachment upload/complete) and `packages/shared/src/schemas/doc-attachment.ts`
- [X] T022 [P] Implement `packages/shared/src/accounting/rates.ts` (pure): `halfUp2`, `toBase(amount, rate)`, `convert(amount, fromRate, toRate)`, and rate snapshot type `{ rateToBase, rateDate, rateSource, exchangeRateId }`; unit tests in `packages/shared/tests/accounting/rates.test.ts`

### API engine

- [X] T023 [P] Add repositories `apps/api/src/repositories/doc-approval-step.repository.ts`, `doc-signature.repository.ts` (insert/select only), `doc-attachment.repository.ts`; repoint `pr-approval-step.repository.ts` and `approval-action.repository.ts` only if the PostgREST view inserts misbehave (plan Risks fallback, code change only)
- [X] T024 Implement `apps/api/src/services/segregation.service.ts`: one policy per doc type exporting `canSign(doc, user, stepKind, priorSignatures) → { ok } | { rule }` for every rule in rls-and-permissions.md §3; re-express the 001 PR creator and one-step-per-user rules as the PR policy (makes T006 pass)
- [X] T025 Generalize step eligibility in `apps/api/src/services/approval-routing.service.ts`: a user is eligible only when they hold the step role, the role grants `stepPermission(doaType, kind)`, they have office access, and `segregation.service` allows it; `routeFor/pickRule` unchanged
- [X] T026 Implement `apps/api/src/services/document-workflow.service.ts` from `pr-workflow.service.ts`: submit/approve/reject/return/cancel/reassign for any doc type through an adapter interface `{ loadForUpdate, doaAmount, officeId, creatorId, segregationPolicy, onSubmit, onApproved, onReleased, notificationParams }` in `apps/api/src/services/doc-adapters/types.ts`; DoA amount and rate locked at submission (001 R7); notifications `doc_action_required/approved/rejected/returned/cancelled/reassigned`; before signing any step, refuse with the 001 frozen-grant error when the adapter's grant is Suspended or Closed (FR-096), letting only PAY/DPR pass with a Finance Manager override carrying a reason (`frozen_grant_override`) (makes T007 pass)
- [X] T027 Turn `apps/api/src/services/pr-workflow.service.ts` into a thin PR adapter `apps/api/src/services/doc-adapters/pr.adapter.ts` over `document-workflow.service.ts`, keeping `prs.routes.ts` and the 001 PR contract unchanged
- [X] T028 Generalize `apps/api/src/repositories/budget-commitment.repository.ts` and `apps/api/src/services/budget.service.ts` with source-doc primitives: `reserve`, `commit`, `release(reason)`, `splitConsume(rowId, amountGrant, reason)` (release + remainder row with `supersedes_id`), `restore(consumedRowId)` (`reversal_restore`), and `shortfallFor(lines)` computed under the locks (makes T008 pass)
- [X] T029 [P] Generalize `apps/api/src/services/numbering.service.ts` and `apps/api/src/repositories/numbering.repository.ts` to any registry code with the document's office (makes T009 pass)
- [X] T030 [P] Generalize `apps/api/src/services/notification.service.ts` and `apps/api/src/repositories/notification.repository.ts` to `doc_type`/`doc_id` and `dedupe_key` (insert `on conflict do nothing`); PR notifications unchanged
- [X] T031 [P] Add `apps/api/src/services/doc-history.service.ts` (001 timeline shape for any `(doc_type, doc_id)` from `audit_history` + `doc_signature`) next to the unchanged `pr-history.service.ts`
- [X] T032 [P] Implement `apps/api/src/services/doc-attachment.service.ts` (signed upload/download URLs in bucket `doc-attachments`, limits per R31) (makes T011 pass)
- [X] T033 Add the shared route factory `apps/api/src/routes/document-actions.ts` that mounts, for a doc slug, `POST /:id/submit|approve|reject|return|cancel`, `POST /:id/steps/:stepId/reassign`, `GET /:id/history`, `GET /:id/trail` (stub until US19), and the attachment endpoints, with `availableActions[]` and per-step `canApprove/canReject/canReturn` helpers for detail responses

### Web foundation

- [X] T034 Extract `apps/web/src/features/print-kit/` from `apps/web/src/features/pr/print/`: `fonts.ts`, `styles.ts`, `<DocHeader>`, `<InfoGrid>`, `<ItemTable>` (repeat header, `row-reverse` in ar), `<Totals>` (words in both languages), `<SignatureBlocks>`, `<Watermark>`, `<PaidStamp>`, `<WaiverBadge>`, `<Footer>`; every Arabic `Text` keeps `direction: 'rtl'`; refactor `apps/web/src/features/pr/print/pr-document.tsx` onto the kit with identical output (001 PR print test stays green)
- [X] T035 [P] Generalize the PR document widgets into `apps/web/src/features/documents/`: `actions-panel.tsx`, `steps-view.tsx`, `history-timeline.tsx`, `attachments-panel.tsx`, `status-badge.tsx`, `reason-dialog.tsx`, `reassign-step-dialog.tsx`, and `api.ts` (generic doc action hooks with TanStack Query), keeping `features/pr/*` working through thin wrappers

### Regression gate

- [X] T036 Run the regression gate from quickstart.md: `pnpm lint && pnpm type-check`, `pnpm --filter @ngo/api test:unit`, `pnpm --filter @ngo/api test:integration`, `pnpm --filter @ngo/database test`, `pnpm --filter @ngo/web e2e -- rtha-pr-0010`; every 001 suite green with no test-case edits; PR print byte-identical. Commit the phase
  - *Status (2026-11-17)*: lint and type-check clean (shared, api, web); api unit 354/354 (the 317 from 001 plus 37 new); shared 181/181; database rls-lint 4/4; api integration 21/21 files, 123/123 tests (all 18 files of 001, 100 tests, unchanged; plus T005/T008/T009); pr-history needed one rerun after the pooler dropped the connection mid-test (CONNECTION_CLOSED), then 4/4; PR print byte-identical in ar and en (PDF bytes compared with CreationDate masked); e2e `rtha-pr-0010` not run: the spec does not exist yet (001 T161 open)

**Checkpoint**: Foundation ready, 001 unchanged. User story work can begin.

---

## Phase 3: User Story 1 — Procurement configuration (Priority: P1) 🎯 MVP

**Goal**: Admins configure method bands with grant overrides, tolerances, committee size,
deductions, payment and supplier categories; defaults are seeded for every organization.

**Independent Test**: Create a new organization, confirm the defaults are seeded, edit bands and
a grant rule, and confirm `resolve-method` for a sample PR value reflects the stricter rule.

### Tests for User Story 1 ⚠️

- [ ] T037 [P] [US1] Unit test `packages/shared/tests/procurement/method.test.ts`: org RFQ band (1000, 25000] + grant RFQ band from 500 → 800 USD requires `rfq` (US1-1); `min_quotations` = max of tenant and grant minimum; bands with a gap or an overlap return `{ gaps, overlaps }` (US1-2); band set must start at 0 and have an open top; method ranks direct 1 < rfq 2 < tender 3
- [ ] T038 [P] [US1] Unit test `apps/api/tests/unit/procurement-config.service.test.ts`: `committee_min_size` below 2 rejected; tolerances outside 0–100 rejected; `PROCUREMENT_BANDS_INVALID` with details; deduction `payable_account_id` must be a liability posting account
- [ ] T039 [P] [US1] Integration test `apps/api/tests/integration/procurement-config.int.test.ts`: a newly bootstrapped tenant has the seeded settings, bands `(0,1000] direct 1; (1000,25000] rfq 3; (25000,∞) tender 3`, deduction types, payment categories, and supplier categories (US1-3); editing bands is recorded in `audit_history` and does not change a stored `sourcing_event.method_snapshot` (US1-4); `POST /procurement-settings/resolve-method` returns `{ estimatedValue, currency, requiredMethod, minQuotations, bandsUsed }` from the PRs' locked rates

### Implementation for User Story 1

- [ ] T040 [US1] Write `packages/database/migrations/0015_procurement_config_suppliers.sql` per data-model §2 and §3: `procurement_setting` (one row per tenant; `invoice_price_tolerance_pct`, `invoice_qty_tolerance_pct`, `grn_over_delivery_tolerance_pct` numeric(5,2) default 0 check 0–100; `committee_min_size smallint default 3 check >= 2`; `revetting_months default 12 ≥ 1`; `guarantee_warning_days default 30 ≥ 1`; `advance_overdue_days default 30 ≥ 0`; `require_po_acknowledgement boolean default true`; `splitting_window_days default 30`); `procurement_method_band` and `grant_procurement_rule` (`method` ∈ `direct | rfq | tender`, `(min_amount, max_amount]` null min = 0 null max = ∞, `min_quotations ≥ 1`) with a deferred validity trigger like 0011; `deduction_type` (`rate_pct` 0–100, `applies_to` ∈ `goods | services | both`, `payable_account_id` FK `gl_account`); `payment_category` (`code`, names, `procurement_only boolean`, `is_active`); `supplier`, `supplier_category`, `supplier_category_link`, `supplier_document`, `supplier_vetting` (insert-only), `supplier_rating` (unique per `po_id`; FK to `purchase_order` added in 0017), `staff_payee` with the normalized-index rules and checks of §3 (incl. `status_reason` required when status ∈ {suspended, blacklisted}); view `supplier_compliance`; function `supplier_duplicates(supplier_id)`; `app.seed_procurement_defaults(tenant)` registered as a seed hook and backfilled (settings, bands, "Withholding tax – goods/services" 0%, payment categories salary…tax_remittance false + goods true, supplier categories stationery, food, construction, transport, it, fuel, other); apply it and regenerate types
- [ ] T041 [P] [US1] Implement `packages/shared/src/procurement/method.ts` (pure, decimal.js): `validateBands(bands) → { gaps, overlaps }`, `resolveProcurementMethod({ lines, tenantBands, grantBands }) → { estimatedValue, requiredMethod, minQuotations, bandsUsed }` per research D4 (makes T037 pass)
- [ ] T042 [P] [US1] Add `packages/shared/src/schemas/procurement-config.ts`: settings, bands `{ bands: [{ method, minAmount?, maxAmount?, minQuotations }] }`, grant rules, deduction type, payment category, supplier category, resolve-method request/response
- [ ] T043 [P] [US1] Add repositories `apps/api/src/repositories/procurement-setting.repository.ts`, `method-band.repository.ts` (tenant and grant sets), `deduction-type.repository.ts`, `payment-category.repository.ts`, `supplier-category.repository.ts`
- [ ] T044 [US1] Implement `apps/api/src/services/procurement-config.service.ts` (settings, bands full replace with validation, grant rules, deductions, categories, `resolveMethod(prLineIds)` using the PRs' locked rates) (makes T038 pass)
- [ ] T045 [US1] Add `apps/api/src/routes/procurement-settings.routes.ts` (`/procurement-settings`, `/procurement-settings/method-bands`, `/procurement-settings/resolve-method`, `/deduction-types`, `/payment-categories`, `/supplier-categories`) and `GET/PUT /grants/:id/procurement-rules` in `apps/api/src/routes/grants.routes.ts`, with permissions `procurement:read` / `procurement:configure` / `accounts:manage` (deductions); register in `apps/api/src/routes/index.ts` (makes T039 pass)
- [ ] T046 [US1] Allow the new DoA types in `GET/PUT /approval-rules?docType=` and `/numbering/:docType` (`apps/api/src/services/approval-rule.service.ts`, `apps/api/src/services/numbering.service.ts`, `packages/shared/src/schemas/approval-rule.ts`, `numbering.ts`)
- [ ] T047 [P] [US1] Build `apps/web/src/app/[locale]/(app)/settings/procurement/page.tsx` with `apps/web/src/features/procurement-settings/` (settings form, bands editor showing gaps/overlaps inline, deductions table, payment and supplier categories)
- [ ] T048 [P] [US1] Add a "Procurement rules" tab on `apps/web/src/app/[locale]/(app)/grants/[id]/page.tsx` (grant band editor, same component), and the new doc types in the approval-rules and numbering screens under `apps/web/src/features/approval-rules/` and `apps/web/src/app/[locale]/(app)/setup/numbering/`
- [ ] T049 [US1] Add `procurement` namespace strings (ar + en) in `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US1 independently testable.

---

## Phase 4: User Story 2 — Supplier registry and vetting (Priority: P1)

**Goal**: One vetted supplier list with documents, vetting, status, duplicate warnings, and
eligibility used by invitation, award, and payment.

**Independent Test**: Register, vet, and approve a supplier; let a document expire; blacklist
another; confirm warning and blocking behaviour in the supplier picker and eligibility check.

### Tests for User Story 2 ⚠️

- [ ] T050 [P] [US2] Unit test `apps/api/tests/unit/supplier.service.test.ts`: status machine `pending_vetting → approved → suspended | blacklisted` and back to `approved` only with current vetting; Suspended/Blacklisted without reason → `REASON_REQUIRED` (US2-5); approval requires a `clear` vetting within `revetting_months` and `suppliers:vet` (FR-010); `eligibility(supplier, purpose)` returns `SUPPLIER_NOT_ELIGIBLE` reasons `not_approved | blacklisted | vetting_overdue | expired_document` for award/pay and only a warning for invite (US2-1, US2-4)
- [ ] T051 [P] [US2] Integration test `apps/api/tests/integration/suppliers.int.test.ts`: `duplicateWarnings[]` for the same normalized registration no, tax no, phone, or bank account across suppliers and `staff_payee` (US2-3), never a block; `supplier_compliance` flags an expired required document and overdue vetting; blacklisted suppliers are excluded from `GET /suppliers?compliance=eligible`; `supplier_vetting` update/delete rejected

### Implementation for User Story 2

- [ ] T052 [P] [US2] Add `packages/shared/src/schemas/supplier.ts` (supplier create/patch, status change `{ status, reason?, expectedVersion }`, document, vetting, rating, staff payee, list filters `?status=&categoryId=&q=&compliance=`)
- [ ] T053 [P] [US2] Add repositories `apps/api/src/repositories/supplier.repository.ts` (incl. `supplier_compliance` and `supplier_duplicates`), `supplier-document.repository.ts`, `supplier-vetting.repository.ts`, `staff-payee.repository.ts`
- [ ] T054 [US2] Implement `apps/api/src/services/supplier.service.ts` (CRUD, status changes with reasons, documents, vetting insert-only, `eligibility(supplierId, 'invite'|'award'|'pay')` used by later stories, waiver lookup hook for `expired_document`) (makes T050 pass)
- [ ] T055 [P] [US2] Implement `apps/api/src/services/staff-payee.service.ts` (CRUD, duplicate check shared with suppliers)
- [ ] T056 [US2] Add `apps/api/src/routes/suppliers.routes.ts` (`/suppliers`, `/:id`, `/:id/status`, `/:id/documents`, `/:id/vettings`) and `apps/api/src/routes/staff-payees.routes.ts`; permissions per rest-api.md; register in `apps/api/src/routes/index.ts` (makes T051 pass)
- [ ] T057 [P] [US2] Build supplier screens `apps/web/src/app/[locale]/(app)/procurement/suppliers/page.tsx` (list with status/compliance filters) and `.../suppliers/[id]/page.tsx` (details, bank details, categories, documents with expiry badges, vetting records with evidence upload, status dialog with reason, duplicate-warning banner shown to Finance, ratings average) in `apps/web/src/features/suppliers/`
- [ ] T058 [P] [US2] Build `apps/web/src/features/suppliers/supplier-picker.tsx` (never lists blacklisted suppliers; shows warning badges for non-compliant ones) and `apps/web/src/app/[locale]/(app)/finance/staff-payees/page.tsx`
- [ ] T059 [US2] Add `suppliers` namespace strings (ar + en)

**Checkpoint**: US2 independently testable.

---

## Phase 5: User Story 3 — Request for Quotation from approved PRs (Priority: P1)

**Goal**: Create, configure, and issue an RFQ from approved PR lines of one grant, with method
proposal, criteria, invitations, and PR-line exclusivity.

**Independent Test**: From approved RTHA PR 0010 create an RFQ with all 9 lines, see the RFQ
method proposed, block issuing at 90% weights, and confirm a PR line in an open RFQ is not
selectable.

### Tests for User Story 3 ⚠️

- [ ] T060 [P] [US3] Unit test `apps/api/tests/unit/sourcing.service.test.ts`: PR lines of two grants or two offices → `MIXED_GRANTS` (US3-5); only approved PR lines; issue blocked with `CRITERIA_WEIGHTS_INVALID` (details `{ stage, total }`) at 90% (US3-2); fewer invited approved suppliers than `required_min_quotations` → `TOO_FEW_SUPPLIERS` unless an approved waiver covers the event (US3-4); `chosen_method` rank below required → `METHOD_BELOW_REQUIRED` without a waiver (FR-016); a present splitting warning without acknowledgement → `SPLITTING_ACK_REQUIRED`
- [ ] T061 [P] [US3] Integration test `apps/api/tests/integration/sourcing.int.test.ts`: RFQ from the 9-line PR links every sourcing line to its PR line and proposes `rfq` from 870,710 SDG at the PR's locked rate (US3-1); the partial unique index rejects a second open event for the same PR line with `PR_LINE_ALREADY_SOURCING` (US3-3); PR lines become `in_sourcing` and the PR `in_procurement`; cancel returns lines to `not_sourced`; re-issue creates a new draft with `reissued_from_id` and moves the lines; two 600 USD PRs (same office, grant, budget-line category, within 30 days) sourced as Direct return `splittingWarning` (US10-5, FR-053) and the acknowledgement comment is stored as an `acknowledge_warning` signature
- [ ] T062 [P] [US3] Unit test `apps/api/tests/unit/rfq-print.service.test.ts`: the RFQ-to-supplier print data has no offers, no other supplier names, and no prices, and its Zod schema rejects such keys (US20-2)

### Implementation for User Story 3

- [ ] T063 [US3] Write `packages/database/migrations/0016_sourcing.sql` per data-model §4 (all sourcing, offer, analysis, award, and waiver tables, including the tender-only ones, so the unified model is applied once): `sourcing_event` (⟨doc⟩; `kind` ∈ `rfq | tender`; `grant_id` equal to every linked PR's grant by trigger; one `office_id`; `submission_deadline > issue_date`; `required_method`, `required_min_quotations`, `chosen_method`, `estimated_value_doa`, `method_snapshot jsonb`, `splitting_warning jsonb null`, `opened_at` settable only by the opening command, `reissued_from_id` self FK, tender fields); `sourcing_line` with **unique partial index `(pr_line_id) where is_open`** and the trigger maintaining `is_open`; `sourcing_criterion` (`stage` ∈ `single | technical | financial`, `kind` ∈ `essential | weighted`, `weight_pct numeric(5,2) null`, exactly one `is_price` per weighted price stage); `sourcing_invitation` (unique `(event, supplier)`, `channel` ∈ `email | whatsapp | in_person | newspaper | website | notice_board`); `tender_lot`, `tender_publication`, `tender_clarification`; `offer` (status ∈ `logged | replaced | late | late_accepted | withdrawn | disqualified`, unique partial `(event, supplier) where status in ('logged','late_accepted')`, trigger `received_at > submission_deadline ⇒ status = 'late'`); **sealed** `offer_terms` and `offer_line_price` (`unit_price ≥ 0`, generated `line_total`, quantity default copied on insert) with select and insert policies `tenant_id = … and app.sourcing_opened(event) and app.may_see_offer_prices(event)` (insert also `offer.status not in ('late','replaced')`), delete revoked, `OFFER_FROZEN` update trigger; `opening_record` (unique per event) + `opening_attendee`; `bid_security` (voucher FKs added in 0019); `bid_analysis` (⟨doc⟩ ⟨doa⟩, unique per event where status ≠ cancelled, `comparison_rates jsonb`, `justification_criterion_ids uuid[]`, `frozen_at`); `committee_member` (unique `(analysis, user)`), `evaluation_score` (`score smallint 1..5`, unique on the four ids), `analysis_result`, `award_line` (supplier = offer supplier by trigger, generated `amount`), `unsuccessful_notice`; `waiver` (⟨doc⟩ ⟨doa⟩, `reason_category` ∈ `single_source | emergency | fewer_quotations | lower_method | expired_document | overdue_advance | other`, `justification text not null`, `covered_doc_type`, `covered_doc_id`); helpers `app.sourcing_opened`, `app.may_see_offer_prices`; storage policy requiring `app.sourcing_opened` for `offer_scan`; office-scoped RLS for documents; registry rows' `table_name` updated; attach `app.block_delete_after_draft` to `sourcing_event`, `bid_analysis`, `waiver`; apply it and regenerate types
- [ ] T064 [P] [US3] Add `packages/shared/src/schemas/sourcing.ts`: RFQ create `{ prLineIds[], title, … }`, patch (lines reword/group, criteria, invitations, chosen method), issue `{ expectedVersion, splittingAcknowledgement?: { comment } }`, sourceable PR lines query; the RFQ-to-supplier print schema with no offer/price keys
- [ ] T065 [P] [US3] Add repositories `apps/api/src/repositories/sourcing-event.repository.ts` (incl. the anti-splitting query per research D4), `sourcing-line.repository.ts`, `sourcing-criterion.repository.ts`, `sourcing-invitation.repository.ts`, `waiver.repository.ts` (`hasApprovedWaiver(coveredType, coveredId, categories[])`)
- [ ] T066 [US3] Implement `apps/api/src/services/sourcing.service.ts` (create from PR lines with one grant/office, method snapshot via `resolveProcurementMethod`, draft edits, `issue` with all data-model §4 guards and number `RFQ`, cancel with reason, re-issue) and update `pr_line.sourcing_status` / PR status in the same transaction (makes T060, T061 pass)
- [ ] T067 [US3] Add `apps/api/src/routes/rfqs.routes.ts` (`GET /sourcing/pr-lines`, `GET/POST /rfqs`, `GET/PATCH /rfqs/:id`, `POST /rfqs/:id/issue|reissue|cancel`, `GET /rfqs/:id/history`) with `rfq:create` / `rfq:issue` / `procurement:read`; register in `apps/api/src/routes/index.ts`
- [ ] T068 [P] [US3] Implement RFQ print data `apps/api/src/services/print/rfq-print.service.ts` + `GET /rfqs/:id/print?supplierId=&locale=` and template `apps/web/src/features/sourcing/print/rfq-document.tsx` on the print kit (one addressee supplier per print) (makes T062 pass)
- [ ] T069 [P] [US3] Build RFQ screens in `apps/web/src/features/sourcing/` and `apps/web/src/app/[locale]/(app)/procurement/rfqs/{page.tsx,new/page.tsx,[id]/page.tsx}`: PR-line picker (only `not_sourced`, one grant), method proposal panel with bands used, criteria editor showing per-stage totals, invitations with channel and compliance warnings, splitting-warning acknowledgement dialog, issue/cancel/re-issue actions
- [ ] T070 [P] [US3] Show each PR line's sourcing status (Not sourced, In RFQ/Tender, Ordered, Cancelled) and the PR statuses In Procurement / Closed in `apps/web/src/features/pr/pr-lines-view.tsx` and `pr-status-badge.tsx`
- [ ] T071 [US3] Add `sourcing` namespace strings (ar + en)

**Checkpoint**: US3 independently testable.

---

## Phase 6: User Story 4 — Record quotations and open them (Priority: P1)

**Goal**: Receipt log before the deadline, a witnessed opening after it, then prices, terms,
compliance, and scans; late quotations excluded unless accepted.

**Independent Test**: Log three receipts, prove no price or scan can be entered or seen by any
role, record the opening after the deadline, enter prices, and verify late offers are excluded.

### Tests for User Story 4 ⚠️

- [ ] T072 [P] [US4] Integration test `apps/api/tests/integration/sealed-offers.int.test.ts`: before `opened_at`, with the `org_admin`, procurement officer, and creator JWTs, `select count(*)` on `offer_terms` and `offer_line_price` = 0 and `insert` fails with an RLS violation; `GET /rfqs/:id`, the list, print, and search contain no price fields; `scan-upload-url` → `409 SOURCING_NOT_OPENED`; opening before the deadline (DB clock) → `DEADLINE_NOT_PASSED`; after the opening everything works (SC-009, US4-1, US4-3)
- [ ] T073 [P] [US4] Unit test `apps/api/tests/unit/opening.service.test.ts`: < 2 attendees on an RFQ → `TOO_FEW_ATTENDEES`; a late offer is excluded unless `acceptLate` carries a reason (`late_accepted`) (US4-4); a corrected receipt before the deadline sets the previous one `replaced` and only the latest accepts terms; fewer valid offers than the minimum after opening flags evaluation as needing a waiver or re-issue (US4-2, FR-022)

### Implementation for User Story 4

- [ ] T074 [P] [US4] Extend `packages/shared/src/schemas/sourcing.ts` with offer receipt `{ supplierId, receivedAt, receivedById }` (`.strict()`), open `{ expectedVersion, attendees: [{ userId?, externalName?, function }], acceptLate: [{ offerId, reason }] }`, and terms `{ currency, deliveryDays, validityDays, paymentTerms, essentialCompliance, linePrices: [{ sourcingLineId, unitPrice, quantity? }] }`
- [ ] T075 [P] [US4] Add repositories `apps/api/src/repositories/offer.repository.ts`, `offer-terms.repository.ts`, `offer-line-price.repository.ts`, `opening-record.repository.ts` (sealed tables read through the user-scoped client so RLS applies)
- [ ] T076 [US4] Implement `apps/api/src/services/opening.service.ts`: log receipt (invited supplier only, replacement chain), `open` (lock event, `select now() >= submission_deadline`, attendees, late decisions, set `opened_at`, status `opened`), enter terms/prices (`SOURCING_NOT_OPENED` guard before the DB), scan upload URL with purpose `offer_scan` (makes T072, T073 pass)
- [ ] T077 [US4] Add offer endpoints to `apps/api/src/routes/rfqs.routes.ts`: `POST /rfqs/:id/offers`, `POST /rfqs/:id/open`, `PUT /rfqs/:id/offers/:offerId/terms`, `POST /rfqs/:id/offers/:offerId/scan-upload-url` (`rfq:create` / `rfq:open`)
- [ ] T078 [P] [US4] Build in `apps/web/src/features/sourcing/`: receipt-log panel (no price inputs exist before the opening), opening dialog (attendees, late acceptance with reasons, disabled before the deadline), per-offer terms and line-price form after the opening, scan upload; wire into `apps/web/src/app/[locale]/(app)/procurement/rfqs/[id]/page.tsx`
- [ ] T079 [US4] Add the receipt/opening strings to the `sourcing` namespace (ar + en)

**Checkpoint**: US4 independently testable.

---

## Phase 7: User Story 5 — Quotation analysis, committee, and award (Priority: P1)

**Goal**: Automatic comparison, committee with conflict-of-interest declarations, calculated
scores, justified recommendation, committee signatures, and a DoA-approved award.

**Independent Test**: With three opened quotations, seat a committee, declare and score, sign,
approve the award, and verify calculated scores, segregation, and justification rules.

### Tests for User Story 5 ⚠️

- [ ] T080 [P] [US5] Unit test `packages/shared/tests/procurement/scoring.test.ts`: 870,710 / 910,000 / 1,020,000 at price weight 50% → 50.00 / 47.84 / 42.68 (US5-1); RTHA bidders 870,710 / 906,300 / 1,000,600 → 50.00 / 48.04 / 43.51; non-price points = weight × average ÷ 5 rounded half-up 2 dp; weighted total = Σ rounded points; an essential fail disqualifies with the reason; split award scores price per line; tender two-stage only scores compliant bids financially
- [ ] T081 [P] [US5] Unit test `apps/api/tests/unit/analysis.service.test.ts`: an undeclared member gets `DECLARATION_REQUIRED` on scores (US5-5); a declared conflict excludes the member and below `committee_min_size` scoring → `COMMITTEE_TOO_SMALL` (US5-4); recommendation ≠ highest without justification and ≥ 1 criterion → `JUSTIFICATION_REQUIRED` on sign (US5-3); split recommendation when the RFQ disallows it → `SPLIT_AWARD_NOT_ALLOWED`; price scores are never accepted in input; the first signature freezes `analysis_result`; submit only after all non-excluded members signed
- [ ] T082 [P] [US5] Integration test `apps/api/tests/integration/award.int.test.ts`: the PR creator sits on the committee but cannot sign any AWARD step (`pr_creator_approves_award`, US5-2); final approval runs the FR-030 budget check (awarded amount per budget line ≤ PR committed + Available, else `BUDGET_EXCEEDED` with shortfall) and writes nothing to `budget_commitment`; approval sets the event `awarded` and creates `unsuccessful_notice` placeholders; award to a supplier failing eligibility → `SUPPLIER_NOT_ELIGIBLE` (US2-1); fewer valid offers than the minimum proceeds only with an approved `fewer_quotations` waiver

### Implementation for User Story 5

- [ ] T083 [P] [US5] Implement `packages/shared/src/procurement/scoring.ts` (pure, decimal.js) per research R22: comparison in the event currency from opening-date rates, disqualification, price points, criteria points, weighted totals, ranks, per-line mode, two-stage mode (makes T080 pass)
- [ ] T084 [P] [US5] Add `packages/shared/src/schemas/analysis.ts`: create `{ sourcingEventId }`, committee `[{ userId, function }]` with replacements, declaration `{ hasConflict, conflictSupplierIds[], note? }`, scores `{ scores: [{ offerId, criterionId, score }] }` (1–5, no price), disqualify `{ offerId, reason }`, recommendation `{ offerId?, lines?: [{ sourcingLineId, offerId }], justification?, justificationCriterionIds? }`, notices; the analysis detail response (comparison table, rates used, results)
- [ ] T085 [P] [US5] Add repositories `apps/api/src/repositories/bid-analysis.repository.ts`, `committee-member.repository.ts`, `evaluation-score.repository.ts`, `analysis-result.repository.ts`, `award-line.repository.ts`, `unsuccessful-notice.repository.ts`
- [ ] T086 [US5] Implement `apps/api/src/services/analysis.service.ts`: create after opening (tender: record signed), comparison rates at the opening date via `exchange-rate.service`, committee seating/replacement, declarations (`declare_coi` signature), scores, disqualification, results rewrite until `frozen_at`, recommendation rules, committee `committee_sign`, unsuccessful notices (makes T081 pass)
- [ ] T087 [US5] Implement the AWARD adapter `apps/api/src/services/doc-adapters/award.adapter.ts` (DoA amount = awarded amount in DoA currency, segregation `pr_creator_approves_award`, `onApproved` FR-030 check, event `awarded`, `award_line` from the recommendation with budget line, location, and activity copied from the PR line) (makes T082 pass)
- [ ] T088 [US5] Add `apps/api/src/routes/bid-analyses.routes.ts` (`POST /bid-analyses`, `GET /:id`, `PUT /:id/committee|scores|recommendation`, `POST /:id/declaration|disqualify|sign|notices`) plus the shared actions via `document-actions.ts` with `award:approve`; register in `apps/api/src/routes/index.ts`
- [ ] T089 [P] [US5] Build analysis screens `apps/web/src/app/[locale]/(app)/procurement/analyses/{page.tsx,[id]/page.tsx}` with `apps/web/src/features/analysis/`: comparison table (rates used shown), committee panel, declaration dialog (prices hidden until declared), scoring grid (1–5, price points read-only), recommendation form with criterion selector for justification, sign and submit actions, approval steps via `features/documents`
- [ ] T090 [US5] Add `analysis` namespace strings (ar + en)

**Checkpoint**: US5 independently testable.

---

## Phase 8: User Story 6 — Purchase Order from the award (Priority: P1)

**Goal**: POs created only from the approved award with inherited data; approval converts the
PR commitment into the PO commitment; acknowledgement; closing; PR auto-close.

**Independent Test**: From the approved RTHA award, create and approve a PO, upload the
acknowledgement, and verify inherited fields and budget line 10202 Committed/Available.

### Tests for User Story 6 ⚠️

- [ ] T091 [P] [US6] Unit test `apps/api/tests/unit/purchase-order.service.test.ts`: one draft per awarded supplier from an approved analysis only; inherited fields (supplier, lines, prices, grant, budget lines, locations, activities) are not writable (`.strict()` rejects them, US6-2); the creator cannot approve (`creator_approves`); total and words generated; GRN on an unacknowledged PO with `require_po_acknowledgement` → `PO_NOT_ACKNOWLEDGED` (US6-4); manual close requires a reason
- [ ] T092 [P] [US6] Integration test `apps/api/tests/integration/po-commitment.int.test.ts`: approval with PO = PR amount releases the PR rows `converted_to_po` and inserts the PO `committed` row with Available unchanged (US6-1); higher by more than Available → `BUDGET_EXCEEDED` with the shortfall (US6-3); lower returns the difference; ordering some lines of a PR keeps a PR remainder row; the commit rate is locked on the PO; all 9 lines ordered → PR `closed` (US6-5); cancelling an unsourced PR line with a reason releases its commitment (FR-038); manual close releases the remaining row `po_closed` (BR-21); inheritance trigger rejects a mismatched supplier or budget line (`INHERITED_FIELD_MISMATCH`, SC-002); PO approval on a Suspended grant is refused (FR-096)

### Implementation for User Story 6

- [ ] T093 [US6] Write `packages/database/migrations/0017_orders_receipt.sql` per data-model §5 (all order and receipt tables, including contract, amendment, and SCC parts): `purchase_order` (⟨doc⟩ ⟨doa⟩, `kind` ∈ `po | contract`, `bid_analysis_id`, inherited `supplier_id` equal to all its `award_line.supplier_id` by trigger, inherited `grant_id`, `currency` = offer currency, `advance_pct`, `retention_pct` 0–100, `retention_release_date`, `is_service`, stored `total` recomputed by trigger, `total_with_amendments`, `po_version`, commit ⟨rate⟩ + `grant_rate_to_base`, acknowledgement fields, `close_reason`, `is_imported`, `import_batch_id`, contract fields with `end_date ≥ start_date`), view `purchase_order_flags` (blacklist flag); `po_line` (inherited link ids and ⟨dims⟩ trigger-checked against `pr_line`, generated `line_total`, `amount_grant`, maintained `accepted_qty`, `invoiced_qty`, `paid_amount`); `purchase_order_version` (insert-only); `contract_milestone` (`pct numeric(5,2) null`, `amount`, ⟨dims⟩, maintained `certified_pct`); `performance_guarantee` (status ∈ `held | released | called`); `po_amendment` (⟨doc⟩ ⟨doa⟩, `before/after jsonb`, `old_total`, `new_total`) + `amendment_budget_delta`; `grn` (`shipment_type` ∈ `partial | final`, status `draft → completed | cancelled`, inherited `supplier_id` by trigger); `grn_line` (check `accepted_qty + rejected_qty = delivered_qty`, `reject_reason` required when rejected > 0, `returned_on`, `is_asset`); `completion_certificate` (one of `milestone_id`/`po_line_id`, `completion_pct numeric(5,2)` with `0 < pct ≤ 100` non-decreasing, computed `certified_amount`); FK `supplier_rating.po_id`; extend `app.exchange_rate_usage`; attach `app.block_delete_after_draft` to `purchase_order`, `po_amendment`, and the status-only variant to `grn`, `completion_certificate`; apply and regenerate types
- [ ] T094 [P] [US6] Add `packages/shared/src/schemas/order.ts`: create from analysis, PO/contract patch (only non-inherited fields: `poDate`, delivery address/schedule/terms, payment terms text, special conditions, `advancePct`, `retentionPct`, `retentionReleaseDate`, `isService` before approval), acknowledge `{ acknowledgedAt, acknowledgedByName, attachmentId }`, close `{ reason }`, rating `{ onTime, quality, documentation, comment? }`
- [ ] T095 [P] [US6] Add repositories `apps/api/src/repositories/purchase-order.repository.ts`, `po-line.repository.ts`, `po-version.repository.ts`
- [ ] T096 [US6] Implement `apps/api/src/services/purchase-order.service.ts`: create drafts from an approved analysis (one per supplier, kind from service type), draft edits, total + words via `packages/shared/src/amount-in-words`, acknowledge, manual close with release, status recompute helpers (makes T091 pass)
- [ ] T097 [US6] Implement the PO adapter `apps/api/src/services/doc-adapters/po.adapter.ts` (also used for `CON`): DoA by amount, `onApproved` D2 conversion under locks (PR rows `converted_to_po` + remainder, PO `committed` at the rate locked at approval, increase checked, shortfall returned), PR lines → `ordered` and PR auto-close (makes T092 pass)
- [ ] T098 [US6] Add unsourced PR line cancellation (`POST /prs/:id/lines/:lineId/cancel` with reason, releasing its commitment, PR auto-close) in `apps/api/src/services/pr.service.ts` and `apps/api/src/routes/prs.routes.ts` without changing existing 001 endpoints
- [ ] T099 [US6] Add `apps/api/src/routes/pos.routes.ts` (`POST /bid-analyses/:id/pos`, `GET/PATCH /pos/:id`, `POST /pos/:id/acknowledge|close`, `GET /pos/:id/versions[/:v]`, shared actions with `po:approve`); register in `apps/api/src/routes/index.ts`
- [ ] T100 [P] [US6] Build PO screens `apps/web/src/app/[locale]/(app)/procurement/pos/{page.tsx,[id]/page.tsx}` with `apps/web/src/features/orders/`: read-only inherited supplier and lines, editable terms in draft, approval steps, acknowledgement upload, close dialog, blacklist warning banner, budget effect summary
- [ ] T101 [US6] Add `orders` namespace strings (ar + en)

**Checkpoint**: US6 independently testable.

---

## Phase 9: User Story 7 — Goods Received Note (Priority: P1)

**Goal**: GRNs from approved (and acknowledged) POs with quantity limits, inherited supplier and
PO, two-person signing, returns, Asset flag, and PO receipt status.

**Independent Test**: Receive a PO in two partial GRNs and verify limits, inherited fields,
two-person signing, and PO status changes.

### Tests for User Story 7 ⚠️

- [ ] T102 [P] [US7] Integration test `apps/api/tests/integration/grn-receipt.int.test.ts`: 100 ordered, GRN accepts 60, second GRN accepting 50 → `OVER_RECEIPT` with `{ poLineId, ordered, alreadyAccepted, tolerancePct, maxAcceptable }` (US7-1); the GRN always carries the PO's supplier and number and the API rejects others (US7-2); the same user signing `received` and `inspected` → `SEGREGATION_OF_DUTIES` `receiver_is_inspector` (US7-3); completing both signatures updates `po_line.accepted_qty` and PO status `partially_received` → `fully_received`, then a `supplier_rating_due` notification (US7-4); rejected quantity without a reason rejected; return date recorded
- [ ] T103 [P] [US7] Unit test `apps/api/tests/unit/receipt.service.test.ts`: over-delivery tolerance `accepted ≤ ordered × (1 + tol) − already accepted` (BR-11); GRN number assigned on creation; draft-only cancel; rating 1–5 once per PO (FR-013) updates the supplier averages

### Implementation for User Story 7

- [ ] T104 [P] [US7] Add `packages/shared/src/schemas/receipt.ts`: GRN create `{ receivedDate, deliveryNoteNo, supplierInvoiceNo?, shipmentType, lines: [{ poLineId, deliveredQty, acceptedQty, rejectedQty, rejectReason?, conditionRemarks?, isAsset }] }`, sign `{ role: 'received' | 'inspected' }`, return `{ returnedOn }`; SCC create and sign shapes (used in US8)
- [ ] T105 [P] [US7] Add repositories `apps/api/src/repositories/grn.repository.ts`, `grn-line.repository.ts`, `supplier-rating.repository.ts`
- [ ] T106 [US7] Implement `apps/api/src/services/receipt.service.ts` (GRN part): create from an approved/acknowledged PO with inherited supplier, numbering `GRN` on creation, sign with segregation, completion under the `po_line` lock with the over-receipt check, PO status recompute, returns, rating capture (makes T102, T103 pass)
- [ ] T107 [US7] Add `apps/api/src/routes/grns.routes.ts` (`POST /pos/:id/grns`, `POST /grns/:id/sign`, `POST /grns/:id/lines/:lineId/return`, `GET /grns/:id[/history]`) and `POST /pos/:id/rating` in `pos.routes.ts` (`grn:create` / `grn:inspect`); register in `apps/api/src/routes/index.ts`
- [ ] T108 [P] [US7] Build receiving screens `apps/web/src/app/[locale]/(app)/procurement/receiving/{page.tsx,[id]/page.tsx}` and "Receive" on the PO page, with `apps/web/src/features/receiving/` (lines with remaining quantity, reject reasons, Asset flag, two signature buttons, return action, rating dialog when fully received)
- [ ] T109 [US7] Add `receiving` namespace strings (ar + en)

**Checkpoint**: US7 independently testable.

---

## Phase 10: User Story 11 — Supplier invoices and payment requests (Priority: P1)

**Goal**: Register invoices, create payment requests from the PO with three-way match, advances,
retention, deductions, generated amounts and words, segregation, and the no-overpayment rule.

**Independent Test**: Register the RTHA invoice, create a payment request against the fully
received PO, and verify inherited data, computed amounts and words, the match, and segregation.

### Tests for User Story 11 ⚠️

- [ ] T110 [P] [US11] Unit test `packages/shared/tests/procurement/match.test.ts`: `invoiced_qty ≤ accepted_qty × (1 + qty_tol)` and `invoiced_price ≤ po_price × (1 + price_tol)`; 900,000 vs 870,710 at 0% → `price_exceeds` (US11-2); service lines matched against the certified amount
- [ ] T111 [P] [US11] Unit test `packages/shared/tests/procurement/advance-retention.test.ts`: advance ≤ `advance_pct × total − prior advances`; proportional deduction `advance_paid × (gross ÷ total)` half-up and the final payment clears the remainder; 30% advance then final on 1,000,000 → total paid 1,000,000 (US11-4); retention = `retention_pct × gross`; deduction amounts per type and goods/services applicability
- [ ] T112 [P] [US11] Unit test `apps/api/tests/unit/payment-request.service.test.ts`: gross 870,710.00 SDG from the fully received RTHA PO, words "Eight Hundred Seventy Thousand Seven Hundred Ten Sudanese Pounds" and the Arabic equivalent, and no writable amount fields (US11-1); payee and bank snapshot inherited; charge-to table computed; `CURRENCY_MISMATCH` when the money account currency ≠ payment currency (FR-075); order requests write no `budget_commitment` rows (clarification Q3); blacklisted supplier or frozen grant requires the Finance Manager override with reason (FR-011, FR-096)
- [ ] T113 [P] [US11] Integration test `apps/api/tests/integration/payment-match.int.test.ts`: `MATCH_FAILED` with per-line details on a 900,000 invoice; override by the preparer refused (`override_by_preparer`); override by a `payment:override_match` holder with a reason accepted; duplicate invoice number for the same supplier (case/space-insensitive) → `DUPLICATE_INVOICE` (US11-5); the GRN storekeeper cannot approve (`receiver_approves_payment`, US11-3); the preparer cannot approve (`preparer_approves_payment`); SQL updates of `supplier_invoice.supplier_id` and `payment_request_line.budget_line_id` that differ from the PO raise `INHERITED_FIELD_MISMATCH` (SC-002)
- [ ] T114 [P] [US11] Integration test `apps/api/tests/integration/payment-concurrency.int.test.ts`: parallel payment-request submissions on one PO serialize on the PO row lock; only those keeping Σ gross of non-cancelled, non-rejected requests ≤ `total_with_amendments` succeed, the rest get `PO_OVERPAID` with `{ total, requested, remaining }` (FR-060)

### Implementation for User Story 11

- [ ] T115 [US11] Write `packages/database/migrations/0018_payments.sql` per data-model §7 (all payment tables, including direct and advance parts): `supplier_invoice` (numbering `INV`; status ∈ `registered | matched | cancelled`; unique `(tenant_id, supplier_id, lower(btrim(supplier_invoice_no)))` where not cancelled; inherited supplier by trigger) + `supplier_invoice_line` (generated `line_total`); `payment_request` (⟨doc⟩ ⟨doa⟩; `kind` ∈ `order | retention | direct | bid_security_return`; exactly one of `supplier_id`, `staff_payee_id`, `payee_name`; `order ⇒ supplier = PO supplier`; `payment_method` ∈ `bank_transfer | cheque | bank_draft | cash`; `money_account_id` whose currency equals `currency`; ⟨rate⟩ to PO currency; computed-only `gross, advance_deduction, retention_amount, deductions_total, net`; `amount_in_words_ar/en`; `match_status` ∈ `matched | mismatch | overridden | n_a`; `paid_at`, `paid_on`; `frozen_grant_override jsonb null`); `payment_request_line` (link ids, ⟨dims⟩ inherited by trigger, `match_result` ∈ `ok | qty_exceeds | price_exceeds`, `amount_grant`); `payment_request_deduction`; `payment_match_override` (unique per request); `cash_advance` + `cash_advance_line`; `advance_settlement` + `advance_settlement_line` (budget line may differ only within the same grant); extend `app.exchange_rate_usage`; attach `app.block_delete_after_draft` to `payment_request`, `cash_advance`, `advance_settlement`, and the status-only variant to `supplier_invoice`; apply and regenerate types
- [ ] T116 [P] [US11] Implement `packages/shared/src/procurement/match.ts` and `packages/shared/src/procurement/advance-retention.ts` (pure, decimal.js) (makes T110, T111 pass)
- [ ] T117 [P] [US11] Add `packages/shared/src/schemas/invoice.ts` (`{ supplierInvoiceNo, invoiceDate, currency, lines: [{ poLineId, quantity, unitPrice }], attachmentId }`) and `packages/shared/src/schemas/payment.ts` (order request `{ kind: 'order'|'retention', invoiceId?, isAdvance?, grnIds?, certificateIds?, paymentMethod, moneyAccountId, currency }`, override `{ reason }`, detail response with computed fields; direct payment shape for US15)
- [ ] T118 [P] [US11] Add repositories `apps/api/src/repositories/supplier-invoice.repository.ts`, `payment-request.repository.ts`, `payment-request-line.repository.ts`, `payment-request-deduction.repository.ts`, `payment-match-override.repository.ts`, `money-account.repository.ts` (read side; management in US12)
- [ ] T119 [US11] Implement `apps/api/src/services/invoice.service.ts` (register against a PO with inherited supplier, duplicate check, `INV` numbering) 
- [ ] T120 [US11] Implement `apps/api/src/services/payment-request.service.ts`: create from PO + invoice + GRNs/certificates, compute gross/advance/retention/deductions/net/words/charge-to, match per line, override (`override_match` signature), currency rule, submit under the PO lock with the overpayment check (makes T112, T113, T114 pass)
- [ ] T121 [US11] Implement the PAY adapter `apps/api/src/services/doc-adapters/payment-request.adapter.ts` (DoA by net, segregation `preparer_approves_payment` + `receiver_approves_payment`, no budget effect, `MATCH_FAILED` on submit without override)
- [ ] T122 [US11] Add `apps/api/src/routes/invoices.routes.ts` (`POST /pos/:id/invoices`, `GET /invoices[/:id]`) and `apps/api/src/routes/payment-requests.routes.ts` (`POST /pos/:id/payment-requests`, `GET/PATCH /payment-requests/:id`, `POST /payment-requests/:id/match-override`, shared actions with `payment:check` / `payment:approve`), plus read-only `GET /bank-accounts` and `GET /cash-boxes` in `apps/api/src/routes/money-accounts.routes.ts` (`finance:read` or `payment:create`; active accounts with currency and office) for the payment-request picker; register in `apps/api/src/routes/index.ts`
- [ ] T123 [P] [US11] Build `apps/web/src/app/[locale]/(app)/finance/invoices/{page.tsx,[id]/page.tsx}` and `apps/web/src/app/[locale]/(app)/finance/payment-requests/{page.tsx,[id]/page.tsx}` with `apps/web/src/features/payments/` (invoice form against a PO, request builder picking invoice and GRNs, money-account picker over the read-only list from T122 filtered to the payment currency, read-only computed amounts and words, match table with override dialog, charge-to table, approval steps)
- [ ] T124 [US11] Add `invoices` and `payments` namespace strings (ar + en)

**Checkpoint**: US11 independently testable.

---

## Phase 11: User Story 12 — Chart of accounts, bank and cash accounts, periods (Priority: P1)

**Goal**: Manage the chart, budget-line mapping, money accounts, control accounts, and periods
(the opening data import follows in Phase 13, after vouchers exist).

**Independent Test**: Map RTHA budget lines, create the Blue Nile Mashreq Bank account and a
cash box, open November 2026, and close and reopen a period.

### Tests for User Story 12 ⚠️

- [ ] T125 [P] [US12] Unit test `apps/api/tests/unit/accounting-setup.service.test.ts`: a parent must be a group; children inherit type; voucher lines may only use active posting accounts; budget line resolves `coalesce(budget_line.expense_account_id, category default)`; money account GL must be an asset posting account and unique; control account keys validated
- [ ] T126 [P] [US12] Integration test `apps/api/tests/integration/period.int.test.ts`: close lists unposted approved vouchers and requires `confirm: true` (FR-065, R33); reopen without `periods:manage` → 403; with it, a missing reason → `REASON_REQUIRED`, and the reason is stored in `reopen_reason` and `audit_history` (US12-4); deleting an account used on a posted voucher line → `409 ACCOUNT_IN_USE` while deactivation works (US12-1; this case runs once 0019 exists, T136)

### Implementation for User Story 12

- [ ] T127 [P] [US12] Add `packages/shared/src/schemas/accounting.ts` (gl account, category mapping, control accounts, budget-line expense account, bank account, cash box, period close `{ confirm? }`, reopen `{ reason }`)
- [ ] T128 [P] [US12] Add repositories `apps/api/src/repositories/gl-account.repository.ts`, `budget-category-account.repository.ts`, `control-account.repository.ts`, `accounting-period.repository.ts`; extend `money-account.repository.ts` with writes
- [ ] T129 [US12] Implement `apps/api/src/services/accounting-setup.service.ts` (chart CRUD with delete blocked when used, mappings, control accounts, money accounts) and `apps/api/src/services/period.service.ts` (close with warning, reopen with reason, `FOR SHARE` lookup used by posting) (makes T125, T126 pass)
- [ ] T130 [US12] Add `apps/api/src/routes/gl-accounts.routes.ts` (`/gl-accounts`, `/gl-accounts/category-mapping`, `/control-accounts`, `PATCH /budget-lines/:id/expense-account`), extend `apps/api/src/routes/money-accounts.routes.ts` with `POST/PATCH /bank-accounts` and `/cash-boxes` (the read side exists from T122), and `apps/api/src/routes/periods.routes.ts`, with `finance:read`, `accounts:manage`, `bank:manage`, `periods:manage`; register in `apps/api/src/routes/index.ts`
- [ ] T131 [P] [US12] Build `apps/web/src/app/[locale]/(app)/finance/{accounts,bank-cash,periods}/page.tsx` with `apps/web/src/features/accounting/` (chart tree with deactivate, category mapping and per-line override on the grant budget-line table, bank/cash forms, control accounts, period list with close warning dialog and reopen-with-reason)
- [ ] T132 [US12] Add `accounting` namespace strings (ar + en)

**Checkpoint**: US12 (without import) independently testable.

---

## Phase 12: User Story 13 — Payment vouchers and posting (Priority: P1)

**Goal**: Generate balanced BPV/CPV from approved payment requests, check/approve by three
people, post into an open period to record Actual and consume the commitment, reverse only.

**Independent Test**: Generate the BPV from the RTHA payment request, check, approve, and post
it; verify the budget line figures, immutability, and reversal.

### Tests for User Story 13 ⚠️

- [ ] T133 [P] [US13] Unit test `packages/shared/tests/accounting/generate-voucher.test.ts`: every case in contracts/posting-rules.md §2 — RTHA PO payment (Dr 10202 / Cr bank 870,710.00 SDG), BPV-35 (Dr 10102 3,040,800.00 SDG, donor ADRA, contract "Staff Contract/Admin Expenditures" / Cr 70205, line 1 labelled SDG at 1.0000), WHT 5% on 1,000,000 services, advance 30% then final, retention withheld and released, cash advance to staff (no Actual), `CURRENCY_MISMATCH` on a USD bank paying an SDG request, `BUDGET_LINE_UNMAPPED` listing all unmapped lines at once (US12-2), rounding residue on the bank/cash side, reversal mirroring every line at the same rates
- [ ] T134 [P] [US13] Integration test `apps/api/tests/integration/voucher-integrity.int.test.ts`: a 0.01 base imbalance cannot be checked (`VOUCHER_UNBALANCED`, US13-2); a USD-labelled line with rate 1.0000 on an SDG amount cannot be saved (`RATE_CURRENCY_CONTRADICTION`, US13-4); update/delete of a posted voucher or line → `VOUCHER_POSTED_IMMUTABLE` (US13-3); posting into a closed period → `PERIOD_CLOSED`; the voucher creator cannot check or approve and checker ≠ approver (`voucher_three_people`, DB trigger too, US13-5); CPV or cheque BPV without received-by and signed copy → `RECEIVED_BY_REQUIRED` (FR-074); posting the RTHA BPV raises Actual on 10202 by the grant-currency amount and lowers Committed by the matched amount at the PO's locked rate (US13-1); the payment request becomes `paid` with `paid_on`; reversal restores Actual and the commitment using the original rates (US13-6); voucher approval on a Closed grant is refused (FR-096); a `voucher_line` whose grant or budget line differs from its payment request line raises `INHERITED_FIELD_MISMATCH` (SC-002)
- [ ] T135 [P] [US13] Integration test `apps/api/tests/integration/budget-concurrency-002.int.test.ts`: parallel PO approval and payment posting on one budget line with the last Available: only actions that fit succeed and Available ≥ 0 at the end (SC-004; JVs are added in US14)

### Implementation for User Story 13

- [ ] T136 [US13] Write `packages/database/migrations/0019_vouchers.sql` per data-model §8: `voucher` (⟨doc⟩ ⟨doa⟩; `type` ∈ `BPV | CPV | BRV | CRV | JV | TRF`; `money_account_id` required for BPV/CPV/BRV/CRV with `BPV/BRV ⇒ kind bank`, `CPV/CRV ⇒ kind cash`; `to_money_account_id` TRF only; `cheque_no` required when BPV and payment method = cheque; `reason` required for JV (check); source FKs and `receipt_kind` ∈ `donor_tranche | supplier_refund | advance_return | other_income | bid_security`; `entered_by`; received-by fields; `reversal_of_id`, `reversed_by_id`, `reversed_at`; `is_imported`, `import_batch_id`); `voucher_line` (posting active account; `debit, credit ≥ 0, exactly one > 0`; ⟨rate⟩ with **check `currency = base ⇔ (rate_to_base = 1 and exchange_rate_id is null)`** and a trigger that `rate_to_base` equals the referenced `exchange_rate.rate_to_base`; `base_debit = round(debit × rate, 2)`, `base_credit = round(credit × rate, 2)` (check); ⟨dims⟩, `donor_id`, `category_text`; grant rate snapshot; `actual_grant_amount` only for expense accounts with a budget line; `commitment_consumed_grant`; `posted_period`; trail link ids); triggers `voucher_balanced` (deferred, status ≥ `checked`, `Σ base_debit = Σ base_credit > 0`), `voucher_immutable_when_posted` (only `reversed_by_id`/`reversed_at` once), `voucher_period_open`, `voucher_three_signers`; the four indexes of §8; replace `budget_line_balance` with `actual = Σ actual_grant_amount where posted_period is not null`, `available = budget − reserved − committed − actual`, `pct_used`; replace `app.assert_budget_line_available` to include Actual and add the deferred trigger on `voucher_line` update of `posted_period`; FKs `bid_security.receipt_voucher_id/return_voucher_id`; `bank_statement`, `bank_statement_line`, `reconciliation_match`, `allocation_template`, `allocation_line` (deferred Σ pct = 100.00), `import_batch` (`kind` ∈ `opening_balances | budget_line_opening | open_pos | prior_transactions | bank_statement`, `status` ∈ `previewed | committed | failed`); `gl_account` delete restricted by voucher lines; attach `app.block_delete_after_draft` to `voucher`; extend `app.exchange_rate_usage`; apply and regenerate types; re-run `budget-report.int.test.ts` from 001 to confirm the replaced view keeps its shape
- [ ] T137 [P] [US13] Implement `packages/shared/src/accounting/generate-voucher.ts` (pure `generateVoucher(input): Result<VoucherDraft, GenerationError>`, posting-rules §1–§2) and `packages/shared/src/accounting/balance.ts` (base totals, residue rule) (makes T133 pass)
- [ ] T138 [P] [US13] Add `packages/shared/src/schemas/voucher.ts`: voucher detail with lines, post `{ expectedVersion, receivedByName?, receivedOn?, receivedCopyAttachmentId? }`, reverse `{ reason, reversalDate }`, manual voucher lines (account, description, currency, debit/credit, dimensions — never rates) for US14
- [ ] T139 [P] [US13] Add repositories `apps/api/src/repositories/voucher.repository.ts` and `voucher-line.repository.ts`
- [ ] T140 [US13] Implement `apps/api/src/services/voucher.service.ts` (generate from an approved payment request with account mapping, money account, and rates; check = approve on the `check` step with balance enforced; post: open period `FOR SHARE`, received-by rule, stamp `posted_period` and grant rates, Actual, `splitConsume` of the PO/DPR commitment at its locked rate, payment request `paid`, `po_line.paid_amount`, PO auto-close when fully received and fully paid, `print_snapshot`; reverse: mirrored draft at the original rates, on posting `restore` the consumed rows and set `reversed_by_id`) (makes T134, T135 pass)
- [ ] T141 [US13] Implement the PV adapter `apps/api/src/services/doc-adapters/voucher.adapter.ts` (DoA types PV/RV/JV, segregation `voucher_three_people`, first step `check`)
- [ ] T142 [US13] Add `apps/api/src/routes/vouchers.routes.ts` (`GET /vouchers[/:id]`, `POST /payment-requests/:id/voucher`, `POST /vouchers/:id/check|post|reverse`, shared actions with `voucher:check` / `voucher:approve`) with `voucher:create`, `voucher:post`, `voucher:reverse`; register in `apps/api/src/routes/index.ts`
- [ ] T143 [P] [US13] Build `apps/web/src/app/[locale]/(app)/finance/vouchers/{page.tsx,[id]/page.tsx}` with `apps/web/src/features/vouchers/` (BPV-style lines table with currency, rate, base columns, totals; check/approve steps; post dialog with received-by name/date and signed-copy upload; reverse dialog with reason and date; "Generate voucher" on an approved payment request)
- [ ] T144 [US13] Add `vouchers` namespace strings (ar + en)

**Checkpoint**: US13 independently testable.

---

## Phase 13: User Story 12 (continued) — Opening data import (Priority: P1)

**Goal**: Import opening balances, budget-line committed/actual to date, open POs, and prior
transactions with a preview; imported data balances and is marked as imported.

**Independent Test**: Import RTHA opening balances; an unbalanced file is reported in the
preview and nothing is imported.

- [ ] T145 [P] [US12] Unit test `apps/api/tests/unit/import.service.test.ts`: preview reports invalid rows and an unbalanced batch (US12-3) and commits nothing; budget-line actual becomes imported JV lines (Dr expense / Cr opening balance equity); committed becomes `budget_commitment` rows with `source_doc_type = 'OPENING'`; open POs become `purchase_order` rows with `is_imported = true, status = 'approved'`; imported vouchers carry the `imported` signature, bypass the three-signer rule, and still require an open target period
- [ ] T146 [US12] Implement `apps/api/src/services/import.service.ts` reusing the `budget-import.service.ts` pattern (exceljs, text cells, Zod row schemas in `packages/shared/src/schemas/accounting-import.ts`), add `OPENING` to the commitment source types in the registry/check, and `POST /imports/:kind?mode=preview|commit` in `apps/api/src/routes/imports.routes.ts` (`accounts:manage`); downloadable templates in `apps/api/src/services/import-templates.ts` (makes T145 pass)
- [ ] T147 [P] [US12] Build `apps/web/src/app/[locale]/(app)/finance/imports/page.tsx` with `apps/web/src/features/accounting/import-wizard.tsx` (kind picker, template download, preview with invalid rows and totals, commit)

**Checkpoint**: US12 complete.

---

## Phase 14: User Story 19 — Reports 1–3 (Priority: P1)

**Goal**: Budget vs Actual per grant, the donor financial report export, and the procurement
register, exportable to PDF and Excel in ar and en.

**Independent Test**: After running the RTHA chain, produce each P1 report for the ADRA grant
and reconcile its figures with the posted vouchers.

### Tests for User Story 19 (reports 1–3) ⚠️

- [ ] T148 [P] [US19] Integration test `apps/api/tests/integration/reports.int.test.ts`: Budget vs Actual Actual on 10202 = Σ posted `voucher_line.actual_grant_amount` (US19-1, SC-011); donor report actual previous periods + this period = cumulative and `ratesUsed[]` lists every rate (US19-2); procurement register shows PR, method, waiver, offers count, awardee, PO, amounts, GRN, invoice, payment, dates, cycle time; filters grant, donor, office, period, dates
- [ ] T149 [P] [US19] Unit test `apps/api/tests/unit/report-export-002.test.ts`: the `.xlsx` exports use DD/MM/YYYY and 2-dp numeric cells and bilingual headers

### Implementation for User Story 19 (reports 1–3)

- [ ] T150 [US19] Write `packages/database/migrations/0020_reports_trail.sql` per data-model §10: view `doc_edge` (union over the D6 FKs), `app.document_trail(doc_type, doc_id)` (recursive both ways, depth ≤ 12), view `my_task_candidates` (R30), report functions `app.report_budget_vs_actual`, `app.report_donor`, `app.report_procurement_register`, `app.report_open_commitments`, `app.report_supplier_history`, `app.report_gl`, `app.report_account_statement`, `app.report_trial_balance`, `app.money_account_book` (window running balance, R34), `app.report_outstanding_advances`, `app.report_grant_funding`, view `money_account_carrying_rate`; all `security_invoker`, `stable`; apply and regenerate types
- [ ] T151 [P] [US19] Add report schemas (filters, rows, `ratesUsed`) to `packages/shared/src/schemas/report.ts`
- [ ] T152 [US19] Extend `apps/api/src/repositories/report.repository.ts` and `apps/api/src/services/report.service.ts` with Budget vs Actual, donor, and procurement register, plus `.xlsx` builders with exceljs (makes T148, T149 pass)
- [ ] T153 [US19] Add `GET /reports/budget-vs-actual`, `/reports/donor`, `/reports/procurement-register` and their `/export.xlsx` variants to `apps/api/src/routes/reports.routes.ts` (`reports:read`)
- [ ] T154 [P] [US19] Build `apps/web/src/app/[locale]/(app)/reports/{budget-vs-actual,donor,procurement-register}/page.tsx` with `apps/web/src/features/reports/` (filters, tables, Excel download, PDF via the print kit)
- [ ] T155 [US19] Add `reports002` namespace strings (ar + en)

**Checkpoint**: P1 reports done.

---

## Phase 15: P1 Gate — RTHA chain end to end

**Purpose**: Prove SC-001 before the P2 work (plan gate: RTHA chain E2E in ar and en, BPV
generator table green).

- [ ] T156 Extend `packages/database/scripts/seed-demo.ts` with the 002 additions in data-model §11 and quickstart "Setup": accounts `10102`, `10202`, `70205`; money account "Blue Nile Mashreq Bank – White Nile" (SDG, bank, MAD, GL `70205`); budget line `10102` (Field Supervision Officer, staff) on the ADRA grant; suppliers Al-Qabas Library, Al-Shorouk Bookstore, Mano Services (approved, vetted); staff payee NasrAldin Abdullah Ahmed; users `procurement@`, `committee1..3@`, `store@`, `inspector@`, `accountant@`, `fm@`, `cashier@`, `cd@` with their roles; September and November 2026 periods open; `document_sequence` BPV/MAD/2026 = 34
- [ ] T157 [P] Create `apps/web/e2e/fixtures/rtha-chain.json` = `rtha-pr-0010.json` plus the three bidders from sheet "Quotation Analysis" (Al-Qabas Library 870,710; Al-Shorouk Bookstore 1,000,600; Mano Services 906,300 SDG per line), criteria price 50% / quality 25% / validity 25%, and the committee scores
- [ ] T158 Write `apps/web/e2e/rtha-chain.spec.ts` (ar and en projects) following quickstart "Manual acceptance A" steps 1–9: RFQ (90% blocked, then `RFQ-MAD-2026-0001`), receipts with no price field, opening blocked before the deadline, prices, committee (price hidden before declaring; 50.00 / 48.04 / 43.51), award approved by `fm@` and `cd@` with `requester@` not eligible, PO approved with 10202 Available unchanged and PR Closed, GRN by `store@` + `inspector@`, invoice and payment request 870,710.00 SDG with words and `store@` refused, BPV posted with Actual up and Committed down, request Paid with a date; every document carries the same supplier (SC-001, SC-002)
- [ ] T159 Run the P1 gate: `pnpm --filter @ngo/shared test`, `pnpm --filter @ngo/api test:unit`, `pnpm --filter @ngo/api test:integration`, `pnpm --filter @ngo/web e2e -- rtha-chain`, plus the 001 suites; commit

**Checkpoint**: The full P1 chain works from approved PR to posted payment.

---

## Phase 16: User Story 8 — Service contracts, milestones, and completion certificates (Priority: P2)

**Goal**: Contracts from the award with milestones, advance/retention, guarantees, and
two-person completion certificates that cap payable amounts.

**Independent Test**: Create and approve a contract with three milestones, certify one fully
and one partially, and verify the amounts payable.

### Tests for User Story 8 ⚠️

- [ ] T160 [P] [US8] Unit test `apps/api/tests/unit/contract.service.test.ts`: milestones Σ pct ≠ 100 or Σ amount ≠ total → `MILESTONES_INVALID` on submit (US8-1); `end_date ≥ start_date`; contracts use the PO budget, approval, and close rules (CON adapter)
- [ ] T161 [P] [US8] Integration test `apps/api/tests/integration/completion-certificate.int.test.ts`: a milestone certified at 60% allows at most 60% of its amount to be requested (`OVER_CERTIFIED`, US8-2); the same user as `certified` and `confirmed` → `certifier_is_confirmer` (US8-3); cumulative pct must not decrease; the RTHA catering service PO 80 persons × 16,775 SDG with one certificate makes 1,342,000.00 SDG payable (US8-5)

### Implementation for User Story 8

- [ ] T162 [P] [US8] Extend `packages/shared/src/schemas/order.ts` with contract fields (scope, ToR attachment, start/end), milestones `[{ seq, deliverable, pct?, amount, dueDate }]`, guarantees `[{ type, amount, currency, issuer, expiryDate, attachmentId }]`
- [ ] T163 [P] [US8] Add repositories `apps/api/src/repositories/contract-milestone.repository.ts`, `performance-guarantee.repository.ts`, `completion-certificate.repository.ts`
- [ ] T164 [US8] Extend `apps/api/src/services/purchase-order.service.ts` for `kind = 'contract'` (milestones with one budget line each from the award lines, guarantees, submit guard) and register the `CON` adapter in `apps/api/src/services/doc-adapters/po.adapter.ts` (makes T160 pass)
- [ ] T165 [US8] Extend `apps/api/src/services/receipt.service.ts` with completion certificates (`SCC` numbering on creation, `certified` + `confirmed` signatures, `certified_pct` maintenance) and `apps/api/src/services/payment-request.service.ts` with certificate-based lines capped at certified pct × milestone − already requested; after each completed SCC recompute PO/contract status from certified amounts (fully certified when Σ certified = `total_with_amendments`, FR-037) and, when fully certified, create the `supplier_rating_due` notification (FR-013) (makes T161 pass)
- [ ] T166 [US8] Add `apps/api/src/routes/contracts.routes.ts` (`GET/PATCH /contracts/:id`, `PUT /contracts/:id/milestones|guarantees`, shared actions) and SCC endpoints `POST /pos/:id/completion-certificates`, `POST /completion-certificates/:id/sign` in `apps/api/src/routes/grns.routes.ts`; register in `apps/api/src/routes/index.ts`
- [ ] T167 [P] [US8] Build `apps/web/src/app/[locale]/(app)/procurement/contracts/{page.tsx,[id]/page.tsx}` with milestone editor (live Σ checks), guarantees, and certificate screens in `apps/web/src/features/orders/` and `apps/web/src/features/receiving/certificate-*.tsx`
- [ ] T168 [US8] Add contract and certificate strings to the `orders` and `receiving` namespaces (ar + en)

**Checkpoint**: US8 independently testable (guarantee expiry notifications arrive with US21).

---

## Phase 17: User Story 9 — Open tenders (Priority: P2)

**Goal**: Tender files with lots, publication, clarifications, bid receipt log, a ≥ 3-person
signed opening, two-stage evaluation per lot, bid securities, and re-tender.

**Independent Test**: Publish a two-lot tender, log bids, hold and sign the opening, evaluate in
two stages, award per lot, and return bid securities.

### Tests for User Story 9 ⚠️

- [ ] T169 [P] [US9] Integration test `apps/api/tests/integration/tender.int.test.ts`: no user can enter or see prices before the opening (US9-1, reuses the sealed checks); a late bid is logged `late` and can never get prices (`OFFER_LATE`, US9-2); fewer than 3 attendees cannot sign the opening record (US9-4); evaluation starts only after all attendee signatures and bid prices freeze (`OFFER_FROZEN`); a bid failing the technical stage is not financially scored (US9-3); re-tender issues a new `TND` number linked by `reissued_from_id` and moves the PR lines (US9-5)
- [ ] T170 [P] [US9] Unit test `apps/api/tests/unit/bid-security.service.test.ts`: returned with a date, forfeited only with a reason; only `cash_deposit` securities produce a BRV/CRV draft on receipt and a BPV/CPV draft on return (FR-048, clarification Q5)

### Implementation for User Story 9

- [ ] T171 [P] [US9] Extend `packages/shared/src/schemas/sourcing.ts` with tender create/patch (lots, publication channels, clarification deadline, opening place, bid security terms), publication, clarification, bid receipt `{ supplierId, receivedAt, receivedById, bidSecurityReceived }`, bid prices, security return/forfeit
- [ ] T172 [P] [US9] Add repositories `apps/api/src/repositories/tender-lot.repository.ts`, `tender-publication.repository.ts`, `tender-clarification.repository.ts`, `bid-security.repository.ts`
- [ ] T173 [US9] Extend `apps/api/src/services/sourcing.service.ts` and `apps/api/src/services/opening.service.ts` for `kind = 'tender'` (lots, publication, clarifications, ≥ 3 attendees, `attend` signatures with `signed_complete_at`, late bids never opened, retender) and `apps/api/src/services/analysis.service.ts` for two-stage per-lot evaluation (makes T169 pass)
- [ ] T174 [US9] Implement `apps/api/src/services/bid-security.service.ts` (makes T170 pass; voucher drafts use `voucher.service` once US14 manual receipts exist — until then the draft generation is behind a guard that returns the planned lines)
- [ ] T175 [US9] Add `apps/api/src/routes/tenders.routes.ts` (all `/tenders/*` endpoints in rest-api.md with `tender:manage` / `tender:open`); register in `apps/api/src/routes/index.ts`
- [ ] T176 [P] [US9] Build `apps/web/src/app/[locale]/(app)/procurement/tenders/{page.tsx,new/page.tsx,[id]/page.tsx}` with `apps/web/src/features/sourcing/tender-*.tsx` (lots, publications with evidence, clarification log, bid log, opening session with attendee signatures, securities)
- [ ] T177 [US9] Add tender strings to the `sourcing` namespace (ar + en)

**Checkpoint**: US9 independently testable.

---

## Phase 18: User Story 10 — Waivers, amendments, and cancellations (Priority: P2)

**Goal**: Waivers with their own DoA linked to the covered document, versioned PO/contract
amendments with budget recheck, and cancellations that release exactly what is held.

**Independent Test**: Approve a fewer-quotations waiver on an RFQ, amend an approved PO up and
down, cancel a PO, and check the splitting warning.

### Tests for User Story 10 ⚠️

- [ ] T178 [P] [US10] Integration test `apps/api/tests/integration/waiver.int.test.ts`: an RFQ with 2 valid quotations and an approved `fewer_quotations` waiver proceeds to evaluation (US10-1) and the waiver number is returned in the print data of the analysis, PO, and payment request (FR-050); waiver creator cannot approve; DoA amount = covered value; an `expired_document` waiver unblocks award to that supplier
- [ ] T179 [P] [US10] Integration test `apps/api/tests/integration/amendment.int.test.ts`: an amendment raising the PO above Available → `BUDGET_EXCEEDED` with the shortfall (US10-2); an approved amendment writes `purchase_order_version` v1, shows version 2 with before/after values, and v1 stays readable unchanged (US10-3); a decrease returns the difference (`amended` release + new row); DoA on the new total
- [ ] T180 [P] [US10] Integration test `apps/api/tests/integration/order-cancel.int.test.ts`: cancelling a PO with nothing received releases its full commitment and its PR lines return to `not_sourced` with no new PR reservation (US10-4, research D2); cancelling an RFQ/tender requires a reason and returns lines; BR-21 exact release

### Implementation for User Story 10

- [ ] T181 [P] [US10] Add `packages/shared/src/schemas/waiver.ts` (`{ reasonCategory, justification, coveredDocType, coveredDocId }`) and amendment shapes `{ reason, changes: { header?, lines?, milestones? } }` in `packages/shared/src/schemas/order.ts`
- [ ] T182 [US10] Implement `apps/api/src/services/waiver.service.ts` + `apps/api/src/services/doc-adapters/waiver.adapter.ts` and `apps/api/src/routes/waivers.routes.ts` (`/waivers` CRUD with `waiver:create`, shared actions with `waiver:approve`) (makes T178 pass)
- [ ] T183 [US10] Implement `apps/api/src/services/amendment.service.ts` + `apps/api/src/repositories/po-amendment.repository.ts` + `apps/api/src/services/doc-adapters/amendment.adapter.ts` (`AMD` numbering, version snapshot, apply after-values, D2 re-split with increase check) and `POST /pos/:id/amendments` + `/amendments` shared actions in `apps/api/src/routes/amendments.routes.ts` (makes T179 pass)
- [ ] T184 [US10] Implement cancellation releases in `apps/api/src/services/doc-adapters/po.adapter.ts` (`onReleased`: `cancelled` release, PR lines `not_sourced`) and `apps/api/src/services/sourcing.service.ts`, with `po:cancel` / `rfq:create` / `tender:manage` permissions (makes T180 pass)
- [ ] T185 [P] [US10] Build `apps/web/src/app/[locale]/(app)/procurement/waivers/{page.tsx,[id]/page.tsx}`, the amendment editor and version viewer (before/after diff) on the PO/contract pages, cancel dialogs, and `<WaiverBadge>` on sourcing, analysis, PO, and payment pages in `apps/web/src/features/orders/` and `apps/web/src/features/waivers/`
- [ ] T186 [US10] Add waiver and amendment strings (ar + en)

**Checkpoint**: US10 independently testable.

---

## Phase 19: User Story 14 — Receipts, journals, transfers, and exchange (Priority: P2)

**Goal**: BRV/CRV receipts (donor tranches, refunds, advance returns, other income), JVs with
reason and Available recheck, transfers with automatic exchange gain/loss, grant funding summary.

**Independent Test**: Record a donor tranche, reclassify a posted expense with a JV, transfer
USD to an SDG account, and verify the grant funding summary.

### Tests for User Story 14 ⚠️

- [ ] T187 [US14] Add the posting-rules §3 cases to `packages/shared/tests/accounting/generate-voucher.test.ts`: BRV donor tranche (Cr grant funds received for that grant), CRV advance return, BRV supplier refund (reduces Actual), bid-security cash deposit (suspense), JV reclassification (negative Actual on the source), TRF with the exchange gain/loss line balancing the base difference (US14-3)
- [ ] T188 [P] [US14] Integration test `apps/api/tests/integration/voucher-receipts.int.test.ts`: a posted 50,000 USD BRV tranche appears as received in the grant funding summary and raises the fund balance (US14-1); a JV moving 100,000 SDG of Actual to a line with 80,000 Available cannot be approved (US14-2); a JV without a reason → `REASON_REQUIRED` (US14-4); transfer at a rate different from the carrying rate posts the difference to exchange gain/loss
- [ ] T189 [US14] Extend `apps/api/tests/integration/budget-concurrency-002.int.test.ts` with a JV competing with PO approval and payment posting for the last Available (SC-004)

### Implementation for User Story 14

- [ ] T190 [US14] Extend `packages/shared/src/accounting/generate-voucher.ts` with receipt, JV, and transfer generators (posting-rules §3) (makes T187 pass)
- [ ] T191 [US14] Extend `apps/api/src/services/voucher.service.ts` with manual BRV/CRV (receipt kinds), JV (reason, locks and Available recheck on approval and posting), and TRF (carrying rate from `money_account_carrying_rate`, entered rate > 0 with date and source), wire the RV/JV DoA types in `voucher.adapter.ts`, and enable bid-security voucher drafts in `bid-security.service.ts` (makes T188, T189 pass)
- [ ] T192 [US14] Add `POST/PATCH /vouchers` (manual JV, BRV/CRV, TRF) to `apps/api/src/routes/vouchers.routes.ts` and `GET /reports/grant-funding` to `apps/api/src/routes/reports.routes.ts`
- [ ] T193 [P] [US14] Build receipt, JV, and transfer forms in `apps/web/src/features/vouchers/{receipt-form,journal-form,transfer-form}.tsx` and `apps/web/src/app/[locale]/(app)/reports/grant-funding/page.tsx`
- [ ] T194 [US14] Add receipt/JV/transfer strings to the `vouchers` namespace (ar + en)

**Checkpoint**: US14 independently testable.

---

## Phase 20: User Story 15 — Direct payment requests without PO (Priority: P2)

**Goal**: Payments that are not purchases, with the PR budget lifecycle (reserve → commit →
Actual) and BPV/CPV generation.

**Independent Test**: Reproduce BPV-35 from a direct payment request (print comparison follows
in US20).

### Tests for User Story 15 ⚠️

- [ ] T195 [P] [US15] Integration test `apps/api/tests/integration/direct-payment.int.test.ts`: the September salary 3,040,800.00 SDG on 10102 (donor ADRA, cheque 35, Blue Nile Mashreq Bank – White Nile) reserves on submit, commits on approval, and on BPV posting raises Actual and consumes `consumed_by_payment`; words "Three Million Forty Thousand Eight Hundred Sudanese Pounds" + Arabic (US15-1); exceeding Available on submit → `BUDGET_EXCEEDED` with shortfall (US15-2); category `goods` (procurement-only) → `PROCUREMENT_ONLY_CATEGORY` (US15-3); reject/return/cancel release with the matching reason; extend `apps/api/tests/integration/budget-concurrency-002.int.test.ts` with direct-payment submission competing for the last Available (SC-004)
- [ ] T196 [P] [US15] Unit test `apps/api/tests/unit/direct-payment.service.test.ts`: exactly one payee kind; staff payee bank snapshot; lines require budget line and location of the chosen grant; preparer cannot approve

### Implementation for User Story 15

- [ ] T197 [P] [US15] Add the direct payment schema `{ payeeType, supplierId?|staffPayeeId?|payeeName?, grantId, categoryId, periodText, paymentMethod, moneyAccountId, currency, lines: [{ budgetLineId, locationOfficeId, activityId?, description, amount }] }` to `packages/shared/src/schemas/payment.ts`
- [ ] T198 [US15] Implement `apps/api/src/services/direct-payment.service.ts` and `apps/api/src/services/doc-adapters/direct-payment.adapter.ts` (`DPR` numbering, reserve on submit, commit on approval, release on reject/return/cancel, segregation `preparer_approves_payment`), and allow `POST /payment-requests/:id/voucher` for `kind = 'direct'` in `voucher.service.ts` (makes T195, T196 pass)
- [ ] T199 [US15] Add `apps/api/src/routes/direct-payments.routes.ts` (`POST/GET/PATCH /direct-payments`, shared actions) and register in `apps/api/src/routes/index.ts`
- [ ] T200 [P] [US15] Build `apps/web/src/app/[locale]/(app)/finance/direct-payments/{page.tsx,new/page.tsx,[id]/page.tsx}` with `apps/web/src/features/payments/direct-payment-*.tsx`
- [ ] T201 [US15] Add direct payment strings to the `payments` namespace (ar + en)

**Checkpoint**: US15 independently testable.

---

## Phase 21: User Story 16 — Cash advances and settlement (Priority: P2)

**Goal**: Staff advances reserved/committed like a PR and paid to the staff advance account;
settlement records Actual, returns unused cash, and clears the balance; overdue advances block
new ones.

**Independent Test**: Request, approve, and pay an advance; settle it with receipts and a
partial return; verify the advance balance and budget figures.

### Tests for User Story 16 ⚠️

- [ ] T202 [P] [US16] Integration test `apps/api/tests/integration/advance.int.test.ts`: a 500,000 SDG advance paid leaves Actual unchanged and shows in staff advances (US16-3); settlement with 420,000 receipts and an 80,000 CRV raises Actual by 420,000, releases 80,000 `settled`, and leaves the advance balance 0 (US16-1); a payee with an advance overdue 31 days cannot submit a new one → `ADVANCE_OVERDUE` unless an approved `overdue_advance` waiver is linked (US16-2); settlement lines lacking Available block the settlement (FR-080); extend `apps/api/tests/integration/budget-concurrency-002.int.test.ts` with parallel advance submission and settlement posting on the same budget line, survivors fit and Available ≥ 0 (SC-004)
- [ ] T203 [P] [US16] Unit test `apps/api/tests/unit/advance.service.test.ts`: settlement budget lines may differ only within the same grant; `additional_amount = outstanding − receipts` handled by a BPV/CPV with a new reservation check; status `paid → partially_settled → settled`

### Implementation for User Story 16

- [ ] T204 [P] [US16] Add `packages/shared/src/schemas/advance.ts` (advance create/patch with planned lines, settlement with lines and receipt attachments)
- [ ] T205 [P] [US16] Add repositories `apps/api/src/repositories/cash-advance.repository.ts` and `advance-settlement.repository.ts`
- [ ] T206 [US16] Implement `apps/api/src/services/advance.service.ts` + `apps/api/src/services/doc-adapters/advance.adapter.ts` (`ADV`, reserve/commit, overdue check on submit, payment voucher to staff advances) and `apps/api/src/services/settlement.service.ts` + `apps/api/src/services/doc-adapters/settlement.adapter.ts` (`STL`, JV Dr expense / Cr staff advances, CRV return, BPV/CPV extra, `settled` releases) (makes T202, T203 pass)
- [ ] T207 [US16] Add `apps/api/src/routes/advances.routes.ts` (`/advances` CRUD, shared actions, `POST /advances/:id/voucher`) and `apps/api/src/routes/settlements.routes.ts` (`/settlements`, shared actions, `POST /settlements/:id/vouchers`) and `GET /reports/advances-outstanding` in `reports.routes.ts`; register in `apps/api/src/routes/index.ts`
- [ ] T208 [P] [US16] Build `apps/web/src/app/[locale]/(app)/finance/advances/{page.tsx,new/page.tsx,[id]/page.tsx}` (advance and settlement screens with receipts upload) and `apps/web/src/app/[locale]/(app)/reports/advances-outstanding/page.tsx` (by person, age, amount) in `apps/web/src/features/advances/`
- [ ] T209 [US16] Add `advances` strings (ar + en)

**Checkpoint**: US16 independently testable.

---

## Phase 22: User Story 19 — Reports 4–10 and the document trail (Priority: P2)

**Goal**: Open commitments, supplier history, GL, account statement, trial balance, bank/cash
books, and the two-way document trail with signatures and attachments.

**Independent Test**: From the RTHA BPV open the trail and reach every upstream document; the
trial balance balances.

### Tests for User Story 19 (P2 part) ⚠️

- [ ] T210 [P] [US19] Integration test `apps/api/tests/integration/trail.int.test.ts`: from the RTHA BPV, PR, RFQ, analysis, award, PO, GRN, and invoice are each reachable with signatures and attachments (US19-4, SC-006); nodes the caller cannot read appear as `{ docType, number, restricted: true }`; the trail works from the PR downward too
- [ ] T211 [P] [US19] Extend `apps/api/tests/integration/reports.int.test.ts`: trial balance total debits = total credits for any period (US19-3, SC-011); bank book running balance starts from opening balance + prior lines; open commitments equals Σ open `budget_commitment` rows; supplier history lists invitations, offers, awards, POs, GRNs, payments (FR-014)

### Implementation for User Story 19 (P2 part)

- [ ] T212 [US19] Implement `apps/api/src/services/trail.service.ts` (calls `app.document_trail`, adds signatures and attachments per node) and `apps/api/src/routes/trail.routes.ts` (`GET /trail/:docType/:docId`), and replace the trail stub in `apps/api/src/routes/document-actions.ts` (makes T210 pass)
- [ ] T213 [US19] Extend `apps/api/src/services/report.service.ts`, `apps/api/src/repositories/report.repository.ts`, and `apps/api/src/routes/reports.routes.ts` with `/reports/open-commitments`, `/supplier-history`, `/general-ledger`, `/account-statement`, `/trial-balance`, `/bank-book`, `/cash-book` and `.xlsx` exports (`reports:read` / `reports:finance`); add `GET /suppliers/:id/history` in `suppliers.routes.ts` (makes T211 pass)
- [ ] T214 [P] [US19] Build `apps/web/src/app/[locale]/(app)/trail/[type]/[id]/page.tsx` with `apps/web/src/features/trail/` (whole chain on one page, each node one click to its document and one to its attachment) and a "Trail" link on every document page
- [ ] T215 [P] [US19] Build `apps/web/src/app/[locale]/(app)/reports/{open-commitments,supplier-history,general-ledger,account-statement,trial-balance,bank-book,cash-book}/page.tsx` and the supplier history tab on `procurement/suppliers/[id]/page.tsx`; each report also exports to PDF through the print kit alongside the `.xlsx` from T213 (FR-084)
- [ ] T216 [US19] Add trail and report strings to the `trail` and `reports002` namespaces (ar + en)

**Checkpoint**: US19 complete.

---

## Phase 23: User Story 20 — Printing (Priority: P2)

**Goal**: Every approvable document prints in ar and en with logo, number, watermark, amount in
words, signature blocks from electronic approvals, and linked waivers; the BPV reproduces BPV-35.

**Independent Test**: Print each document type from the RTHA chain and BPV-35 in both languages
and compare with the samples.

### Tests for User Story 20 ⚠️

- [ ] T217 [P] [US20] Unit test `apps/api/tests/unit/print-002.service.test.ts`: every `/…/:id/print` returns the shared envelope (organization, document with watermark `DRAFT | PENDING | REJECTED | CANCELLED | REVERSED | null`, waivers from the trail, signatures by block key); labels from `print_snapshot` once approved or posted; BPV data has every BPV-35 zone in print-layout.md (project, document no, date, payee, cheque no, amount, currency, words, the 12 table columns, total row, PAID stamp with the posting date, four signature blocks) (US20-1, US20-3)
- [ ] T218 [P] [US20] Write `apps/web/e2e/bpv-35.spec.ts` (ar and en) following quickstart "Manual acceptance B": direct salary payment → `BPV-MAD-2026-0035` dated 24/09/2026, cheque 35, posted; the PDF text contains every BPV-35 field, "Three Million Forty Thousand Eight Hundred Sudanese Pounds", line 1 labelled SDG at 1.0000, and "PAID" with the posting date (SC-007, SC-008)

### Implementation for User Story 20

- [ ] T219 [US20] Implement print data services in `apps/api/src/services/print/` (`analysis`, `opening-record`, `po`, `contract`, `amendment`, `grn`, `scc`, `waiver`, `payment-request`, `voucher`, `advance`, `settlement`) on one envelope builder `print-envelope.ts`, with `GET /:docs/:id/print?locale=` mounted through `document-actions.ts` and on `grns`/`completion-certificates`/`tenders/:id/opening`; freeze `print_snapshot` at approval/posting in the adapters (makes T217 pass)
- [ ] T220 [P] [US20] Templates `apps/web/src/features/analysis/print/analysis-document.tsx` and `apps/web/src/features/sourcing/print/opening-record-document.tsx`
- [ ] T221 [P] [US20] Templates `apps/web/src/features/orders/print/{po-document,contract-document,amendment-document}.tsx` (PO per RTHA sheet "Purchase Order" with Requested By · Finance Check · Authorized By · Supplier Acknowledgement)
- [ ] T222 [P] [US20] Templates `apps/web/src/features/receiving/print/{grn-document,scc-document}.tsx` (GRN per RTHA sheet "GRN") and `apps/web/src/features/waivers/print/waiver-document.tsx`
- [ ] T223 [P] [US20] Templates `apps/web/src/features/payments/print/payment-request-document.tsx` (RTHA sheet "Payment Request" with method checkboxes and the charge-as-follows table) and `apps/web/src/features/advances/print/{advance-document,settlement-document}.tsx`
- [ ] T224 [P] [US20] Templates `apps/web/src/features/vouchers/print/{payment-voucher-document,receipt-voucher-document,journal-voucher-document}.tsx` following the BPV/CPV layout checklist, with a landscape fallback when the table overflows (plan Risks) (makes T218 pass)
- [ ] T225 [US20] Add a print button to every document page via `apps/web/src/features/documents/print-button.tsx` and the print labels (ar + en)

**Checkpoint**: US20 independently testable.

---

## Phase 24: User Story 21 — Lists, My tasks, notifications, history (Priority: P2)

**Goal**: Every new document type in lists with filters and search, one My tasks across all
types, in-app notifications including scheduled ones, and a timeline on every document.

**Independent Test**: Assign tasks of several types to one user and verify My tasks,
notifications, and timelines.

### Tests for User Story 21 ⚠️

- [ ] T226 [P] [US21] Integration test `apps/api/tests/integration/my-tasks-002.int.test.ts`: a payment request awaiting approval and an award awaiting the user's committee signature both appear in `GET /my-tasks` grouped by type (US21-1); declarations, GRN/SCC second signatures, opening attendee signatures, and vouchers to post appear for eligible users only; `/prs/my-tasks` keeps its 001 contract
- [ ] T227 [P] [US21] Integration test `apps/api/tests/integration/notifications-002.int.test.ts`: `app.emit_due_notifications()` creates one notification each for an RFQ deadline passed (procurement officer, US21-2), a guarantee expiring within 30 days (procurement officer + Finance Manager, US8-4), a supplier document expiring, vetting due, an advance overdue, and retention release due, and none on rerun (dedupe)
- [ ] T228 [P] [US21] Integration test `apps/api/tests/integration/doc-history.int.test.ts`: every new document's `GET /:docs/:id/history` shows each state change, signature, and edit with who and when (US21-3); for every registry table except PR, deleting a non-draft row raises `INVALID_STATE` (FR-093, Principle I)

### Implementation for User Story 21

- [ ] T229 [US21] Write `packages/database/migrations/0022_scheduled_notifications.sql`: `app.emit_due_notifications()` (security definer, fixed `search_path`, `dedupe_key` per R29 such as `deadline:{eventId}`, `guarantee:{id}:{expiry}`) and a pg_cron job every 15 minutes guarded by `create extension if not exists pg_cron` availability; apply it (makes T227 pass)
- [ ] T230 [US21] Implement `apps/api/src/services/scheduled-notification.service.ts`: the fallback `setInterval` sweeper (`NOTIFICATION_SWEEP_INTERVAL_MS`, default 900000) under `pg_try_advisory_lock`, started in `apps/api/src/index.ts` when pg_cron is absent, plus the lazy sweep when My tasks or notifications load; add `NOTIFICATION_SWEEP_INTERVAL_MS=900000` (commented, optional) to `apps/api/.env.example` (Principle IV)
- [ ] T231 [US21] Implement `apps/api/src/services/task.service.ts` over `my_task_candidates` filtered with the same eligibility function as approve, and `GET /my-tasks` in `apps/api/src/routes/my-tasks.routes.ts` (makes T226 pass)
- [ ] T232 [US21] Ensure every new doc route exposes `GET /:id/history` through `doc-history.service.ts` and that `audit.log_change`'s parent map covers every child table (makes T228 pass)
- [ ] T233 [P] [US21] Add list filters and search (status, office, grant, supplier, dates, amount, number/description `q`) to every new list endpoint and screen: `rfqs`, `tenders`, `bid-analyses`, `waivers`, `pos`, `contracts`, `grns`, `invoices`, `payment-requests`, `direct-payments`, `advances`, `vouchers` (repositories + `apps/web/src/features/*/…-list-*.tsx`)
- [ ] T234 [P] [US21] Generalize `apps/web/src/app/[locale]/(app)/my-tasks/page.tsx` to the grouped `/my-tasks` response and render the new notification kinds (data-model §9) in `apps/web/src/features/notifications/` with links by `docType`/`docId`
- [ ] T235 [P] [US21] Add the `history-timeline` from `features/documents` to every new document page
- [ ] T236 [US21] Add `documents` namespace strings for tasks and notification kinds (ar + en)

**Checkpoint**: All P2 stories complete.

---

## Phase 25: User Story 17 — Shared cost allocation (Priority: P3)

**Goal**: Allocation templates (Σ 100%) applied to a posted expense create a JV moving the cost
to target budget lines with Available rechecked.

**Independent Test**: Allocate a posted rent payment 60/40 between two grants and verify the JV
and budget figures.

- [ ] T237 [P] [US17] Integration test `apps/api/tests/integration/allocation.int.test.ts`: a template totalling 95% cannot be saved (`ALLOCATION_NOT_100`, US17-1); applying 60/40 to a 1,000,000 SDG rent expense creates a JV moving 600,000 and 400,000 (last line takes the rounding residue), blocked with `BUDGET_EXCEEDED` if either target lacks Available (US17-2); JV lines carry `allocation_source_line_id`
- [ ] T238 [P] [US17] Add `packages/shared/src/schemas/allocation.ts` and `apps/api/src/repositories/allocation.repository.ts`
- [ ] T239 [US17] Implement `apps/api/src/services/allocation.service.ts` and `apps/api/src/routes/allocations.routes.ts` (`GET/POST/PUT /allocations`, `POST /allocations/:id/apply { voucherLineId }` → JV draft, `allocation:manage`); register in `apps/api/src/routes/index.ts` (makes T237 pass)
- [ ] T240 [P] [US17] Build `apps/web/src/app/[locale]/(app)/finance/allocations/page.tsx` with `apps/web/src/features/accounting/allocation-*.tsx` (template editor with live Σ, apply from a posted voucher line) and strings (ar + en)

**Checkpoint**: US17 independently testable.

---

## Phase 26: User Story 18 — Bank reconciliation (Priority: P3)

**Goal**: Enter or import statement lines per account and month, match to posted voucher lines,
show unreconciled items, and sign off only when balanced.

**Independent Test**: Import a month's statement, match lines, and sign off.

- [ ] T241 [P] [US18] Integration test `apps/api/tests/integration/reconciliation.int.test.ts`: sign-off requires `opening + Σ matched = closing`, else `RECONCILIATION_UNBALANCED` with the difference (US18-1); matches cannot be inserted or deleted while signed off; reopening needs a reason (US18-2); CSV/Excel import uses the preview pattern
- [ ] T242 [P] [US18] Add `packages/shared/src/schemas/reconciliation.ts` and `apps/api/src/repositories/bank-statement.repository.ts`
- [ ] T243 [US18] Implement `apps/api/src/services/reconciliation.service.ts` and `apps/api/src/routes/bank-reconciliations.routes.ts` (`/bank-reconciliations`, `/:id/lines`, `/:id/import`, `/:id/matches`, `/:id/sign-off`, `/:id/reopen`, `bank:reconcile`); register in `apps/api/src/routes/index.ts` (makes T241 pass)
- [ ] T244 [P] [US18] Build `apps/web/src/app/[locale]/(app)/finance/reconciliation/{page.tsx,[id]/page.tsx}` with `apps/web/src/features/accounting/reconciliation-*.tsx` (statement lines, candidate voucher lines, match, unreconciled list, reconciled vs closing balance, sign-off/reopen) and strings (ar + en)

**Checkpoint**: All stories complete.

---

## Phase 27: Polish & Cross-Cutting Concerns

**Purpose**: Performance, security, business-rule traceability, E2E coverage, and validation

- [ ] T245 Extend `apps/api/tests/integration/helpers/bulk.ts` with the 002 perf seed (5,000 PRs, 3,000 POs, 20,000 posted voucher lines on one tenant) and write `apps/api/tests/integration/reports.perf.test.ts` asserting Budget vs Actual and the donor report < 3 s and document lists p95 < 500 ms (SC-005); if it fails, add trigger-maintained totals behind `budget_line_balance` (research D2 fallback) in a new migration
- [ ] T246 [P] Add `apps/api/tests/unit/business-rules-002.index.test.ts` mapping BR-1…BR-22 and the six clarifications to the test files that prove them, failing if a mapped file is missing (Principle X)
- [ ] T247 [P] Security pass documented in `specs/002-procurement-to-payment/checklists/security.md`: rls-lint green for every new table; sealed-price checks across API list/detail/print/export/search and the storage `offer_scan` policy; no computed or inherited field accepted by any Zod schema (`.strict()` review); signed URLs short-lived; no new secrets (`git grep`)
- [ ] T248 [P] Write `apps/web/e2e/advance-settlement.spec.ts` (ar and en) for US16 and extend `apps/web/e2e/negative-checks.spec.ts` with quickstart "Negative checks (spot)" for 002 (mixed grants, expired-certificate award, splitting warning, milestones 90%, amendment over Available, procurement-only category, currency mismatch, JV without reason and over Available, used account delete, allocation 95%, unbalanced reconciliation)
- [ ] T249 [P] Update root `README.md` with the 002 modules, migrations 0012–0022, the pg_cron fallback variable, and new test commands
- [ ] T250 Run the full quickstart validation (`pnpm lint && pnpm type-check`, every suite, manual acceptance A and B) and capture ar and en screenshots of the RFQ, analysis, PO, GRN, payment request, BPV print, trail, and Budget vs Actual via Chrome DevTools MCP into `specs/002-procurement-to-payment/screenshots/`; commit

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none; T001 gates `/speckit-implement`
- **Foundational (Phase 2)**: depends on Setup; BLOCKS every story; ends with the 001 regression gate (T036)
- **P1 chain (Phases 3–14)**: sequential in the plan order, because each document is created from the previous one: US1 → US2 → US3 → US4 → US5 → US6 → US7 → US11 → US12 → US13 → US12 import → US19 (1–3)
- **P1 gate (Phase 15)**: depends on Phases 3–14 and on 001 T159/T160 (demo seed and PR fixture)
- **P2 (Phases 16–24)**: depend on the P1 gate
- **P3 (Phases 25–26)**: depend on US13 and US14
- **Polish (Phase 27)**: depends on all desired stories

### User Story Dependency Graph

```text
Setup → Foundational (D1 engine, D2 commitments, 0014 accounting tables, permissions, print kit) ─▶ regression gate
  └▶ US1 config ─▶ US2 suppliers ─▶ US3 RFQ ─▶ US4 opening ─▶ US5 award ─▶ US6 PO ─▶ US7 GRN
       ─▶ US11 invoice + payment request ─▶ US12 accounts/periods ─▶ US13 vouchers ─▶ US12 import
       ─▶ US19 reports 1–3 ─▶ P1 GATE (RTHA chain E2E)
             ├▶ US8 contracts/SCC (needs US6, US7, US11)
             ├▶ US9 tenders (needs US3–US5; cash securities need US14)
             ├▶ US10 waivers/amendments/cancel (needs US3, US6)
             ├▶ US14 receipts/JV/TRF (needs US13)
             ├▶ US15 direct payments (needs US13)
             ├▶ US16 advances (needs US13, US14 CRV)
             ├▶ US19 reports 4–10 + trail (needs 0020; best after US8–US16)
             ├▶ US20 prints (needs the documents it prints; BPV-35 needs US15)
             └▶ US21 tasks/notifications (needs every doc type; guarantees need US8)
       ─▶ US17 allocation, US18 reconciliation (need US13, US14) ─▶ Polish
```

### Within Each User Story

- Tests first; confirm they fail
- Migration (when the story owns one) → shared pure functions and Zod schemas → repositories →
  services and doc adapters → routes → web pages → i18n strings
- Story checkpoint before moving on; commit after each `/speckit-implement` phase

### Parallel Opportunities

- Setup: T002–T004 together
- Foundational: all test tasks T005–T011 together; shared tasks T018–T022 together while
  migrations T012–T015 run in order; T029–T032 together after T026; T034 and T035 together
- Inside each story: the [P] tests together, then the [P] schema/repository/shared tasks
  together, then web pages in parallel with route registration
- After the P1 gate: US8, US9, US10 (procurement team) and US14, US15, US16 (finance team) in
  parallel; US20 templates T220–T224 in parallel; US17 and US18 in parallel
- Not parallel with each other: tasks that extend the same file across stories
  (`sourcing.service.ts`, `purchase-order.service.ts`, `payment-request.service.ts`,
  `voucher.service.ts`, `generate-voucher.ts`, `report.service.ts`, `routes/index.ts`,
  `messages/*.json`)

---

## Parallel Example: User Story 13

```bash
# Tests first, together:
Task: "Unit test packages/shared/tests/accounting/generate-voucher.test.ts"
Task: "Integration test apps/api/tests/integration/voucher-integrity.int.test.ts"
Task: "Integration test apps/api/tests/integration/budget-concurrency-002.int.test.ts"

# After migration T136, together:
Task: "Implement packages/shared/src/accounting/generate-voucher.ts and balance.ts"
Task: "Add packages/shared/src/schemas/voucher.ts"
Task: "Add apps/api/src/repositories/voucher.repository.ts and voucher-line.repository.ts"
```

## Parallel Example: P2 after the P1 gate

```bash
Developer A (procurement): T160–T168 (US8) → T169–T177 (US9) → T178–T186 (US10)
Developer B (finance):     T187–T194 (US14) → T195–T201 (US15) → T202–T209 (US16)
Developer C (cross-cut):   T217–T225 (US20 templates) → T226–T236 (US21)
```

---

## Implementation Strategy

### MVP First

A purchase has no value until money is recorded on the budget line, so the MVP is the whole P1
chain:

1. Phase 1 Setup → Phase 2 Foundation → **regression gate** (001 unchanged)
2. Phases 3–14 in order, validating each story at its checkpoint
3. Phase 15 **P1 gate**: RTHA chain E2E in ar and en (SC-001); demo it

### Incremental Delivery

1. MVP (P1 chain + reports 1–3)
2. + US8, US9, US10: services, tenders, and exceptions
3. + US14, US15, US16: receipts, direct payments, advances
4. + US19 (4–10, trail), US20 prints (BPV-35), US21 tasks and notifications
5. + US17, US18 (P3; may slip without blocking anything)
6. Polish: performance, security, BR index, quickstart, screenshots

---

## Notes

- [P] tasks = different files, no dependency on incomplete tasks
- Each migration file is written whole in the first phase that needs it and applied once; seeds
  are registered through `app.tenant_seed_hook` so new tenants and existing tenants get the
  defaults of every applied migration
- `0021_bootstrap_002.sql` is written in the foundation (it touches only 001 tables and the
  registry), ahead of 0015–0020; `migrate.ts` applies pending files by name, and a fresh database
  applies them in filename order without conflict
- Out of scope (inventory, asset register, payroll, supplier portal, donor layouts, automated
  sanctions screening, bank integration) goes to a backlog note, not code
