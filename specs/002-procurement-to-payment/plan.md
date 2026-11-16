# Implementation Plan: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

**Branch**: `002-procurement-to-payment` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-procurement-to-payment/spec.md`; plan input
`docs/plan002.md`.

## Summary

This feature completes the donor-funded purchase cycle after an approved PR:

- **Procurement configuration and suppliers**: method bands with grant overrides, tolerances,
  deductions, and a vetted supplier registry.
- **Sourcing**: RFQs and tenders with **sealed** offers, a witnessed opening, a committee with
  conflict-of-interest declarations, calculated scoring, and a DoA-approved award.
- **Orders**: POs and contracts that inherit everything from the award, versioned amendments,
  GRNs and completion certificates with two-person signing, and supplier invoices.
- **Payments**: payment requests with a three-way match, advances, retention, and deductions.
- **Accounting**: a chart of accounts, bank and cash accounts, and periods. Balanced, immutable
  vouchers (BPV/CPV/BRV/CRV/JV/TRF) are the only source of **Actual** on a budget line.
- **Other money flows**: direct payments, staff advances and settlements, allocations, and bank
  reconciliation.
- **Reporting**: donor and audit reports, the document trail, prints for every document
  (including a BPV-35 reproduction), and My tasks and notifications for every type.

Technical approach: the exact 001 stack and layout, with no new frameworks. 001's PR-specific
engine is generalized in place:

- one approval/signature engine keyed by `(doc_type, doc_id)`, with 001-compatible views (D1);
- one `budget_commitment` table with source-document columns and a "split chain" for partial
  consumption (D2);
- the 001 numbering, rate, audit, and RLS helpers reused for every new document.

Each state change is one `withTenantTx` with budget lines locked in id order. Database triggers
back up the critical guarantees:

- Available ≥ 0, now including Actual;
- voucher balance, immutability, and the open-period rule;
- the currency/rate consistency rule;
- inherited fields that cannot change downstream;
- sealed prices, through RLS.

Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (strict) on Node.js 20 LTS; SQL (Supabase Postgres 17, cloud
dev project `humanitairianOrg`).

**Primary Dependencies**: unchanged from 001.

- API: Express 4, Zod 3, helmet, cors, express-rate-limit, `@supabase/supabase-js` 2,
  `postgres` 3 (session pooler, port 5432), decimal.js, exceljs, tsup.
- Web: Next.js 14 `[locale]`, next-intl 3, shadcn/ui and Tailwind 3 (logical properties only),
  TanStack Query/Table/Virtual, React Hook Form + Zod, Zustand, **@react-pdf/renderer 4.9**
  (`direction: 'rtl'` on every `Text`, `row-reverse` rows in Arabic).
- Monorepo: pnpm 8.15 and Turborepo 2.
- One new database-side dependency: the **pg_cron** extension for scheduled notifications. It
  has an API-interval fallback (R29).

**Storage**:

- Supabase Postgres with RLS on every new table, audit triggers, generic `doc_approval_step` /
  `doc_signature` / `doc_attachment`, `budget_commitment` (extended), and vouchers. Migrations
  run `0012_*` to `0022_*`.
- Storage bucket `doc-attachments` (private); `pr-attachments` and `org-assets` are unchanged.

**Testing**:

- Vitest unit tests: pure shared functions (scoring, method resolution, match, voucher
  generation, words) and services with in-memory repositories.
- Vitest + supertest integration tests against the dev project (`ALLOW_DB_TRUNCATE=1`).
- Playwright E2E in `ar` and `en`, extending the RTHA fixtures.
- Chrome DevTools MCP for screenshots.

**Target Platform**: modern browsers; web on Vercel, API on Fly.io, Supabase cloud (as 001).

**Project Type**: web application (Next.js + Express REST + shared packages) in the existing
monorepo.

**Performance Goals**:

- Budget vs Actual and the donor report < 3 s with 5,000 PRs, 3,000 POs, and 20,000 voucher
  lines (SC-005).
- Document lists p95 < 500 ms.
- Submit, approve, and post p95 < 1 s.
- Payment request + voucher from a received PO in < 5 min of user time (SC-012).

**Constraints**:

- Online only.
- Exact decimals with strings in JSON, money `numeric(18,2)`, rates `numeric(18,6)`.
- DD/MM/YYYY everywhere.
- Arabic RTL by default.
- Available never negative under concurrency (SC-004).
- Prices unreadable before the opening for every role (SC-009).
- No posting into closed periods.
- Posted vouchers immutable.
- Attachments ≤ 10 MB, 20 per document.
- No secrets in the repository.

**Scale/Scope**:

- Pilot NGO scale per tenant: ≤ 200 users, ≤ 20 offices, ~5,000 PRs, ~3,000 POs, and ~20,000
  voucher lines per year.
- 21 user stories, 97 FRs, and 22 business rules.
- About 21 new doc types, ~60 new tables, ~70 screens, and 15 print templates.

All unknowns are resolved in [research.md](./research.md): D1–D10 from the plan input and
R21–R36 found during design. They include sourcing model unification (R21), scoring math (R22),
scheduled notifications (R29), opening import (R32), and the prerequisite and constitution
status (R36). **No NEEDS CLARIFICATION remain.**

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The ratified constitution is **v1.2.0** (`.specify/memory/constitution.md`, ratified
2026-11-14). It adds Principle XI and expands II, III, and VII. The table checks every
principle, and the design complies.

| # | Principle | How the design complies | Status |
|---|---|---|---|
| I | Audit trail | `audit.log_change` on every new table, with `audit_history` extended by `doc_type/doc_id` for timelines on every document (R30). `doc_signature` is insert-only. Documents past draft have no delete path (only draft delete, guarded by trigger as for PRs). Cancellation and reversal require a reason. Period reopen and manual PO close reasons go into `app.audit_comment`. Configuration edits are audited and snapshotted onto documents. | PASS |
| II | Segregation & approval integrity (+ v1.2.0 expansion) | One DoA engine for all types (D1); routes from `approval_rule` by doc type, amount, and office. Per-doc-type policies live in **one** `segregation.service.ts`, covering every rule the amendment lists (PR creator ✗ award, creator ✗ approval, receiver ≠ inspector, receiver/inspector/preparer ✗ payment approval, voucher by three people, COI declaration before scoring), with DB backstops (unique signature indexes, the voucher three-signer trigger). Approved documents are locked: amendments are versioned (R23), postings are reversed, never edited. | PASS |
| III | Fund integrity (+ v1.2.0 expansion) | Every PO, payment, advance, settlement, and voucher line carries grant, budget line, and location (⟨dims⟩), inherited and trigger-checked (D6). Actual is derived from posted voucher lines only; Reserved and Committed come from `budget_commitment` (D2). Available ≥ 0 is checked under row locks in services and re-asserted by one deferred guard over commitments **and** Actual, for PRs, POs, contracts, amendments, direct payments, advances, settlements, JVs, and allocations, under concurrency (SC-004 test). The same grant is enforced across the chain; donor codes stay text. | PASS |
| IV | Tenant isolation & security | Every new table has `tenant_id`, RLS in its first migration, and the 001 helper. New narrowing helpers (`can_read_doc`, `sourcing_opened`, `may_see_offer_prices`) only add conditions, and RLS lint covers them. `resource:action` permissions are enforced in API middleware (D8). Sealed prices are enforced in RLS and storage policy, not only in the API (D3). No new secrets. | PASS |
| V | Arabic-first, formats | All screens, prints, and reports use next-intl `ar`/`en`, the shared DD/MM/YYYY formatter, `numeric` + decimal.js, and a currency on every amount. Every conversion (comparison, PO commit, payment, posting, transfer) stores rate, date, and source. Amounts in words are generated for POs, payment requests, and vouchers (FR-058, FR-087). | PASS |
| VI | Configuration over hard-coding | Method bands, grant overrides, tolerances, committee minimum, re-vetting, warning days, deductions, payment categories, chart of accounts, control accounts, numbering, and DoA rules are tenant configuration with seeds. Documents snapshot the configuration they used (method snapshot, rates, `print_snapshot`), so edits never change submitted documents (US1-4). | PASS |
| VII | Linkage & traceability (+ v1.2.0 expansion) | Every downstream document is created from its upstream document. Line-level FKs exist for the full chain. Supplier, grant, budget line, donor, and location are inherited and immutable downstream (trigger `INHERITED_FIELD_MISMATCH`). The `document_trail` traversal works both ways (D6). Numbers are server-generated per type, office, and year (D7). Prices are unreadable before the opening (D3). | PASS |
| VIII | Official printable documents | 15 templates on a shared print kit (D9). Every one has logo, number, print date, status watermark, generated words, and signature blocks from `doc_signature`. Waivers print across the chain. The BPV reproduces BPV-35. | PASS |
| IX | Consistent architecture | Same monorepo, routes → services → repositories, Zod in `packages/shared`, idempotency on all mutations, one error shape. Pure domain functions (scoring, match, voucher generation) live in `packages/shared` and are used by services. Two deviations: DB-level guards duplicating service rules, and refactoring 001 tables; both are under Complexity Tracking. | PASS (justified) |
| X | Business rules tested | One named test per BR-1…BR-22, segregation per doc type, the voucher generation table, and integration tests for sealing, commitments, concurrency, match, period, immutability, reversal, and trail. The E2E RTHA chain and BPV-35 come from real samples (R35). | PASS |
| XI | Accounting integrity | Balance in base currency is enforced by a deferred DB trigger before check. Posted vouchers and lines are immutable by trigger; corrections are reversals only. Closed periods block posting (trigger + service); reopening needs `periods:manage` and a reason, and is audited. The row check makes a currency label contradicting its rate impossible. Actual comes only from posted lines, cash basis by default (D5). | PASS |
| — | Development workflow | SQL migrations live in `packages/database/migrations`, applied with Supabase MCP when it connects, with the CLI and `migrate.ts` as the fallback (001 R20; MCP timed out in this session). Commit after each `/speckit-implement` phase. The **regression gate** (amendment): the foundation phase ends with all 001 suites green. Out-of-scope items (inventory, asset register, payroll, supplier portal, donor layouts) are not designed. | PASS |

**Pre-research gate**: PASS. **Post-design re-check** (after data-model and contracts): PASS. No
new violations; the two Complexity Tracking items are unchanged. **Process note**: finish 001
T142/T159–T166 before `/speckit-implement`.

Spec vs plan input notes:

- The plan input says migrations continue from `0009_*`. The repository already has 0009–0011,
  so 002 starts at `0012_*`.
- The plan input's separate `quotation_line_price` / `bid_price` tables became one sealed
  `offer_line_price` over a unified sourcing model (R21). The sealing rule is unchanged.
- US5 acceptance 1 uses illustrative prices; the RTHA workbook bidders give 50.00 / 48.04 /
  43.51. Both are tested (R22).

## Project Structure

### Documentation (this feature)

```text
specs/002-procurement-to-payment/
├── plan.md              # This file
├── research.md          # Phase 0: D1–D10 (plan input), R21–R36
├── data-model.md        # Phase 1: tables, views, state machines, seeds, migration order
├── quickstart.md        # Phase 1: gates, setup, validation (RTHA chain, BPV-35)
├── contracts/
│   ├── rest-api.md             # /api/v1 additions, shared document actions, error codes
│   ├── rls-and-permissions.md  # RLS helpers, sealed policy, permissions, segregation, roles
│   ├── posting-rules.md        # voucher generation and budget movements per event
│   └── print-layout.md         # print kit, 15 templates, BPV-35 checklist
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks), not created here
```

### Source Code (repository root)

New entries only; everything else is as in the 001 plan.

```text
apps/api/src/
├── routes/        # procurement-settings, suppliers, staff-payees, rfqs, tenders, bid-analyses,
│                  # waivers, pos (+contracts, amendments), grns, completion-certificates,
│                  # invoices, payment-requests, direct-payments, advances, settlements,
│                  # vouchers, gl-accounts, money-accounts, periods, imports, allocations,
│                  # bank-reconciliations, trail, my-tasks (+ reports extended)
├── services/      # document-workflow (generalized pr-workflow), segregation, procurement-config,
│                  # supplier, sourcing, opening, analysis, waiver, purchase-order, amendment,
│                  # receipt (grn, scc), invoice, payment-request, direct-payment, advance,
│                  # settlement, voucher (generate/check/approve/post/reverse), accounting-setup,
│                  # period, import, allocation, reconciliation, trail, task, scheduled-notification,
│                  # print (per doc), report (extended)
│                  # pr-workflow.service.ts → thin PR adapter over document-workflow
├── repositories/  # one per aggregate; doc-approval-step, doc-signature, doc-attachment
└── tests/
    ├── unit/            # BR-1…22, segregation, adapters, services
    └── integration/     # see quickstart table; helpers/bulk.ts extended for 002 perf seed
