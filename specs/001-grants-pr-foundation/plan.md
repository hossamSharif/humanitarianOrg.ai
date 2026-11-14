# Implementation Plan: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

**Branch**: `001-grants-pr-foundation` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-grants-pr-foundation/spec.md`; plan input
`docs/plan001.md`.

## Summary

Build the multi-tenant foundation (organization, offices, units, numbering, users/roles, DoA
approval rules), the funding structure (donors, grants, budget lines with derived Budget /
Reserved / Committed / Actual / Available, activities, manual exchange rates, spreadsheet import)
and the first procurement document, the Purchase Requisition, with submit-time budget check and
reservation, Finance Check + DoA-routed Final Approval with immutable electronic signatures,
commitment on approval, release on return/reject/cancel, bilingual PDF print, lists, "My tasks",
notifications, and a budget status report.

Technical approach: the GvsErp-AI monorepo stack (pnpm + Turborepo, Express API with routes →
services → repositories, Next.js 14 `[locale]` web app, Supabase Postgres/Auth/Storage) without
the offline layer or Stripe. Tenant isolation uses one RLS helper, `app.current_tenant_id()`,
fed by server-set `app_metadata.tenant_id` and checked against `membership`. All PR transitions
run in one API-opened Postgres transaction (RLS still applied) that locks the PR and its budget
lines, so budget checks, numbering, reservations, signatures, and notifications are atomic; a
DB constraint trigger guarantees Available never goes negative. Details:
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (strict) on Node.js 20 LTS; SQL (PostgreSQL 15, Supabase)

**Primary Dependencies**: API — Express 4, Zod 3, helmet, cors, express-rate-limit,
`@supabase/supabase-js` 2, `postgres` 3 (transactions), decimal.js, exceljs, tsup.
Web — Next.js 14 App Router, next-intl 3, shadcn/ui (Radix) + Tailwind 3, lucide-react,
TanStack Query 5 / Table 8 / Virtual 3, React Hook Form + Zod, Zustand 4,
@react-pdf/renderer 3, `@supabase/ssr`. Monorepo — pnpm 8.15, Turborepo 2.

**Storage**: Supabase Postgres (RLS on every tenant table, audit triggers, `updated_at`
triggers, numbering table); Supabase Storage buckets `pr-attachments` (private) and
`org-assets` (logos); Supabase Auth (email invites).

**Testing**: Vitest (unit: services with in-memory repos, shared helpers; integration: supertest
against local Supabase), Playwright (E2E RTHA PR 0010 in `ar` and `en`), Chrome DevTools MCP
for visual verification/screenshots.

**Target Platform**: Web — modern evergreen browsers (Chrome/Edge/Firefox/Safari, desktop and
mobile web); web on Vercel, API on Fly.io (Docker), Supabase cloud.

**Project Type**: Web application (Next.js frontend + Express REST API + shared packages) in a
monorepo.

**Performance Goals**: budget status report < 2 s for a tenant with 5,000 PRs (SC-004); PR
list/search p95 < 500 ms at the same size; submit/approve p95 < 800 ms; 10-line PR entry and
submit < 5 min for a user (SC-001).

**Constraints**: online only (no offline layer); low-bandwidth field connections (attachments
≤ 10 MB/file, 20 per PR); money `numeric(18,2)` / rates `numeric(18,6)` with decimal strings in
JSON; all dates displayed DD/MM/YYYY; Arabic (RTL) default, English secondary; Available never
negative under concurrency; no secrets in repo.

**Scale/Scope**: pilot NGO scale — tens of tenants, ≤ 200 users and ≤ 20 offices per tenant,
≤ 5,000 PRs/year per tenant (~50k lines); ~25 screens (setup, users/roles, rules, donors/grants,
budget lines/import, rates, PR list/form/detail/print, my tasks, notifications, budget report).

All Technical Context unknowns are resolved in [research.md](./research.md) (attachment limits
R11, transaction strategy R4, PDF/bidi risk R13, tooling R20). No NEEDS CLARIFICATION remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How the design complies | Status |
|---|---|---|---|
| I | Audit trail | `audit.log_change` trigger on every tenant table → append-only `audit_history` (who, when, from/to state, changed fields, comment via `app.audit_comment`); `approval_action` insert-only; DELETE trigger allows only never-submitted drafts; cancel/reject require reason; PR timeline endpoint (`/prs/:id/history`) | PASS |
| II | Segregation & approval integrity | creator excluded from all steps; unique `(pr_id, cycle, user_id)` on approve actions + service check that a user re-signs only the same step across cycles; routes resolved from `approval_rule` by doc type/amount/office and materialised per cycle; signatures snapshot name + position + timestamp; approved PRs immutable (status guard + no edit endpoint), changes only via cancel | PASS |
| III | Fund integrity | every PR line carries grant (via PR), budget line (FK + same-grant trigger), location (required); values derived in `budget_line_balance` view; row-locked check + deferred trigger keep Available ≥ 0 (no override path in this feature); one grant per PR; donor codes stored as text. **Note**: the spec adds *Reserved* (a pre-approval hold). It is a sub-state of commitment and makes Available stricter (`Budget − Reserved − Committed − Actual`), so the principle's guarantee is strengthened, not changed. Matches constitution v1.1.0, which names Reserved. | PASS |
| IV | Tenant isolation & security | `tenant_id` + RLS in each table's first migration; one helper `app.current_tenant_id()` from `app_metadata` + `membership` (never `user_metadata`); RLS-lint test enforces the single pattern; `resource:action` permissions enforced in API middleware; service-role key only for Auth admin; `.env.example` documents config | PASS |
| V | Arabic-first, formats | next-intl `ar` default / `en`, `dir` from locale, no hard-coded strings (ESLint i18n rule); single DD/MM/YYYY formatter (ESLint ban on ad-hoc date formatting); `numeric` money + decimal.js + per-currency minor units; every amount carries currency; conversions store rate, date, source; amount-in-words generated in `packages/shared` | PASS |
| VI | Configuration over hard-coding | numbering formats, units, roles/permissions, DoA steps and bands, reference currency are tenant config with seeded defaults; config edits audited; in-flight PRs keep materialised steps, locked rates, assigned numbers | PASS |
| VII | Linkage & traceability | PR is the first document (no upstream); numbers server-generated per type/office/year, unique per tenant; PR id is the anchor for future RFQ/PO links | PASS |
| VIII | Official printable documents | react-pdf template per contracts/print-layout.md with logo, header, item table, totals, words, three signature blocks, number, print date, status watermark | PASS |
| IX | Consistent architecture | monorepo layout as mandated; routes validate + delegate, rules in services; Zod schemas/types in `packages/shared`; `Idempotency-Key` on all mutations; single error shape `{ code, message, details? }`. Deviation: an availability guard trigger duplicates one rule in the DB → Complexity Tracking | PASS (justified) |
| X | Business rules tested | unit suite per business rule 1–12 and per clarification; integration tests for the state machine, RLS, concurrency, numbering; E2E acceptance with RTHA PR 0010 | PASS |
| — | Development workflow | Migrations kept as SQL in `packages/database/migrations`. Constitution v1.1.0 allows the Supabase CLI when Supabase MCP is not configured and Playwright screenshots when Chrome DevTools MCP is not connected; T013 confirms which path is used before Phase 2 | PASS |

**Pre-research gate**: PASS. **Post-design re-check** (after data-model and contracts): PASS —
no new violations; the DB guard is the only notable point. Approved-PR printouts use
`print_snapshot` so configuration edits never alter them (Principle VI).

Spec vs. original input note: `docs/specify1.md` Business Rule 4 ("commitment recorded only at
final approval") was refined by the 2026-11-14 clarification to "reserve at submission, commit at
final approval". Tests for rule 4 follow the clarified spec (FR-036).

## Project Structure

### Documentation (this feature)

```text
specs/001-grants-pr-foundation/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R20
├── data-model.md        # Phase 1: tables, views, state machine, seeds
├── quickstart.md        # Phase 1: setup + validation guide
├── contracts/
│   ├── rest-api.md              # /api/v1 endpoints, error codes
│   ├── rls-and-permissions.md   # RLS helpers, policy templates, permission catalogue
│   └── print-layout.md          # PR PDF data shape and layout
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
apps/
├── api/                              # @ngo/api — Express 4, deployed to Fly.io
│   ├── src/
│   │   ├── index.ts                  # app bootstrap, middleware chain
│   │   ├── config/env.ts             # Zod-validated env
│   │   ├── db/                       # supabase client factory, postgres pool, withTenantTx
│   │   ├── middleware/               # request-id, auth, tenant, permission, validate,
│   │   │                             # idempotency, rate-limit, error
│   │   ├── routes/                   # session, tenant, offices, units, numbering, users,
│   │   │                             # roles, approval-rules, donors, grants, budget-lines,
│   │   │                             # activities, exchange-rates, prs, reports, notifications
│   │   ├── services/                 # tenant-setup, numbering, approval-routing, budget,
│   │   │                             # exchange-rate, pr (state machine), pr-print,
│   │   │                             # budget-import, notification, report
│   │   └── repositories/             # one per aggregate; base.repository.ts
│   ├── tests/
│   │   ├── unit/                     # business rules 1–12, routing, rounding, freezing
│   │   └── integration/              # state machine, RLS, concurrency, numbering, perf
│   ├── Dockerfile
│   └── fly.toml
└── web/                              # @ngo/web — Next.js 14, deployed to Vercel
    ├── src/
    │   ├── app/[locale]/             # (auth), setup, users, roles, approval-rules, donors,
    │   │                             # grants/[id]/budget-lines, rates, prs, prs/[id],
    │   │                             # my-tasks, reports/budget-status
    │   ├── features/                 # pr (form, autosave store, actions, print/),
    │   │                             # grants, budget-import, reports, notifications
    │   ├── lib/                      # api client (idempotency keys), query keys, supabase
    │   ├── messages/ar.json, en.json
    │   └── fonts/                    # IBM Plex Sans Arabic / IBM Plex Sans TTF (PDF)
    └── e2e/                          # Playwright + fixtures/rtha-pr-0010.json
