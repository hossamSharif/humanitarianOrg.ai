# Data Model: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

**Feature**: `001-grants-pr-foundation` | **Date**: 2026-11-14 | **Plan**: [plan.md](./plan.md)

Postgres (Supabase). Conventions for every table unless stated otherwise:

- `id uuid primary key default gen_random_uuid()`.
- `tenant_id uuid not null references tenant(id)` on every tenant-owned table, first column after
  `id`, with RLS enabled in the same migration and policies using only
  `tenant_id = (select app.current_tenant_id())` (+ `app.has_office_access(office_id)` where
  office-scoped). See [contracts/rls-and-permissions.md](./contracts/rls-and-permissions.md).
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
  (trigger `app.touch_updated_at`), `created_by uuid references auth.users(id)`.
- Trigger `audit.log_change` on every table except `audit_history`, `notification`,
  `idempotency_key`.
- Money `numeric(18,2)`, rates `numeric(18,6)`, calendar dates `date`, instants `timestamptz`.
- Bilingual text as `name_ar text not null`, `name_en text not null` (the pair is required where
  marked *bilingual*).
- Master data is never hard-deleted once referenced (`on delete restrict`); it is deactivated with
  `is_active boolean not null default true`.

---

## 1. Organization & access

### tenant

| Column | Type | Rules |
|---|---|---|
| id | uuid | PK |
| name_ar, name_en | text | bilingual, required |
| logo_path | text null | Storage path in bucket `org-assets`, versioned `{tenantId}/logo-{uuid}`; old files are never overwritten or deleted (referenced by `print_snapshot`) |
| address, phone, email, website | text null | |
| base_currency | char(3) | FK `currency.code`, default `SDG`; immutable once any PR is submitted |
| doa_reference_currency | char(3) | FK `currency.code`, default `USD` |
| fiscal_year_start_month | smallint | 1–12, default 1 |
| timezone | text | default `Africa/Khartoum` |

No `tenant_id` (it is the tenant). RLS: `id = app.current_tenant_id()`; update requires
`settings:manage`.

### membership

User ↔ tenant link; source of truth for "is this user in this organization".

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| user_id | uuid | FK `auth.users`; unique `(tenant_id, user_id)` |
| email | citext | |
| full_name_ar, full_name_en | text | bilingual |
| position_title | text | current title; copied into signatures at signing time |
| org_wide_access | boolean | default false |
| status | text | `invited` → `active` → `suspended` |
| invited_at, activated_at | timestamptz | |

### office

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| code | text | 2–10 chars `[A-Z0-9]`, unique `(tenant_id, code)`; **immutable once referenced** by any PR (trigger raises `OFFICE_CODE_IN_USE`) |
| name_ar, name_en | text | bilingual |
| address, phone | text null | |
| is_active | boolean | |

Offices double as PR "locations" (deliver-to, line location).

### user_office

`(tenant_id, membership_id, office_id)` unique. Defines office access when
`membership.org_wide_access = false`.

### permission (global reference, not tenant-owned)

| Column | Type | Rules |
|---|---|---|
| code | text PK | `resource:action`, mirrors `packages/shared/src/permissions.ts` |
| description_ar, description_en | text | |

Seeded list in [contracts/rls-and-permissions.md](./contracts/rls-and-permissions.md).

### role

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| key | text null | stable key for seeded roles (`org_admin`, `requester`, `finance_checker`, `approver`, `viewer`) |
| name_ar, name_en | text | bilingual, unique per tenant |
| is_system | boolean | seeded; editable, not deletable while assigned |

### role_permission

`(role_id, permission_code)` PK, plus `tenant_id`.

### user_role

`(tenant_id, membership_id, role_id)` unique.

---

## 2. Configuration

### currency (global reference)

| Column | Type | Rules |
|---|---|---|
| code | char(3) PK | ISO 4217 |
| minor_units | smallint | 0–3 (SDG, USD, EUR = 2) |
| name_ar_singular, name_ar_dual, name_ar_plural, name_en_singular, name_en_plural | text | for amount-in-words |
| minor_name_ar_singular, minor_name_ar_dual, minor_name_ar_plural, minor_name_en_singular, minor_name_en_plural | text | e.g. قرش / Piastre, Cent |

