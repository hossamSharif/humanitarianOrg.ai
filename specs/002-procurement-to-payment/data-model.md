# Data Model: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

**Feature**: `002-procurement-to-payment` | **Date**: 2026-11-16 | **Plan**: [plan.md](./plan.md)
| **Research**: [research.md](./research.md)

This extends [001 data-model](../001-grants-pr-foundation/data-model.md). All 001 conventions
apply to every new table unless stated:

- `id uuid` PK; `tenant_id` with RLS in the same migration through `app.setup_tenant_table`.
- `created_at`, `updated_at`, `created_by`; the `audit.log_change` trigger.
- Money `numeric(18,2)`, quantity `numeric(18,3)`, rates `numeric(18,6)`, percentages and scores
  `numeric(5,2)`.
- Bilingual `name_ar`/`name_en`.
- No hard delete after draft. Master data is deactivated.

Common column groups (abbreviated below):

| Group | Columns |
|---|---|
| **⟨doc⟩** | `number text null` (unique `(tenant_id, number)`, set at first submission), `status text`, `version integer` (optimistic concurrency, `bump_version` trigger), `office_id uuid` (numbering + RLS scope), `submission_cycle smallint default 0`, `current_step_order smallint null`, `submitted_at`, `approved_at`, `cancelled_at timestamptz null`, `cancel_reason`, `reject_reason`, `return_reason text null`, `print_snapshot jsonb null` (frozen at approval / posting) |
| **⟨doa⟩** | `doa_currency char(3)`, `doa_amount numeric(18,2)`, `doa_rate_to_base`, `doa_rate_date`, `doa_rate_source`, `doa_exchange_rate_id`; locked at submission (001 R7) |
| **⟨rate⟩** | `rate_to_base numeric(18,6)`, `rate_date date`, `rate_source text`, `exchange_rate_id uuid null`; `1 / date / 'base' / null` when the currency is the base currency |
| **⟨dims⟩** | `grant_id`, `budget_line_id`, `location_office_id`, `activity_id null` (Principle III) |

Migrations, applied in order:

| File | Content |
|---|---|
| `0012_doc_engine.sql` | doc-type registry; `doc_approval_step` and `doc_signature`; PR data copied in; compatibility views; `app.can_read_doc`; generic doc types on approval rules and numbering; generalized notification and audit; `doc_attachment` and its bucket |
| `0013_budget_commitment_generalize.sql` | D2 columns, indexes, and the guard function |
| `0014_accounting_setup.sql` | §6 |
| `0015_procurement_config_suppliers.sql` | §2, §3 |
| `0016_sourcing.sql` | §4 |
| `0017_orders_receipt.sql` | §5 |
| `0018_payments.sql` | §7 |
| `0019_vouchers.sql` | §8 plus `budget_line_balance` with Actual |
| `0020_reports_trail.sql` | §10 |
| `0021_bootstrap_002.sql` | §11 seeds in `app.bootstrap_tenant` and a backfill for existing tenants |
| `0022_scheduled_notifications.sql` | pg_cron job |

---

## 1. Generic document engine (D1)

### app.doc_type_registry (global reference)

| Column | Type | Rules |
|---|---|---|
| code | text PK | `PR, RFQ, TND, QA, WVR, PO, CON, AMD, GRN, SCC, INV, PAY, DPR, ADV, STL, BPV, CPV, BRV, CRV, JV, TRF` |
| table_name | regclass | parent table (`purchase_requisition`, `sourcing_event`, `bid_analysis`, …) |
| office_column | text | column used for office scope |
| approval_doc_type | text null | DoA type: `PR, AWARD, PO, CON, AMD, WAIVER, PAY, DPR, PV, RV, JV, ADV, STL`. Null for types without a DoA route (GRN, SCC, INV, RFQ, TND) |

The DoA types `PV` (BPV, CPV, TRF), `RV` (BRV, CRV), and `JV` group voucher kinds that share a
route.

### doc_approval_step (replaces table `pr_approval_step`)

Same columns as 001 `pr_approval_step`, with these changes:

- `pr_id` is replaced by `doc_type text` (FK registry) and `doc_id uuid`.
- `kind` is one of `finance_check | check | approval | final_approval`.
- `unique (doc_type, doc_id, cycle, step_order)`.
- Index `(tenant_id, status)` and index `(doc_type, doc_id)`.
- `app.doc_ref_check` BEFORE INSERT verifies that the parent exists.

### doc_signature (replaces table `approval_action`)

Same columns as 001 `approval_action`, with these changes:

- `pr_id` is replaced by `doc_type` and `doc_id`.
- `action` adds:
  - `committee_sign`, `declare_coi`;
  - `attend` (opening record);
  - `received`, `inspected` (GRN);
  - `certified`, `confirmed` (SCC);
  - `acknowledge_warning` (splitting warning);
  - `override_match`;
  - `post`, `reverse`;
  - `imported`.
- Insert-only: `app.block_modification` trigger, update/delete revoked.
- Unique partial index `(doc_type, doc_id, cycle, user_id) where action = 'approve'`.
- Unique `(doc_type, doc_id, user_id, action) where action in ('received','inspected','certified','confirmed','committee_sign','declare_coi','attend')`.
- `approval_action_reason_required` is carried over, extended to `override_match` and `reverse`.

### Compatibility views (001 names, auto-updatable)

```text
pr_approval_step  = select id, tenant_id, doc_id as pr_id, cycle, step_order, kind, required_role_id,
                    rule_step_id, assigned_user_id, status, acted_at, created_at, updated_at,
                    created_by, doc_type
                    from doc_approval_step where doc_type = 'PR'  with cascaded check option
approval_action   = same pattern over doc_signature
```