packages/
├── shared/                           # @ngo/shared
│   └── src/
│       ├── schemas/                  # Zod: tenant, office, grant, budget-line, pr, ...
│       ├── permissions.ts            # resource:action constants
│       ├── errors.ts                 # error codes + ApiError type
│       ├── money/                    # decimal helpers, convert(), per-currency rounding
│       ├── amount-in-words/          # ar.ts, en.ts
│       ├── format/date.ts            # DD/MM/YYYY formatter (single source)
│       └── pr-state.ts               # statuses, allowed transitions
├── database/                         # @ngo/database
│   ├── migrations/                   # 0001_helpers_rls.sql, 0002_org_access.sql,
│   │                                 # 0003_config.sql, 0004_funding.sql, 0005_pr.sql,
│   │                                 # 0006_audit.sql, 0007_storage.sql, 0008_seed_reference.sql
│   ├── src/types.ts                  # generated DB types
│   ├── scripts/                      # migrate, gen:types, seed:demo
│   └── tests/rls-lint.test.ts
└── ui/                               # @ngo/ui — shadcn components, theme tokens (--primary)
```

**Structure Decision**: Web application in the mandated monorepo (Principle IX), mirroring
GvsErp-AI's `apps/*` + `packages/*` layout and package responsibilities, scoped `@ngo/*`. No
offline/sync or billing modules.

## Phase Outputs

- **Phase 0** — [research.md](./research.md): stack (R1), RLS helper (R2–R3), transactions and
  concurrency (R4), balances (R5), numbering (R6), money/rates (R7), DoA routing (R8), audit (R9),
  autosave (R10), attachments (R11), import (R12), PDF (R13), words (R14), dates (R15),
  notifications (R16), invites (R17), testing (R18), theme (R19), tooling (R20).
- **Phase 1** — [data-model.md](./data-model.md), [contracts/](./contracts/),
  [quickstart.md](./quickstart.md).

## Risks

| Risk | Mitigation |
|---|---|
| react-pdf mixed Arabic/Latin bidi rendering | Spike in the first PR-print task; fallback to Playwright HTML→PDF on the API with the same `PrPrintData` contract (R13) |
| Supavisor transaction pooling + `SET LOCAL` | All settings are transaction-local inside `withTenantTx`; integration test asserts claims do not leak between requests |
| Supabase / Chrome DevTools MCP unavailable | Supabase CLI and Playwright screenshot fallbacks permitted by constitution v1.1.0; T013 gates Phase 2 (R20) |
| Arabic amount-in-words grammar errors | Table-driven tests reviewed by an Arabic-speaking finance user, including the 870,710 SDG sample |
| Brand colour undecided | `--primary` token with placeholder value; one-line change |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Availability ≥ 0 rule also enforced by a deferred DB constraint trigger (Principle IX: rules live in services) | SC-003/FR-037 demand Available never goes negative; a DB guard holds even if a future code path or manual SQL skips the service's locked check. The service remains the place where the rule is evaluated and explained to users | Service-only check: one missed lock in later features (PO, payments) would silently overspend restricted donor funds |
| Two DB access paths in the API: supabase-js for CRUD/reads and the `postgres` driver for transactional commands (deviation from GvsErp-AI's supabase-js-only convention) | supabase-js cannot run multi-statement transactions; PR transitions must lock PR + budget lines and write several tables atomically while keeping rules in TypeScript | PL/pgSQL RPC per command moves budget/DoA/segregation rules into SQL (against Principle IX and hard to unit-test); all-`postgres` rewrite discards proven GvsErp repository code |
