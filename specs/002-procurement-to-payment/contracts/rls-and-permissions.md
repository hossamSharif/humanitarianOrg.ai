# Security Contract — RLS and Permissions (002 additions)

**Feature**: `002-procurement-to-payment` | Base: [001 contract](../../001-grants-pr-foundation/contracts/rls-and-permissions.md)

## 1. RLS helpers

The 001 helpers stay the only tenant pattern:

- `app.current_tenant_id()`;
- `app.current_membership_id()`;
- `app.has_office_access()`;
- `app.has_permission()`.

Every new policy contains `tenant_id = (select app.current_tenant_id())`, and
`packages/database/tests/rls-lint.test.ts` keeps failing any policy that does not.

New helpers (`stable security definer`, `search_path = ''`) narrow access *within* the tenant.
They never replace the tenant check.

| Function | Contract |
|---|---|
| `app.can_read_doc(doc_type text, doc_id uuid)` | parent row exists in the current tenant and `app.has_office_access(<office column from registry>)`; PRs keep the 001 "requester sees own" rule |
| `app.sourcing_opened(event_id uuid)` | `sourcing_event.opened_at is not null` |
| `app.may_see_offer_prices(event_id uuid)` | false if the caller is a non-replaced `committee_member` of the event's analysis with `declared_at is null` or `has_conflict`; true otherwise |
| `app.doc_ref_check()` | trigger: parent exists for `(doc_type, doc_id)` |

### Policy templates