Both are `security_invoker = true`, with `alter view … alter column doc_type set default 'PR'`.
The migration copies rows with their ids preserved. FKs that pointed at the old tables now point
at the base tables (for example `doc_signature.step_id → doc_approval_step`).

### Helpers

- `app.can_read_doc(doc_type text, doc_id uuid) → boolean` (security definer, stable): the parent
  row exists in the tenant and the caller has office access to the registry's office column.
  For PRs the requester also sees their own documents, as in 001.
- `app.approval_rule_check(rule_id)` (0011) is generalized: the first-step kind is required per
  `approval_doc_type` (`PR` → `finance_check`; `PV, RV, JV` → `check`).

### Changes to 001 tables

| Table | Change |
|---|---|
| `approval_rule.doc_type` | check → FK to the set of `approval_doc_type` values |
| `numbering_config.doc_type`, `document_sequence.doc_type` | check → FK `app.doc_type_registry(code)` |
| `notification` | `pr_id` nullable; add `doc_type text null`, `doc_id uuid null`, `dedupe_key text null`; check `(pr_id is not null) or (doc_type is not null and doc_id is not null)`; trigger sets `doc_type='PR', doc_id=pr_id` for PR rows; unique partial `(tenant_id, user_id, dedupe_key) where dedupe_key is not null`; `kind` set in §9 |
| `audit_history` | add `doc_type text null`, `doc_id uuid null` (filled by `audit.log_change` from a per-table parent map, alongside `pr_id`); index `(doc_type, doc_id, occurred_at)` |
| `budget_line` | add `expense_account_id uuid null` FK `gl_account` (posting account, type `expense`) |
| `exchange_rate_locked_when_used()` | also checks every ⟨rate⟩ column added in this feature (one `exists` per table, via the `app.exchange_rate_usage` view) |
| `purchase_requisition.status` | adds `in_procurement`, `closed` after `approved` (spec assumption). `approved → in_procurement` on the first sourcing of any line; `→ closed` when every line is ordered or cancelled (FR-038) |
| `pr_line` | add `sourcing_status text not null default 'not_sourced'` (`not_sourced | in_sourcing | ordered | cancelled`), `cancel_reason text null`; partial unique enforcement of one open event per line is in §4 |

### doc_attachment

| Column | Type | Rules |
|---|---|---|
| doc_type, doc_id | text, uuid | `app.doc_ref_check` |
| purpose | text | `general | offer_scan | po_acknowledgement | received_by_copy | receipt | publication_evidence | tor | guarantee | supplier_document | vetting_evidence | statement_import` |
| storage_path | text | `{tenant}/{doc_type}/{doc_id}/{id}` in bucket `doc-attachments` |
| file_name, mime_type, size_bytes, uploaded_by, deleted_at | — | same rules as 001 `pr_attachment` (10 MB, allow-list, ≤ 20 per doc) |

---

## 2. Procurement configuration (US1)

### procurement_setting (one row per tenant)

| Column | Type | Default | Rules |
|---|---|---|---|
| invoice_price_tolerance_pct | numeric(5,2) | 0 | 0–100 |
| invoice_qty_tolerance_pct | numeric(5,2) | 0 | 0–100 |
| grn_over_delivery_tolerance_pct | numeric(5,2) | 0 | 0–100 |
| committee_min_size | smallint | 3 | `>= 2` (clarification Q1) |
| revetting_months | smallint | 12 | ≥ 1 |
| guarantee_warning_days | smallint | 30 | ≥ 1 |
| advance_overdue_days | smallint | 30 | ≥ 0 |
| require_po_acknowledgement | boolean | true | |
| splitting_window_days | smallint | 30 | |

### procurement_method_band / grant_procurement_rule

| Column | Type | Rules |
|---|---|---|
| tenant_id; `grant_id` (grant rule only) | uuid | |
| method | text | `direct | rfq | tender` |
| min_amount, max_amount | numeric(18,2) null | `(min, max]` in the DoA reference currency; null min = 0, null max = ∞ |
| min_quotations | smallint | ≥ 1 |

Guard (service + deferred trigger, like 0011): each set is contiguous from 0, non-overlapping,
with an open top (`PROCUREMENT_BANDS_INVALID`, `details: { gaps, overlaps }`). Method rank:
direct 1 < rfq 2 < tender 3. Seed: `(0,1000] direct 1; (1000,25000] rfq 3; (25000,∞) tender 3`.

### deduction_type

| Column | Type | Rules |
|---|---|---|
| name_ar, name_en | text | |
| rate_pct | numeric(5,2) | 0–100 |
| applies_to | text | `goods | services | both` |
| payable_account_id | uuid | FK `gl_account` (liability, posting) |
| is_active | boolean | |

Seed: "Withholding tax – goods" 0%, "Withholding tax – services" 0% (rates set by the admin).

### payment_category

`code`, `name_ar`, `name_en`, `procurement_only boolean` (US15-3), `is_active`. Seed: salary,
allowance, rent, utilities, per_diem, transport_refund, tax_remittance (all false), and goods
(true).

---

## 3. Suppliers (US2)

### supplier