### unit_of_measure

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| code | text | unique per tenant (e.g. `PCS`, `PAK`, `PERSON`, `DAY`, `KG`, `LTR`) |
| name_ar, name_en | text | bilingual |
| is_active | boolean | |

Seeded on tenant creation: PCs, PAK, Person, Day, Kg, Liter, Box, Set, Meter, Month, Lump sum.

### numbering_config

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| doc_type | text | `PR` (only value in this feature); unique `(tenant_id, doc_type)` |
| prefix | text | default `PR` |
| include_office | boolean | default true |
| include_year | boolean | default true |
| padding | smallint | 1–10, default 4 |
| separator | text | default `-` |

Format: `{prefix}{sep}{OFFICE}{sep}{YYYY}{sep}{seq padded}` → `PR-MAD-2026-0010`. Editing changes
only future numbers (FR-005).

### document_sequence

| Column | Type | Rules |
|---|---|---|
| tenant_id, doc_type, office_id, year | — | composite PK |
| last_value | integer | ≥ 0; incremented with `insert … on conflict … do update … returning` inside the submit transaction |

Not editable through the API (no update policy for `authenticated` except via the increment
statement's `insert/update` grant scoped by tenant).

### approval_rule

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| doc_type | text | `PR` |
| office_id | uuid null | null = organization-wide; unique `(tenant_id, doc_type, office_id)` (nulls not distinct) |
| name | text | |
| is_active | boolean | |

### approval_rule_step

| Column | Type | Rules |
|---|---|---|
| tenant_id, rule_id | uuid | FK `approval_rule` cascade |
| step_order | smallint | ≥ 1 |
| kind | text | `finance_check` \| `approval` \| `final_approval` |
| role_id | uuid | FK `role` |
| min_amount | numeric(18,2) null | band lower bound, exclusive (null = 0) |
| max_amount | numeric(18,2) null | band upper bound, inclusive (null = no limit) |

Validation (service + DB check where expressible):
- Step 1 exists and is the only `finance_check`; it has no band (FR-035).
- Exactly one `final_approval` step order, the highest; its rows' bands are contiguous, non-overlapping,
  start at 0 and end open (`max_amount null`) so every amount resolves.
- Non-final steps have one row each.

Seeded default (org-wide): step 1 `finance_check` → Finance Checker; step 2 `final_approval`,
one band 0–∞ → Approver.

---

## 3. Funding

### donor

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| name | text | required; unique per tenant (case-insensitive) |
| short_name | text null | e.g. `ADRA` |
| contact_name, contact_email, contact_phone | text null | |
| notes | text null | |
| is_active | boolean | |

### grant

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| donor_id | uuid | FK `donor` |
| code | text | unique per tenant, stored as entered |
| name | text | |
| currency | char(3) | FK `currency`; **immutable once any budget line has a commitment** |
| total_amount | numeric(18,2) | > 0 |
| start_date, end_date | date | `end_date >= start_date` |
| status | text | `active` \| `suspended` \| `closed` |

Derived (view `grant_summary`): `budget_lines_total`, `difference = total_amount −
budget_lines_total` (warning when ≠ 0, FR-013), `pending_pr_count` (shown on status change,
FR-022).

### grant_office

`(tenant_id, grant_id, office_id)` unique — offices where the grant operates. A PR's requesting
office must be one of them.

### activity

| Column | Type | Rules |
|---|---|---|
| tenant_id, grant_id | uuid | |
| code | text | unique per grant |
| name | text | |
| is_active | boolean | |

### budget_line

| Column | Type | Rules |
|---|---|---|
| tenant_id, grant_id | uuid | |
| code | text | donor's code exactly as entered (`10202`, `2.2.31`); unique per grant |
| description | text | |
| category | text | `supplies` \| `services` \| `staff` \| `equipment` \| `running_costs` |
| budget_amount | numeric(18,2) | ≥ 0, in grant currency; on update must be ≥ reserved + committed + actual (checked under row lock, FR-014) |
| office_id | uuid null | optional location |
| is_active | boolean | |

### budget_line_balance (view)

| Column | Derivation |
|---|---|
| budget_line_id, grant_id, tenant_id | |
| budget | `budget_line.budget_amount` |
| reserved | `sum(amount) where status = 'reserved'` |
| committed | `sum(amount) where status = 'committed'` |
| actual | `0` (Payments feature later) |
| available | `budget − reserved − committed − actual` |
| pct_used | `(reserved + committed + actual) / nullif(budget,0) × 100` |

`security_invoker = true` so the caller's RLS applies.

### exchange_rate

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| currency | char(3) | FK `currency`; ≠ tenant base currency |
| rate_to_base | numeric(18,6) | > 0; 1 unit of `currency` = rate × base |
| rate_date | date | unique `(tenant_id, currency, rate_date)` |
| source | text | e.g. "Central Bank of Sudan", "Bank of Khartoum parallel" |

Lookup: latest `rate_date <= document date` for the currency. Edits are audited and never affect
submitted PRs (values are copied at submission).

---

## 4. Purchase requisitions

### purchase_requisition

| Column | Type | Rules |
|---|---|---|
| tenant_id | uuid | |
| number | text null | set at first submission; unique `(tenant_id, number)`; never changes |
| status | text | see state machine |
| version | integer | +1 on every update; optimistic concurrency |
| pr_date | date | required |
| requesting_office_id | uuid | FK `office`; must be in `grant_office` for the grant |
| grant_id | uuid | FK `grant`; exactly one per PR (FR-023) |
| deliver_to_office_id | uuid | FK `office` |
| delivery_address | text null | |
| contact_name, contact_phone | text null | |
| required_by_date | date null | at submit: ≥ `pr_date` |
| activity_id | uuid null | FK `activity` of the same grant |
| purpose | text null | purpose / comments |
| pr_type | text | `goods` \| `services` \| `mixed` |
| requester_id | uuid | creator (`auth.users`); segregation checks use it |
| requester_name, requester_position | text | snapshot at submission (Requested By block) |
| print_snapshot | jsonb null | labels frozen at submission, refreshed on resubmission: organization {nameAr, nameEn, logoPath, address, phone, email}, requestingOffice, deliverTo, grant {code, name}, donor {name, shortName}, activity, and per line id: unit {code, name}, budgetLineCode, budgetLocation {code, name}, donorShortName (Principle VI) |
| submission_cycle | smallint | 0 while never submitted; +1 on each submission |
| current_step_order | smallint null | pending step, null otherwise |
| doa_currency | char(3) null | locked at submission |
| doa_amount | numeric(18,2) null | PR total in DoA currency, locked at submission |
| doa_rate_to_base, doa_rate_date, doa_rate_source | numeric(18,6), date, text | for DoA currency |
| grant_rate_to_base, grant_rate_date, grant_rate_source | numeric(18,6), date, text | for grant currency (1 if base) |
| total_grant_currency | numeric(18,2) null | sum of line `amount_grant`, locked at submission |
| submitted_at, approved_at, closed_at | timestamptz null | |
| cancel_reason, reject_reason, return_reason | text null | latest reason (history keeps all) |
| cancelled_by, rejected_by | uuid null | |

Checks: `status <> 'draft' ⇒ number is not null`; DELETE allowed only when `status = 'draft' and
number is null` (trigger). Office-scoped RLS on `requesting_office_id`; requesters may always see
their own PRs.

### pr_line

| Column | Type | Rules |
|---|---|---|
| tenant_id, pr_id | uuid | FK cascade only while draft (deletes blocked otherwise by parent rule) |
| line_no | smallint | 1..n, unique per PR, renumbered on draft edits |
| description | text | required |
| specifications | text null | long text |
| quantity | numeric(18,3) | > 0 |
| unit_id | uuid | FK `unit_of_measure` |
| unit_cost | numeric(18,2) | ≥ 0 |
| line_total | numeric(18,2) | **generated**: `round(quantity × unit_cost, 2)`; never typed |
| currency | char(3) | default tenant base currency |
| budget_line_id | uuid | FK `budget_line`; must belong to PR's grant (trigger, FR-023) |
| location_office_id | uuid | FK `office`; default = deliver-to office (Principle III: every line has a location) |
| activity_id | uuid null | same grant |
| rate_to_base, rate_date, rate_source, exchange_rate_id | numeric(18,6), date, text, uuid | locked at submission (null while draft; 1 / pr_date / `base` when currency = base) |
| amount_grant | numeric(18,2) null | `line_total × rate_to_base ÷ grant_rate_to_base`, half-up to grant minor units; locked at submission |

PR total (header display, in each line currency) and totals per currency are computed; mixed
currencies show one total per currency plus `total_grant_currency`.

### pr_attachment

| Column | Type | Rules |
|---|---|---|
| tenant_id, pr_id | uuid | |
| storage_path | text | `{tenant_id}/{pr_id}/{id}` in bucket `pr-attachments` |
| file_name | text | original name |
| mime_type | text | allow-list (research R11) |
| size_bytes | integer | ≤ 10 MB; ≤ 20 attachments per PR |
| uploaded_by | uuid | |
| deleted_at | timestamptz null | soft delete; only while PR is draft/returned |

### pr_approval_step

The resolved route for one submission cycle.

| Column | Type | Rules |
|---|---|---|
| tenant_id, pr_id | uuid | |
| cycle | smallint | = PR `submission_cycle` when created |
| step_order | smallint | unique `(pr_id, cycle, step_order)` |
| kind | text | `finance_check` \| `approval` \| `final_approval` |
| required_role_id | uuid | from the resolved rule step |
| rule_step_id | uuid | provenance (`approval_rule_step`) |
| assigned_user_id | uuid null | null = any eligible user; set by reassignment |
| status | text | `waiting` → `pending` → `approved` \| `rejected` \| `returned` \| `cancelled` |
| acted_at | timestamptz null | |

### approval_action (signature)

Immutable: insert-only grants; UPDATE/DELETE blocked by trigger (FR-031).

| Column | Type | Rules |
|---|---|---|
| tenant_id, pr_id, step_id | uuid | `step_id` null for `submit` / `cancel` / `reassign` |
| cycle | smallint | |
| step_order | smallint null | step acted on (`approve`, `reject`, `return`, `reassign`); null for `submit`, `cancel` |
| action | text | `submit` \| `approve` \| `reject` \| `return` \| `cancel` \| `reassign` \| `change_budget_line` |
| user_id | uuid | actor |
| user_name, user_position | text | snapshot at action time |
| comment | text null | required for reject / return / cancel / reassign |
| payload | jsonb null | e.g. `{lineId, fromBudgetLineId, toBudgetLineId}` or `{fromUserId, toUserId}` |
| acted_at | timestamptz | default now() |

Unique partial index: `(pr_id, cycle, user_id) where action = 'approve'` → one signature per
user per cycle (DB-level backstop). Across cycles, the service allows a user to sign again only
the same `step_order` they signed before (FR-032).

### budget_commitment

| Column | Type | Rules |
|---|---|---|
| tenant_id, budget_line_id, pr_id | uuid | |
| cycle | smallint | unique `(pr_id, budget_line_id, cycle)` |
| amount | numeric(18,2) | > 0, grant currency |
| status | text | `reserved` → `committed` → `released`; or `reserved` → `released` |
| reserved_at, committed_at, released_at | timestamptz | |
| release_reason | text null | `returned` \| `rejected` \| `cancelled` \| `budget_line_changed` |

Deferred constraint trigger: after insert/update, for each touched `budget_line_id`, raise
`BUDGET_EXCEEDED` if `available < 0`.

---

## 5. Cross-cutting

### audit_history (append-only)

| Column | Type |
|---|---|
| id | bigint identity |
| tenant_id | uuid |
| table_name | text |
| record_id | uuid |
| action | text (`insert` / `update` / `delete`) |
| actor_id | uuid null (`auth.uid()`) |
| occurred_at | timestamptz |
| from_state, to_state | text null (rows with `status`) |
| changed_fields | text[] |
| old_data, new_data | jsonb |
| comment | text null (`current_setting('app.audit_comment', true)`) |
| request_id | text null (`current_setting('app.request_id', true)`) |

Indexes: `(tenant_id, table_name, record_id, occurred_at)`. Readable with `audit:read`, or for a
PR's own records by anyone who can read the PR.

### notification

| Column | Type | Rules |
|---|---|---|
| tenant_id, user_id | uuid | RLS: `user_id = auth.uid()` within tenant |
| kind | text | `pr_action_required` \| `pr_approved` \| `pr_rejected` \| `pr_returned` \| `pr_cancelled` \| `pr_reassigned` |
| pr_id | uuid | |
| params | jsonb | `{number, stepKind, actorName}` — rendered via i18n on the client |
| read_at | timestamptz null | |

### idempotency_key

`(tenant_id, user_id, key)` PK, `request_hash`, `status_code`, `response_json`, `created_at`;
rows older than 24 h are purged.

---

## 6. PR state machine

```text
                 submit (all checks pass; reserve; number on first submit)
   ┌───────┐ ───────────────────────────────▶ ┌───────────────────────┐
   │ draft │                                  │ pending_finance_check │
   └───────┘ ◀── delete (creator, never       └──────────┬────────────┘
                 submitted only)                         │ approve (finance step)
                                                         ▼
 ┌──────────┐   resubmit (fresh checks,        ┌──────────────────┐  approve (final step)  ┌──────────┐
 │ returned │ ─ new rates, new reservation) ─▶ │ pending_approval │ ─────────────────────▶ │ approved │
 └──────────┘   → pending_finance_check        └──────────────────┘  reserved → committed  └────┬─────┘
      ▲                                                 │                                      │
      │ return (reason; release)  ◀─── from either pending state                               │ cancel
      │ reject (reason; release) ───▶ rejected (final)                                         │ (pr:cancel_approved,
      │ cancel (requester, reason; release) ───▶ cancelled (final)  ◀──────────────────────────┘  reason; release)
```

| From | Action | Actor | Guard | Effect |
|---|---|---|---|---|
| draft | update / delete | creator | — | delete only if never submitted |
| draft, returned | submit | creator (`pr:create`) | Rules: ≥ 1 line, total > 0, required-by ≥ PR date, grant active & covers PR date, requesting office in grant offices, rates for all line currencies + grant + DoA currency, per budget line Σ amount_grant ≤ available, every step has ≥ 1 eligible user | lock rates, compute amounts, number (first time), `cycle+1`, create steps, reserve, notify step 1 users |
| pending_finance_check | change_budget_line | eligible finance checker | same grant, availability on target line excluding this PR's own reservation | move reservation, log action |
| pending_* | approve | eligible user of current step | grant active & covers PR date; not creator; not signer of another step; PR not frozen | sign; advance step (notify) or, on final step, `reserved → committed`, status `approved`, notify requester |
| pending_* | reject | eligible user of current step | reason | release, status `rejected`, notify requester |
| pending_* | return | eligible user of current step | reason | release, status `returned`, steps closed, notify requester |
| pending_*, returned | cancel | creator | reason | release (if reserved), status `cancelled` |
| approved | cancel | `pr:cancel_approved` | reason | `committed → released`, status `cancelled` |
| pending_* | reassign | `pr:reassign` (admin) | new user eligible for the step | set `assigned_user_id`, log, notify new user |

"Frozen" (FR-022): grant status ≠ `active` — approve is blocked with `GRANT_NOT_ACTIVE`; return,
reject, cancel remain allowed.

---

## 7. Relationships (summary)

```text
tenant ─┬─ membership ─┬─ user_office ── office
        │              └─ user_role ── role ── role_permission ── permission
        ├─ office ── document_sequence
        ├─ unit_of_measure, numbering_config, exchange_rate
        ├─ approval_rule ── approval_rule_step ── role
        ├─ donor ── grant ─┬─ grant_office ── office
        │                  ├─ activity
        │                  └─ budget_line ── budget_commitment ── purchase_requisition
        └─ purchase_requisition ─┬─ pr_line ── budget_line, unit_of_measure, office, activity
                                 ├─ pr_attachment
                                 ├─ pr_approval_step ── approval_action
                                 └─ notification
audit_history ← every table above (trigger)
```

## 8. Seed on tenant creation

Units of measure (§2), roles + permissions (contracts/rls-and-permissions.md), `numbering_config`
for `PR`, default org-wide approval rule, `membership` for the creating admin with role
`org_admin` and `org_wide_access = true`. Global reference data (`currency`, `permission`) is
seeded by migration.