| Table class | Policy |
|---|---|
| Master/config (`supplier*`, `procurement_*`, `gl_account`, `money_account`, `accounting_period`, `deduction_type`, …) | 001 tenant template (`tenant_select`, `tenant_write`) |
| Office-scoped documents (`sourcing_event`, `bid_analysis`, `waiver`, `purchase_order`, `po_amendment`, `grn`, `completion_certificate`, `supplier_invoice`, `payment_request`, `cash_advance`, `advance_settlement`, `voucher`) | `tenant_id = (select app.current_tenant_id()) and app.has_office_access(office_id)` |
| Children of those | `tenant_id = … and exists (select 1 from <parent> p where p.id = <fk>)` (the parent's RLS applies) |
| `doc_approval_step`, `doc_attachment`, `notification` (doc rows) | `tenant_id = … and app.can_read_doc(doc_type, doc_id)` |
| `doc_signature` (append-only) | select + insert only (`user_id = auth.uid()`), update/delete revoked + trigger |
| **Sealed**: `offer_terms`, `offer_line_price` | select **and** insert: `tenant_id = … and app.sourcing_opened(event) and app.may_see_offer_prices(event)`; update additionally blocked after freeze; delete revoked |
| `voucher`, `voucher_line` | tenant + office; update/delete blocked by immutability trigger when posted |
| `budget_commitment` | unchanged (tenant-wide, budget figures are organization-wide) |

Storage (`doc-attachments` bucket): the first path segment is the tenant, the second the doc
type, the third the doc id, checked with `app.can_read_doc`. The `offers/…` prefix additionally
requires `app.sourcing_opened`.

Views and report functions are `security_invoker`, so the caller's RLS applies. Report
functions never select sealed tables for events that are not opened, and RLS makes that
structural anyway.

**Sealed-price acceptance** (SC-009): with an `org_admin` JWT, a procurement officer JWT, and
the creator's JWT, before `opened_at`:

- `select count(*) from offer_terms` and `offer_line_price` for the event = 0;
- `insert` fails with an RLS violation;
- `GET /rfqs/:id`, list, export, print, and search contain no price fields.

## 2. Permission catalogue additions (`packages/shared/src/permissions.ts`)

| Code | Meaning |
|---|---|
| `suppliers:read` / `suppliers:manage` / `suppliers:vet` | view; maintain suppliers, documents, status (except approve); record vetting and approve |
| `procurement:read` / `procurement:configure` | view sourcing, analyses, POs, GRNs; edit bands, tolerances, deductions, categories |
| `rfq:create` / `rfq:issue` / `rfq:open` | draft RFQs, log receipts, analyses, re-issue/cancel; issue; record the opening and enter prices |
| `tender:manage` / `tender:open` | tender file, publication, clarifications, bids log, securities; opening session |
| `evaluation:score` / `evaluation:sign` | score as a declared committee member; sign the analysis |
| `award:approve` | eligible for AWARD DoA steps |
| `waiver:create` / `waiver:approve` | |
| `po:create` / `po:approve` / `po:amend` / `po:cancel` / `po:close` | |
| `grn:create` / `grn:inspect` | receive (Received By) / inspect (Inspected By, SCC signers) |
| `invoice:register` | |
| `payment:create` / `payment:check` / `payment:approve` / `payment:override_match` | |
| `voucher:create` / `voucher:check` / `voucher:approve` / `voucher:post` / `voucher:reverse` | |
| `accounts:manage` / `periods:manage` | chart, mappings, controls, imports / close and reopen periods (clarification Q4) |
| `bank:manage` / `bank:reconcile` | money accounts / statements and matching |
| `advance:request` / `advance:approve` / `advance:settle` | |
| `allocation:manage` | |
| `finance:read` | view vouchers, accounts, periods, money accounts |
| `reports:read` / `reports:finance` | procurement and budget reports / GL, TB, books |

### Step kind → permission per DoA type

| DoA type | `finance_check` / `check` | `approval` / `final_approval` |
|---|---|---|
| PR (001) | `pr:finance_check` | `pr:approve` |
| AWARD | — | `award:approve` |
| PO, CON, AMD | — | `po:approve` |
| WAIVER | — | `waiver:approve` |
| PAY, DPR | `payment:check` | `payment:approve` |
| PV, RV, JV | `voucher:check` | `voucher:approve` |
| ADV, STL | — | `advance:approve` |

A user is eligible for a step only when all of these hold:

1. holds the step's role;
2. that role grants the mapped permission;
3. has office access;
4. `segregation.service` allows the action.

## 3. Segregation policies (`apps/api/src/services/segregation.service.ts`)

One table, one unit test per row (BR-8, SC-010):

| Rule id | Doc types | Rule |
|---|---|---|
| `creator_approves` | all approvable | creator (`created_by` / requester / `entered_by`) cannot sign any approval step |
| `same_user_two_steps` | all approvable | one approve signature per user per cycle (DB index); across cycles only the same step order (001 FR-032) |
| `pr_creator_approves_award` | AWARD | requester of any PR feeding the event cannot sign any AWARD step (may sit on the committee) |
| `receiver_is_inspector` | GRN | `received` and `inspected` signers differ (DB unique on action + service) |
| `certifier_is_confirmer` | SCC | `certified` and `confirmed` signers differ |
| `preparer_approves_payment` | PAY, DPR | preparer cannot sign any step |
| `receiver_approves_payment` | PAY | signers of `received` / `inspected` / `certified` / `confirmed` on GRNs/SCCs matched by the request cannot sign any step |
| `voucher_three_people` | PV, RV, JV | `entered_by`, check signer, approval signer pairwise distinct (also a DB trigger) |
| `override_by_preparer` | PAY | match override cannot be made by the preparer |
| `undeclared_member_scores` | QA | member must have declared and have no conflict to see prices or score (also RLS) |

## 4. Seeded roles (new)

| Role (key) | Permissions |
|---|---|
| Procurement Officer (`procurement_officer`) | `pr:read`, `procurement:read`, `suppliers:read`, `suppliers:manage`, `rfq:create`, `rfq:issue`, `rfq:open`, `tender:manage`, `tender:open`, `waiver:create`, `po:create`, `po:amend`, `po:cancel`, `po:close`, `reports:read` |
| Committee Member (`committee_member`) | `procurement:read`, `evaluation:score`, `evaluation:sign` |
| Storekeeper / Receiver (`storekeeper`) | `procurement:read`, `grn:create` |
| Technical Inspector (`technical_inspector`) | `procurement:read`, `grn:inspect` |
| Accountant (`accountant`) | `procurement:read`, `finance:read`, `invoice:register`, `payment:create`, `voucher:create`, `voucher:post`, `advance:settle`, `budget:read`, `reports:read`, `reports:finance` |
| Finance Manager (`finance_manager`) | `finance:read`, `procurement:read`, `suppliers:vet`, `payment:check`, `payment:override_match`, `voucher:check`, `voucher:reverse`, `accounts:manage`, `periods:manage`, `bank:manage`, `bank:reconcile`, `allocation:manage`, `award:approve`, `po:approve`, `waiver:approve`, `advance:approve`, `rates:manage`, `budget:read`, `reports:read`, `reports:finance` |
| Cashier (`cashier`) | `finance:read`, `voucher:create`, `voucher:post`, `bank:manage` |
| Country Director / Authorized Signatory (`country_director`) | `procurement:read`, `finance:read`, `award:approve`, `po:approve`, `waiver:approve`, `payment:approve`, `voucher:approve`, `advance:approve`, `reports:read`, `reports:finance` |
| Staff (any member) | `advance:request` granted to `requester` |
| Organization Admin (`org_admin`) | all new non-signing permissions; **excluded**: `award:approve`, `po:approve`, `waiver:approve`, `payment:check`, `payment:approve`, `voucher:check`, `voucher:approve`, `evaluation:score`, `evaluation:sign`, `advance:approve`, `grn:inspect` |
| Viewer / Auditor (`viewer`) | adds `procurement:read`, `finance:read`, `suppliers:read`, `reports:read`, `reports:finance` |