| Column | Type | Rules |
|---|---|---|
| legal_name_ar, legal_name_en, trade_name | text | bilingual legal name required |
| type | text | `company | individual | government | ngo` |
| registration_no, tax_no | text null | normalized copies (`upper(btrim)`) are indexed for duplicate warnings |
| address, city, phone, email, contact_person | text null | phone normalized digits indexed |
| bank_name, bank_branch, bank_account_name, bank_account_no | text null | account normalized and indexed |
| notes | text null | |
| status | text | `pending_vetting → approved → suspended | blacklisted`; `suspended/blacklisted → approved` allowed with vetting current |
| status_reason | text null | required (check) when status ∈ {suspended, blacklisted} (US2-5) |
| last_vetted_at | date null | from the latest passing vetting |
| rating_avg_on_time, rating_avg_quality, rating_avg_docs, rating_count | numeric(3,2), smallint | maintained by trigger on `supplier_rating` |

Derived in the view `supplier_compliance`:

- `vetting_overdue = last_vetted_at is null or last_vetted_at + revetting_months < current_date`;
- `has_expired_required_doc`;
- `can_invite = status = 'approved'`;
- `can_award_or_pay = can_invite and not vetting_overdue and not has_expired_required_doc`.

When it is false, a waiver with category `expired_document` is needed (FR-011).

### supplier_category / supplier_category_link

The tenant list (`code`, names) and the many-to-many link.

### supplier_document

`supplier_id`, `doc_kind` (`registration | tax | other`), `is_required boolean`, `number`,
`issue_date`, `expiry_date date null`, `attachment_id` (FK `doc_attachment`).

### supplier_vetting

Insert-only: `supplier_id`, `checked_on date`, `checked_by uuid`, `lists_checked text[]`, `result`
(`clear | match | inconclusive`), `notes`, `evidence_attachment_id`. Approval needs a `clear`
vetting within the re-vetting period (FR-010).

### supplier_rating

`supplier_id`, `po_id` (unique per PO), `on_time`, `quality`, `documentation` (smallint 1–5),
`rated_by`, `comment`.

### staff_payee

`membership_id null`, `full_name_ar`, `full_name_en`, `bank_name`, `bank_branch`,
`bank_account_name`, `bank_account_no`, `is_active`. Used for direct payments and advances, and
in duplicate checks (FR-012).

Duplicate check: `supplier_duplicates(supplier_id)` returns matches on normalized registration,
tax, phone, or bank account across `supplier` and `staff_payee`. The result is a warning in the
API (US2-3), never a block.

---

## 4. Sourcing, offers, analysis, award, waiver (US3–US5, US9, US10)

### sourcing_event (⟨doc⟩; numbering `RFQ` / `TND`)

| Column | Type | Rules |
|---|---|---|
| kind | text | `rfq | tender` |
| grant_id | uuid | one grant (US3-5); equals every linked PR's grant (trigger) |
| office_id | uuid | requesting office of the source PRs (must be one office) |
| title | text | |
| issue_date | date | |
| submission_deadline | timestamptz | > issue date |
| delivery_place, delivery_terms, payment_terms | text | |
| currency | char(3) | quotation / comparison currency |
| offer_validity_days | smallint | |
| split_award_allowed | boolean | |
| required_method, required_min_quotations | text, smallint | from D4 resolution, snapshot |
| chosen_method | text | `≥ required` or waiver required |
| estimated_value_doa | numeric(18,2) | from the PRs' locked rates |
| method_snapshot | jsonb | bands used (tenant and grant) |
| splitting_warning | jsonb null | `{ prIds, total, bandMax }`; acknowledgement in `doc_signature` `acknowledge_warning` with comment |
| opened_at | timestamptz null | set only by the opening command (D3) |
| reissued_from_id | uuid null | self FK (re-issue / re-tender link, FR-022, FR-049) |
| tender fields | | `clarification_deadline timestamptz`, `opening_place text`, `bid_security_required boolean`, `bid_security_amount numeric null`, `bid_security_pct numeric null`, `bid_security_type text null`, `bid_security_validity_days smallint null` |

**Status**: `draft → issued → closed → opened → evaluated → awarded`, or `cancelled`. A
re-issued event becomes `cancelled` with reason `reissued`. `closed` is derived on read when
`now() > deadline` and status is `issued`, and persisted by the opening command.

Issue guards:

- criteria weights per stage = 100.00 (FR-017, US3-2);
- invited approved suppliers ≥ `required_min_quotations`, or an approved waiver (US3-4);
- `chosen_method rank ≥ required`, or an approved waiver (FR-016);
- the splitting warning, when present, is acknowledged.

### sourcing_line

| Column | Type | Rules |
|---|---|---|
| sourcing_event_id | uuid | |
| line_no | smallint | |
| pr_line_id | uuid | FK `pr_line`; **unique partial index `(pr_line_id) where is_open`** keeps one open event per PR line (BR-22, US3-3); `is_open` is maintained by trigger from the event status (not `cancelled`/`awarded` with the line unawarded) |
| description, specifications | text | may be reworded (FR-015) |
| quantity | numeric(18,3) | copied from the PR line, read-only |
| unit_id | uuid | copied |
| lot_id | uuid null | tender lot |

### sourcing_criterion

`sourcing_event_id`, `stage` (`single | technical | financial`), `kind` (`essential | weighted`),
`code` (e.g. `price`, `quality`, `validity`, `delivery`, `experience`), `name_ar`, `name_en`,
`weight_pct numeric(5,2) null` (weighted only), `is_price boolean` (exactly one per
weighted stage that scores price). Σ weight per stage = 100.

### sourcing_invitation

`sourcing_event_id`, `supplier_id` (status `approved` at invitation; a warning when the supplier
is not compliant, US2-1), `invited_on date`, `channel` (`email | whatsapp | in_person |
newspaper | website | notice_board`), unique `(event, supplier)`.