apps/web/src/
├── app/[locale]/(app)/  # procurement/{suppliers,rfqs,tenders,analyses,pos,contracts,receiving},
│                        # finance/{invoices,payment-requests,direct-payments,advances,vouchers,
│                        # bank-cash,accounts,periods,reconciliation,allocations,imports},
│                        # reports/{budget-vs-actual,donor,procurement-register,…}, trail/[type]/[id],
│                        # my-tasks (generalized), settings/procurement
├── features/            # print-kit (extracted from pr/print), suppliers, sourcing, analysis,
│                        # orders, receiving, payments, vouchers, accounting, reports, trail
└── messages/ar.json, en.json   # new namespaces per module
apps/web/e2e/            # rtha-chain.spec.ts, bpv-35.spec.ts, advance-settlement.spec.ts,
                         # fixtures/rtha-chain.json
packages/shared/src/
├── schemas/             # supplier, procurement-config, sourcing, analysis, waiver, order,
│                        # receipt, invoice, payment, advance, voucher, accounting, report, trail
├── procurement/         # method.ts, scoring.ts, match.ts, advance-retention.ts (pure)
├── accounting/          # generate-voucher.ts, balance.ts, rates.ts (pure)
├── doc-types.ts         # registry codes, DoA types, state enums per document
└── permissions.ts       # extended catalogue + seeded roles
packages/database/
├── migrations/          # 0012_doc_engine … 0022_scheduled_notifications (data-model header)
├── scripts/seed-demo.ts # 002 additions (data-model §11)
└── tests/rls-lint.test.ts  # unchanged rule, now covers ~60 new tables
```

**Structure Decision**: the existing monorepo (Principle IX). 002 adds modules inside the same
apps and packages; it adds no new apps, packages, or frameworks. Web navigation groups:

- **Procurement**: Suppliers, RFQs, Tenders, Evaluations, POs & Contracts, Receiving.
- **Finance**: Invoices, Payment Requests, Direct Payments, Advances, Vouchers, Bank & Cash,
  Chart of Accounts, Periods.
- **Reports**.
- **Settings**.

## Implementation Order (phases for `/speckit-tasks`)

Commit after each `/speckit-implement` run, one phase at a time.

1. **Foundation and regression gate**:
   - migrations 0012–0014 plus the 0021 seed parts for permissions, roles, numbering, and
     rules;
   - D1 engine with compatibility views;
   - `document-workflow` + `segregation` services, with the PR adapter;
   - D2 commitments and the guard;
   - D7 numbering;
   - D8 permissions;
   - the print-kit extraction.

   **Gate**: every 001 suite is green unchanged, and the PR print is identical.
2. **P1 path**: US1 → US2 → US3 → US4 → US5 → US6 → US7 → US11 → US12 → US13 → US19 (reports
   1–3). **Gate**: the RTHA chain E2E (SC-001) passes in `ar` and `en`, and the BPV generator
   unit table is green.
3. **P2**: US8, US9, US10, US14, US15, US16, US19 (reports 4–10 and the trail screen), US20
   (remaining prints, including BPV-35 E2E), US21 (My tasks, scheduled notifications,
   timelines).
4. **P3**: US17 allocation, US18 reconciliation.
5. **Polish**:
   - SC-005 perf test;
   - security pass (sealed prices, RLS lint, storage policies);
   - `business-rules-002` index;
   - quickstart run;
   - `ar`/`en` screenshots into `specs/002-procurement-to-payment/screenshots/`.

## Risks

| Risk | Mitigation |
|---|---|
| Moving 001 approval tables breaks 001 code or tests | Ids are preserved, auto-updatable views use the old names, and the 001 suites gate the foundation phase. Fallback if PostgREST view inserts misbehave: point the two 001 repositories at the base tables (code change only, tests unchanged) |
| `budget_line_balance` slows once Actual comes from 20k+ voucher lines | Partial index on posted lines; the perf test in phase 5 (or earlier); fallback to trigger-maintained totals behind the same view (D2, 001 R5) |
| Sealed RLS helper cost on large offer tables | `sourcing_opened` is a PK lookup and evaluated once per statement via `(select …)`; offers per event are small |
| Deadlocks between PO approval, posting, and JV | Every command locks budget lines in ascending id order (001 R4) and the PO row before budget lines |
| pg_cron unavailable on the plan | API interval sweeper with an advisory lock, plus a lazy sweep when tasks load (R29) |
| Arabic print of wide voucher tables | Landscape fallback for BPV when > 12 columns overflow; checked against BPV-35 in both locales |
| Scope size (21 stories) | Strict phase gates; P3 stories may slip without blocking the P1 chain |
| 001 T142/T159–T166 open | Listed as implement-time gates in quickstart; the design already satisfies v1.2.0 |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Refactor of 001 tables** (`pr_approval_step` and `approval_action` become generic tables behind compatibility views; `budget_commitment`, `notification`, `audit_history`, `numbering_config`, and `approval_rule` widened). Principle VI/IX spirit of stable foundations; the v1.2.0 workflow requires the regression gate | 12 new approvable types need one signature store, one My-tasks query, one timeline, and one segregation engine (D1). Budget figures must stay one derived view (D2) | A second engine per document type: segregation and immutability would be re-implemented 12 times and could drift (Principle II). Parallel commitment tables: a second source of truth for Available (Principle III) |
| **DB-level business guards beyond 001**: voucher balance, immutability, open period, currency/rate check, three-signer check, inherited-field triggers, sealed-price RLS, and the Available guard extended to Actual (Principle IX: rules live in services) | Principle XI explicitly demands DB enforcement for balance, immutability, and period. SC-002, SC-003, SC-004, and SC-009 say "0 can ever…", which a single missed service path would break. Services still evaluate every rule first and return the explanatory error | Service-only checks: one forgotten path (import, allocation, reversal, a future feature) could post an unbalanced or overspent entry on restricted donor funds |
| Two DB access paths (supabase-js + `postgres` driver) | Carried over from 001 (same justification); every new state-changing command needs multi-statement transactions with row locks | Unchanged from 001 |