### tender_lot / tender_publication / tender_clarification

- `tender_lot`: `lot_no`, `title`.
- `tender_publication`: `channel`, `published_on`, `reference`, `evidence_attachment_id`.
- `tender_clarification`: `question`, `asked_by_supplier_id null`, `asked_on`, `answer`,
  `answered_on`, `shared_on` (FR-045).

### offer (receipt log; never sealed)

| Column | Type | Rules |
|---|---|---|
| sourcing_event_id, supplier_id | uuid | supplier must be invited (RFQ) or any approved supplier (tender) |
| received_at | timestamptz | |
| received_by | uuid | |
| status | text | `logged | replaced | late | late_accepted | withdrawn | disqualified` |
| replaces_id | uuid null | the previous receipt this one replaces (US4 correction); unique partial `(event, supplier) where status in ('logged','late_accepted')` |
| late_acceptance_reason | text null | RFQ only, set by the opening command |
| disqualification_reason | text null | |
| bid_security_received | boolean | tender |

Trigger: `received_at > submission_deadline` sets `status = 'late'` on insert.

### offer_terms (SEALED)

`offer_id` (PK, 1:1), `currency`, `delivery_days`, `validity_days`, `payment_terms`,
`essential_compliance jsonb` (`{criterionId: pass|fail, note}`), `scan_attachment_id`.

### offer_line_price (SEALED)

`offer_id`, `sourcing_line_id` (unique pair), `unit_price numeric(18,2) ≥ 0`,
`quantity numeric(18,3) null` (if different), `line_total` generated
`round(coalesce(quantity, sourcing_line.qty) × unit_price, 2)`. The quantity default is copied
on insert because generated columns cannot read other tables.

RLS for both sealed tables (D3), select and insert:

```text
tenant_id = app.current_tenant_id()
and app.sourcing_opened(event_id)
and app.may_see_offer_prices(event_id)
and offer.status not in ('late', 'replaced')   -- insert only
```

After the tender opening record is signed (or the analysis is signed, for RFQs), updates are
blocked by trigger (`OFFER_FROZEN`).

### opening_record

`sourcing_event_id` (unique), `opened_at`, `place`, `notes`. Attendees are in
`opening_attendee` (`user_id` or `external_name`, `function`), with ≥ 2 for an RFQ and ≥ 3 for a
tender. A tender's record is signed by each user attendee (`doc_signature` `attend`) and
`signed_complete_at` is set when all have signed.

### bid_security

`offer_id`, `type` (`bank_guarantee | cheque | cash_deposit | insurance`), `amount`, `currency`,
`issuer`, `expiry_date`, `status` (`held | returned | forfeited`), `returned_on`,
`forfeit_reason`. For cash deposits, `receipt_voucher_id` / `return_voucher_id` are FKs to
`voucher` (clarification Q5).

### bid_analysis (⟨doc⟩ ⟨doa⟩; numbering `QA`; DoA type `AWARD`)

| Column | Type | Rules |
|---|---|---|
| sourcing_event_id | uuid | unique where status ≠ cancelled |
| comparison_rates | jsonb | `[{currency, rateToBase, rateDate, source, exchangeRateId}]` at the opening date |
| recommended_offer_id | uuid null | whole award; null when split |
| highest_offer_id | uuid null | computed |
| justification | text null | required when recommended ≠ highest (per line when split) |
| justification_criterion_ids | uuid[] | ≥ 1 when a justification is required (FR-027) |
| waiver_id | uuid null | fewer valid offers than the minimum (FR-022) |
| awarded_amount_doa | numeric(18,2) | DoA amount |
| frozen_at | timestamptz null | set when the first committee member signs; results immutable after |

**Status**: `draft → scoring → signing → pending_approval → approved`, or `returned`,
`rejected`, `cancelled`. Approval sets the event to `awarded`, writes `unsuccessful_notice`
placeholders, and enables PO creation.

### committee_member

`bid_analysis_id`, `user_id`, `function` (`procurement | finance | program | other`),
`declared_at timestamptz null`, `has_conflict boolean null`, `conflict_supplier_ids uuid[]`,
`conflict_note`, `excluded boolean` (`= has_conflict`), `replaced_by_id uuid null`. Unique
`(analysis, user)`. The declaration is also signed in `doc_signature` (`declare_coi`). The
scoring guard is the count of members that are not excluded, have declared, and have no
replacement, and it must be ≥ `committee_min_size` (US5-4).

### evaluation_score

`bid_analysis_id`, `member_id`, `offer_id`, `criterion_id` (weighted, non-price), `score smallint
1..5`, unique on the four. Allowed only when the member has declared and has no conflict.

### analysis_result (computed snapshot)

`bid_analysis_id`, `offer_id`, `sourcing_line_id null` (per line when split), `disqualified
boolean`, `disqualification_reason`, `total_offer_currency`, `total_event_currency`,
`price_points`, `criteria_points jsonb`, `technical_pass boolean null`, `weighted_total`, `rank`.
It is rewritten by the service on every scoring change until `frozen_at`.

### award_line

`bid_analysis_id`, `sourcing_line_id` (unique per analysis), `offer_id`, `supplier_id`
(= offer supplier, trigger), `quantity`, `unit_price`, `currency`, `amount` (generated),
`budget_line_id`, `location_office_id`, `activity_id` (copied from the PR line).

### unsuccessful_notice

`bid_analysis_id`, `offer_id`, `notified_on`, `channel` (FR-031).

### waiver (⟨doc⟩ ⟨doa⟩; numbering `WVR`; DoA type `WAIVER`)

`reason_category` (`single_source | emergency | fewer_quotations | lower_method |
expired_document | overdue_advance | other`), `justification text not null`, `covered_doc_type`,
`covered_doc_id`, `covered_value` and currency. Status `draft → pending_approval → approved`,
or returned, rejected, or cancelled. "Approved waiver linked" means
`exists (approved waiver where covered = doc and reason_category in (…))`.

---

## 5. Purchase orders, contracts, amendments, receipt (US6–US8, US10)

### purchase_order (⟨doc⟩ ⟨doa⟩; numbering `PO` / `CON`)

| Column | Type | Rules |
|---|---|---|
| kind | text | `po | contract` |
| bid_analysis_id | uuid | approved analysis; one PO per (analysis, supplier) |
| supplier_id | uuid | **inherited**: equals the `award_line.supplier_id` of all its lines (trigger) |
| grant_id | uuid | inherited from the sourcing event |
| po_date | date | |
| delivery_address, delivery_schedule, delivery_terms, payment_terms_text, special_conditions | text | |
| currency | char(3) | = offer currency |
| advance_pct, retention_pct | numeric(5,2) | 0–100 |
| retention_release_date | date null | |
| is_service | boolean | service PO uses a completion certificate instead of a GRN |
| total | numeric(18,2) | Σ lines (stored, recomputed by trigger) |
| total_with_amendments | numeric(18,2) | current version total |
| po_version | smallint | 1 + approved amendments |
| commit_rate ⟨rate⟩ + `grant_rate_to_base` | | locked at approval for the commitment conversion |
| acknowledged_at, acknowledged_by_name, acknowledgement_attachment_id | | FR-036 |
| close_reason | text null | manual close |
| is_imported, import_batch_id | | R32 |
| contract fields | | `scope_text`, `tor_attachment_id`, `start_date`, `end_date` (`end ≥ start`) |
| blacklist_flag | boolean, derived in view `purchase_order_flags` | supplier blacklisted after approval (edge case) |

**Status**: `draft → pending_approval → approved → acknowledged → partially_received →
fully_received → closed`, or `returned`, `rejected`, `cancelled`. When no acknowledgement is
required, `approved` goes directly to the receipt states. Auto-close happens when fully
received and Σ posted payments = `total_with_amendments`. For `kind = contract` or
`is_service`, `partially_received` / `fully_received` mean partially / fully certified
(Σ certified amount = `total_with_amendments`, FR-037).

### po_line

`po_id`, `line_no`, `award_line_id`, `sourcing_line_id`, `pr_line_id` (all inherited),
`description`, `quantity`, `unit_id`, `unit_price`, `line_total` (generated), ⟨dims⟩
(inherited, trigger-checked against `pr_line`), `amount_grant` (at the commit rate),
`accepted_qty` (maintained: Σ completed GRN accepted), `invoiced_qty`, `paid_amount` (Σ posted
matched).

### purchase_order_version

`po_id`, `version`, `snapshot jsonb` (header + lines), `created_by_amendment_id`. Insert-only.

### contract_milestone

`po_id` (contract), `seq`, `deliverable`, `pct numeric(5,2) null`, `amount numeric(18,2)`,
`due_date`, ⟨dims⟩ (one budget line per milestone, from the award lines), `certified_pct`
(maintained). Submit guard: Σ pct = 100 and Σ amount = total (US8-1).

### performance_guarantee

`po_id`, `type`, `amount`, `currency`, `issuer`, `expiry_date`, `attachment_id`, `status`
(`held | released | called`).

### po_amendment (⟨doc⟩ ⟨doa⟩; numbering `AMD`; DoA type `AMD`)

`po_id`, `target_version`, `reason`, `before jsonb`, `after jsonb` (header fields: delivery
date and terms; lines: qty and price; milestones), `old_total`, `new_total`, `delta_grant`
(per budget line, in `amendment_budget_delta`). DoA amount = new total. On approval, the
version snapshot is written, the changes are applied, and the commitment is re-split (D2)
with an increase check (US10-2).

### grn (⟨doc⟩ without DoA; numbering `GRN` on creation)

`po_id`, `supplier_id` (inherited, trigger), `received_date`, `delivery_note_no`,
`supplier_invoice_no null`, `shipment_type` (`partial | final`), status `draft → completed`
(both signatures) or `cancelled` (draft only).

### grn_line

`grn_id`, `po_line_id`, `delivered_qty`, `accepted_qty`, `rejected_qty` (check
`accepted + rejected = delivered`), `reject_reason` (required when rejected > 0),
`returned_on date null`, `condition_remarks`, `is_asset boolean`. On completion,
`accepted_qty ≤ ordered × (1 + tol) − already accepted`, checked under the `po_line` lock
(US7-1).

### completion_certificate (numbering `SCC` on creation)

`po_id`, `milestone_id null` | `po_line_id null` (service PO; one required), `period_text`,
`completion_pct numeric(5,2)` (cumulative, 0 < pct ≤ 100, non-decreasing), `certified_amount`
(computed), status `draft → completed` (signatures `certified` + `confirmed` by different
users) or `cancelled`.

---

## 6. Accounting setup (US12)

### gl_account

| Column | Type | Rules |
|---|---|---|
| parent_id | uuid null | self FK; the parent must be a group (`is_posting = false`) |
| code | text | unique per tenant, stored as text (`10102`) |
| name_ar, name_en | text | |
| type | text | `asset | liability | fund_balance | income | expense` (children inherit the parent's type, check by trigger) |
| is_posting | boolean | only posting accounts on voucher lines |
| is_active | boolean | |

DELETE is blocked when referenced by any voucher line (FK restrict, US12-1). Deactivation is
allowed.

### budget_category_account

`(tenant_id, category)` unique → `expense_account_id`. Every budget line resolves
`coalesce(budget_line.expense_account_id, category default)`. Null means `BUDGET_LINE_UNMAPPED`
at voucher generation (US12-2).

### money_account

`kind` (`bank | cash`), `name`, `bank_name`, `branch`, `account_no`, `currency`, `office_id`,
`gl_account_id` (asset, posting, unique), `custodian_user_id` (cash), `opening_balance`,
`opening_date`, `is_active`.

### control_account_setting

`key` (`staff_advances | supplier_advances | retention_payable | grant_funds_received |
exchange_gain_loss | opening_balance_equity | suspense`), `grant_id null` (only for
`grant_funds_received`), `account_id`. Unique `(tenant_id, key, grant_id)` (nulls not distinct).

### accounting_period

`year smallint`, `month smallint 1..12`, unique per tenant; `status` (`open | closed`),
`closed_at`, `closed_by`, `reopened_at`, `reopened_by`, `reopen_reason` (required when
reopening, FR-065). Status changes need `periods:manage` (API) and are audited.

---

## 7. Invoices, payment requests, advances (US11, US15, US16)

### supplier_invoice (numbering `INV` on registration)

`po_id`, `supplier_id` (inherited), `supplier_invoice_no`, `invoice_date`, `currency`,
`amount`, `attachment_id`, status `registered | matched | cancelled`. Unique
`(tenant_id, supplier_id, lower(btrim(supplier_invoice_no)))` where not cancelled (US11-5).

### supplier_invoice_line

`invoice_id`, `po_line_id`, `quantity`, `unit_price`, `line_total` (generated).

### payment_request (⟨doc⟩ ⟨doa⟩; numbering `PAY` / `DPR`; DoA types `PAY` / `DPR`)

| Column | Type | Rules |
|---|---|---|
| kind | text | `order | retention | direct | bid_security_return` |
| po_id, invoice_id | uuid null | required for `order` (invoice required unless `is_advance`) |
| is_advance | boolean | advance against a PO: ≤ `advance_pct × total` − prior advances |
| payee_type | text | `supplier | staff | other` |
| supplier_id, staff_payee_id, payee_name | | exactly one; `order` ⇒ supplier = PO supplier (inherited) |
| payee bank snapshot | text | bank, branch, account name, number, copied |
| grant_id | uuid | inherited (`order`) or chosen (`direct`) |
| category_id | uuid null | `payment_category` (direct) |
| period_text | text null | e.g. "September 2026" |
| payment_method | text | `bank_transfer | cheque | bank_draft | cash` |
| money_account_id | uuid | currency must equal `currency` (FR-075) |
| currency | char(3) | payment currency |
| ⟨rate⟩ to PO currency | | when the payment currency ≠ PO currency |
| gross, advance_deduction, retention_amount, deductions_total, net | numeric(18,2) | **computed only** (no API input) |
| amount_in_words_ar, amount_in_words_en | text | generated from `net` |
| match_status | text | `matched | mismatch | overridden | n_a` |
| paid_at, paid_on | timestamptz, date | set at voucher posting |
| frozen_grant_override | jsonb null | Finance Manager override for a suspended or closed grant or a blacklisted supplier (FR-096, edge case) |

**Status**: `draft → pending_approval → approved → paid`, or `returned`, `rejected`,
`cancelled`. Budget:

- `direct`: reserve on submit, commit on approval (FR-061).
- `order`: none until posting (clarification Q3).

### payment_request_line

`payment_request_id`, `line_no`, `po_line_id null`, `grn_line_id null`, `certificate_id null`,
`description`, `quantity`, `unit_price`, `gross`, ⟨dims⟩ (inherited from the PO line, or
entered on direct lines), `invoiced_qty`, `accepted_qty`, `po_price`, `match_result`
(`ok | qty_exceeds | price_exceeds`), `amount_grant` (direct: at the request rates; order: at
the PO commit rate).

### payment_request_deduction

`payment_request_id`, `deduction_type_id`, `base`, `rate_pct`, `amount` (computed),
`payable_account_id` (copied).

### payment_match_override

`payment_request_id` (unique), `reason`, plus the `override_match` signature in
`doc_signature`. The approver must hold `payment:override_match` and must not be the preparer.

### cash_advance (⟨doc⟩ ⟨doa⟩; numbering `ADV`) / cash_advance_line

- Header: `staff_payee_id`, `purpose`, `office_id`, `grant_id`, `expected_settlement_date`,
  `currency`, `total` (computed), `waiver_id null` (overdue), `paid_voucher_id`,
  `settled_amount`, `returned_amount`, `outstanding` (computed).
- Status: `draft → pending_approval → approved → paid → partially_settled → settled`, or
  `returned`, `rejected`, `cancelled`.
- Lines: ⟨dims⟩, `description`, `amount`, `amount_grant`.

### advance_settlement (⟨doc⟩ ⟨doa⟩; numbering `STL`) / advance_settlement_line

- Header: `cash_advance_id`, `settlement_date`, `receipts_total`, `return_amount`,
  `additional_amount` (computed: `outstanding − receipts`).
- Lines: `advance_line_id`, ⟨dims⟩ (budget line may differ only within the same grant),
  `description`, `amount`, `receipt_attachment_ids uuid[]`.
- On posting:
  - JV (Dr expense / Cr staff advances);
  - CRV for the return, or BPV/CPV for the additional amount;
  - the commitment is released `settled`.

---

## 8. Vouchers, reconciliation, allocation, import (US13, US14, US17, US18, US12)

### voucher (⟨doc⟩ ⟨doa⟩; numbering by type; DoA `PV` / `RV` / `JV`)

| Column | Type | Rules |
|---|---|---|
| type | text | `BPV | CPV | BRV | CRV | JV | TRF` |
| voucher_date | date | its month's period must be open to post |
| office_id | uuid | |
| money_account_id | uuid null | required for BPV/CPV/BRV/CRV; `BPV/BRV ⇒ kind bank`, `CPV/CRV ⇒ kind cash` |
| to_money_account_id | uuid null | TRF only |
| cheque_no | text null | required when BPV and payment method = cheque (FR-067) |
| payee_name | text null | |
| currency, amount | | header amount (= money-account side), words ar/en generated |
| reason | text null | **required for JV** (check, US14-4) |
| payment_request_id, cash_advance_id, advance_settlement_id, receipt_kind, grant_id | | sources; `receipt_kind` ∈ `donor_tranche | supplier_refund | advance_return | other_income | bid_security` |
| entered_by | uuid | = creator |
| posted_at, posted_by | | |
| received_by_name, received_on, received_copy_attachment_id | | required before posting for CPV, and for BPV with a cheque (FR-074) |
| reversal_of_id, reversed_by_id, reversed_at | uuid, uuid, timestamptz | |
| is_imported, import_batch_id | | R32 |

**Status**: `draft → pending_check → checked → approved → posted`, or `returned` (from pending)
and `cancelled` (pre-posting). Reversal creates a new voucher that is itself posted through the
same flow, or posted directly by `voucher:reverse` with three signatures. On reversal posting,
the original gets `reversed_by_id`.

Triggers:

- `voucher_balanced` (deferred, on the status move to ≥ `checked`): `Σ base_debit = Σ base_credit > 0`, else `VOUCHER_UNBALANCED` (US13-2).
- `voucher_immutable_when_posted` (voucher and lines): blocks UPDATE and DELETE when posted, except setting `reversed_by_id` and `reversed_at` once (US13-3).
- `voucher_period_open` (on the status move to `posted`): the period exists and is open, else `PERIOD_CLOSED`.
- `voucher_three_signers`: the `entered_by`, check, and approve signature users are distinct (DB backstop of BR-8).

### voucher_line

| Column | Type | Rules |
|---|---|---|
| voucher_id, line_no | | |
| account_id | uuid | posting, active account |
| description | text | |
| currency | char(3) | |
| debit, credit | numeric(18,2) | ≥ 0, exactly one > 0 |
| ⟨rate⟩ | | **check**: `currency = base ⇔ (rate_to_base = 1 and exchange_rate_id is null)`; trigger: `rate_to_base` = the referenced `exchange_rate.rate_to_base` (US13-4) |
| base_debit, base_credit | numeric(18,2) | `round(debit × rate, 2)` / `round(credit × rate, 2)` (check) |
| ⟨dims⟩, donor_id, category_text | | grant and budget line inherited from the source line (trigger); `category_text` = the printed "Contract" column |
| grant_rate_to_base, grant_rate_date, grant_rate_source, grant_exchange_rate_id | | rate of the grant currency on the voucher date, locked at posting (clarification Q2) |
| actual_grant_amount | numeric(18,2) null | non-null only for expense accounts with a budget line: `(debit − credit) × rate_to_base ÷ grant_rate_to_base`, half-up |
| commitment_consumed_grant | numeric(18,2) null | PO/DPR/advance commitment released by this line at the **commitment's** locked rate |
| posted_period | date null | first day of the voucher month, stamped at posting |
| payment_request_line_id, po_line_id, advance_line_id, settlement_line_id, allocation_source_line_id | uuid null | trail links (D6) |

Indexes:

- `(tenant_id, budget_line_id, posted_period) where posted_period is not null`;
- `(tenant_id, account_id, posted_period)`;
- `(voucher_id)`;
- `(payment_request_line_id)`.

### budget_line_balance (view, replaced)

```text
budget, reserved, committed           -- as 001
actual    = Σ voucher_line.actual_grant_amount where posted_period is not null
available = budget − reserved − committed − actual
pct_used  = (reserved + committed + actual) / budget × 100
```

The guard `app.assert_budget_line_available(budget_line_id)` is called by deferred constraint
triggers on `budget_commitment` (insert/update) and `voucher_line` (update of `posted_period`).

### bank_statement / bank_statement_line / reconciliation_match

- `bank_statement`: `money_account_id`, `year`, `month` (unique), `opening_balance`,
  `closing_balance`, `status` (`open | signed_off`), `signed_off_by`, `signed_off_at`,
  `reopen_reason`.
- `bank_statement_line`: `statement_id`, `txn_date`, `description`, `reference`,
  `amount` (signed), `import_batch_id`.
- `reconciliation_match`: `statement_line_id`, `voucher_line_id`, `amount`. Inserts and deletes
  are blocked while the statement is `signed_off`. Sign-off needs
  `opening + Σ matched = closing` (US18-1).

### allocation_template / allocation_line

- `allocation_template`: `name`, `effective_from`, `effective_to null`, `is_active`.
- `allocation_line`: `grant_id`, `budget_line_id`, `pct numeric(5,2)`. Σ pct = 100.00
  (deferred check, US17-1).
- Application creates a JV with `allocation_source_line_id` on its lines.

### import_batch

`kind` (`opening_balances | budget_line_opening | open_pos | prior_transactions |
bank_statement`), `status` (`previewed | committed | failed`), `file_attachment_id`,
`summary jsonb` (valid and invalid counts, totals, errors), `committed_at`.

---

## 9. Notifications (kinds added)

`notification.kind` adds:

- `doc_action_required`, `doc_approved`, `doc_rejected`, `doc_returned`, `doc_cancelled`,
  `doc_reassigned` (all with `doc_type`, `doc_id`, `params.number`);
- `sourcing_deadline_reached`;
- `guarantee_expiring`, `supplier_document_expiring`, `vetting_due`;
- `advance_overdue`, `retention_release_due`;
- `supplier_rating_due`;
- `declaration_required`, `signature_required`.

The PR kinds from 001 are unchanged. Scheduled kinds carry a `dedupe_key` (R29).

---

## 10. Trail, tasks, reports (views and functions)

| Object | Kind | Returns |
|---|---|---|
| `doc_edge` | view | `(from_type, from_id, to_type, to_id)` from every FK in D6 |
| `app.document_trail(doc_type, doc_id)` | function | the chain in both directions with number, status, date, amount, currency, depth |
| `my_task_candidates` | view | pending steps, declarations, signatures, and vouchers to post (R30) |
| `app.report_budget_vs_actual(grant_id, period_from, period_to)` | function | per line: budget, reserved, committed, actual period, actual cumulative, available, pct used, burn rate = actual cumulative ÷ elapsed grant months |
| `app.report_donor(grant_id, period_from, period_to)` | function | code, description, budget, actual previous periods, actual this period, cumulative, balance, % (US19-2), plus `rates_used` |
| `app.report_procurement_register(filters)` | function | one row per sourcing event with PR, method, waiver, number of offers, awardee, PO, amounts, GRN, invoice, payment, dates, cycle time |
| `app.report_open_commitments`, `app.report_supplier_history`, `app.report_gl`, `app.report_account_statement`, `app.report_trial_balance`, `app.money_account_book`, `app.report_outstanding_advances`, `app.report_grant_funding` | functions | US19 4–9 |
| `supplier_compliance`, `purchase_order_flags`, `money_account_carrying_rate`, `app.exchange_rate_usage` | views | as above |

All of these are `security_invoker`, `stable`, and filtered by RLS.

---

## 11. Seeds (tenant bootstrap and backfill)

`app.bootstrap_tenant` (0009) is extended by `0021`, and the same block backfills existing
tenants:

1. The permission catalogue (D8) and the eight new roles with their permission sets.
2. The `procurement_setting` defaults, method bands, deduction types, payment categories, and
   supplier categories (stationery, food, construction, transport, it, fuel, other).
3. `numbering_config` for every new doc type.
4. Default org-wide approval rules per DoA type (research D8).
5. The default chart of accounts:
   - 1 Assets: 11 Cash & bank, 12 Staff advances, 13 Supplier advances;
   - 2 Liabilities: 21 WHT payable, 22 Retention payable;
   - 3 Fund balances: 31 Grant funds received, 32 Opening balance equity;
   - 4 Income: 41 Other income, 42 Exchange gain/loss;
   - 5 Expenses: 51–55 one per budget category.

   It also seeds the control-account settings and category mappings.
6. `accounting_period` rows for the current and next month (open).

The demo seed (`seed-demo.ts`, extending 001 T159) adds:

- accounts `10102`, `10202`, `70205`;
- the money account "Blue Nile Mashreq Bank – White Nile" (SDG, bank, MAD office, GL `70205`);
- budget line `10102` (Field Supervision Officer, staff) on the ADRA grant;
- the three suppliers Al-Qabas Library, Al-Shorouk Bookstore, and Mano Services (approved,
  vetted), and staff payee NasrAldin Abdullah Ahmed;
- users `procurement@`, `committee1..3@`, `store@`, `inspector@`, `accountant@`, `fm@`,
  `cashier@`, `cd@`;
- `document_sequence` BPV/MAD/2026 = 34.

---

## 12. State machines (summary)

| Document | States | Budget effect |
|---|---|---|
| Sourcing event | draft → issued → (closed) → opened → evaluated → awarded / cancelled | none; lines exclusive |
| Bid analysis | draft → scoring → signing → pending_approval → approved / returned / rejected / cancelled | check only on approval |
| Waiver | draft → pending_approval → approved / returned / rejected / cancelled | none |
| PO / contract | draft → pending_approval → approved → acknowledged → partially_received → fully_received → closed; cancelled | approve: PR→PO commitment; close/cancel: release |
| Amendment | draft → pending_approval → approved / … | approve: re-split, increase checked |
| GRN / SCC | draft → completed / cancelled | none (updates accepted / certified) |
| Payment request (order) | draft → pending_approval → approved → paid / … | none until posting |
| Payment request (direct) | same | reserve → commit → consume |
| Cash advance | draft → pending_approval → approved → paid → partially_settled → settled | reserve → commit → consume / release on settlement |
| Settlement | draft → pending_approval → approved → posted (via its vouchers) | consume `settled`; release unused |
| Voucher | draft → pending_check → checked → approved → posted; returned; cancelled | posting: Actual + consumption; reversal: negation + restore |
| Accounting period | open ⇄ closed (reopen with reason) | — |
| Bank statement | open ⇄ signed_off (reopen with reason) | — |
