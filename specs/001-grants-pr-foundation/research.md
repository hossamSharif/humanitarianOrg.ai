# Phase 0 Research: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

**Feature**: `001-grants-pr-foundation` | **Date**: 2026-11-14 | **Plan**: [plan.md](./plan.md)

Each item below resolves one unknown or technology choice from the Technical Context. The stack
baseline is the GvsErp-AI project (`D:\husamproject2026\GvsErp-AI`, branch `001-modular-erp-saas`),
with the changes listed in `docs/plan001.md`.

---

## R1. Baseline stack and versions

- **Decision**: Reuse GvsErp-AI's monorepo layout and major versions: pnpm 8.15 workspaces,
  Turborepo 2, Node 20 LTS, TypeScript 5 (strict), Express 4.18, Zod 3.22, helmet 7, tsup 8,
  Vitest 1.x, Next.js 14 App Router (latest 14.2.x patch rather than GvsErp's 14.1.0), next-intl 3,
  TanStack Query 5 / Table 8 / Virtual 3, React Hook Form 7, Zustand 4, @react-pdf/renderer 3,
  Tailwind 3.4, shadcn/ui (Radix), lucide-react, `@supabase/supabase-js` 2 and `@supabase/ssr`.
  Prettier config is copied verbatim (single quotes, semicolons, width 100, trailing comma es5, LF).
  Workspace scope: `@ngo/*` (e.g. `@ngo/api`, `@ngo/shared`).
- **Rationale**: The plan input asks for the same stack; reusing it keeps the team's patterns
  (middleware chain, `AppError`, repository base class, Turbo tasks) and lets code be ported.
- **Alternatives considered**: Next.js 15 / React 19 (rejected: diverges from the reference
  project and next-intl/shadcn patterns already proven there). Dropped from GvsErp: Dexie,
  outbox/sync engine, Serwist service worker, TanStack Query persisters, Stripe.

## R2. Tenant identity for RLS (one helper)

- **Decision**: One SQL helper, `app.current_tenant_id()`, used by every tenant policy:
  it reads `auth.jwt() -> 'app_metadata' ->> 'tenant_id'` and returns it **only if** an active
  `membership` row exists for `(auth.uid(), that tenant)`; otherwise `NULL` (no rows match).
  It is `STABLE SECURITY DEFINER` with a fixed `search_path`, and policies call it as
  `tenant_id = (select app.current_tenant_id())` so Postgres evaluates it once per statement
  (initPlan). `app_metadata.tenant_id` is written only by the API (service role) when a user
  accepts an invite or switches organization (`POST /api/v1/session/tenant`), after which the
  client refreshes its session. `user_metadata` is never read.
- **Rationale**: `app_metadata` is server-controlled; checking membership too means a revoked
  member loses access immediately, without waiting for token expiry. GvsErp-AI needed five
  separate `fix_*_rls_jwt` migrations (013, 015, 017, 020…) because tables invented their own
  patterns — the constitution (Principle IV) and plan input forbid that, so the helper is defined
  in the first migration and a lint test asserts every policy uses it.
- **Alternatives considered**: Membership lookup only (rejected: a user in two organizations
  needs an "active organization" selector anyway, and the JWT claim provides it cheaply);
  custom access-token hook (viable later; adds Auth configuration without changing policies).

## R3. Office scoping

- **Decision**: A second single-purpose helper, `app.has_office_access(office_id uuid)`, returns
  true when the current member has `org_wide_access` or a `user_office` row for that office.
  Used by policies on office-scoped documents (`purchase_requisition` and its children). Master
  data (grants, budget lines, donors) is tenant-scoped only; the API filters grant pickers by
  `grant_office`.
- **Rationale**: FR-018 / US8-3 require Kosti-only users to see only Kosti PRs; enforcing it in
  RLS makes it impossible to leak through a forgotten API filter.
- **Alternatives considered**: API-only filtering (rejected: violates "UI/API hide, DB enforces"
  spirit of Principle IV).

## R4. Transactions and budget concurrency

- **Decision**: All state-changing PR commands (submit, approve, reject, return, cancel, change a
  line's budget line, reassign) and budget-line amount edits run inside **one Postgres
  transaction opened by the API** with the `postgres` driver (porsager/postgres 3) through a
  `withTenantTx(ctx, fn)` unit of work. The transaction first runs
  `set local role authenticated` and `set_config('request.jwt.claims', <verified JWT claims>, true)`,
  so RLS, `auth.uid()` and the audit trigger behave exactly as with supabase-js. Inside it the
  service: (1) locks the PR row `FOR UPDATE` and checks status + `version`; (2) locks the
  affected `budget_line` rows `FOR UPDATE` **in ascending id order** (no deadlocks); (3) reads
  balances, evaluates the rules, and writes commitments / steps / number / notifications;
  (4) commits. A deferred constraint trigger on `budget_commitment` re-asserts
  `available >= 0` per touched budget line as a last line of defence.
  Simple CRUD and reads keep the GvsErp pattern: user-scoped supabase-js client.
  Connection: Supavisor transaction pooler (port 6543) with `prepare: false`.
- **Rationale**: Keeps business rules in TypeScript services (Principle IX) where they are
  unit-testable, while making the check-and-reserve atomic (FR-037, SC-003). Row locks on budget
  lines serialize only competing PRs on the same lines. The DB guard makes a negative Available
  impossible even if a future code path forgets the lock.
- **Alternatives considered**: (a) A PL/pgSQL RPC per command (plan input's fallback): atomic,
  but moves the budget, DoA, and segregation rules into SQL, away from service tests;
  (b) `SERIALIZABLE` isolation with retries: correct but produces confusing retry failures for
  users and more code; (c) optimistic version counters on budget lines: needs retry loops.

## R5. Budget figures (Budget / Reserved / Committed / Actual / Available)

- **Decision**: Store holds as `budget_commitment` rows (one per PR × budget line × submission
  cycle) with `status` `reserved | committed | released`, `amount` in grant currency and
  timestamps for each transition. Balances come from the view `budget_line_balance`
  (`sum` filtered by status; `actual = 0` in this feature;
  `available = budget − reserved − committed − actual`). Partial index on
  `(budget_line_id) where status in ('reserved','committed')`. Released rows are kept for audit.
- **Rationale**: Values are derived, never typed (FR-012, Principle III); drill-down (US8) is a
  simple filter on the same rows. At 5,000 PRs × ~10 lines the aggregate stays well under the
  2 s target (SC-004); a seeded performance test proves it.
- **Alternatives considered**: Trigger-maintained totals on `budget_line` (faster reads, but a
  second source of truth that can drift; can be added later behind the same view).

## R6. Document numbering

- **Decision**: Table `document_sequence (tenant_id, doc_type, office_id, year, last_value)` with
  primary key on the four scope columns. Inside the submit transaction:
  `insert … on conflict do update set last_value = document_sequence.last_value + 1 returning last_value`.
  The number is formatted from `numbering_config` (prefix, include office code, include year,
  padding) and stored on the PR with a unique `(tenant_id, number)` constraint. Assigned only at
  first submission; resubmission after Return keeps it. Year = calendar year of the PR date.
- **Rationale**: The row lock gives gap-free, never-reused numbers per office/year; a rolled-back
  submit does not consume a number (unlike Postgres `SEQUENCE`), and deleted drafts never had
  one (FR-024, FR-026, SC-007).
- **Alternatives considered**: Native sequences per office/year (gaps on rollback, dynamic DDL);
  GvsErp's `generate_invoice_number` RPC (works, but runs outside the PR transaction).

## R7. Money, rates, and rounding

- **Decision**: Money `numeric(18,2)`, rates `numeric(18,6)` in Postgres; `decimal.js` in
  `packages/shared` for all arithmetic; values cross the API as **strings** (e.g. `"870710.00"`),
  never JS numbers. A `currency` reference table holds ISO code, minor units (SDG/USD/EUR = 2),
  and Arabic/English names (singular/dual/plural + minor-unit names, used by amount-in-words).
  Rates are stored as "1 unit of currency = rate × base currency". Conversion of a line into
  grant currency: `line_total × rate(line→base) ÷ rate(grant→base)`, rounded **per line** half-up
  to the grant currency's minor units; budget-line totals are sums of rounded lines. A rate of 1
  is implied for the base currency. The DoA amount uses the same method with the reference
  currency (default USD). All rates used (value, date, source, exchange_rate id) are copied onto
  the PR line / PR at submission (FR-028) and reused until resubmission.
- **Rationale**: Exact decimals and explicit rounding (FR-052, Principle V); per-line rounding
  makes printed line amounts add up to totals.
- **Alternatives considered**: Integer minor units (awkward with numeric(18,2) DB requirement);
  `big.js`/`dinero.js` (decimal.js already common, supports rounding modes and division).

## R8. Approval routing (DoA) and eligibility

- **Decision**: `approval_rule` (document type `PR`, optional `office_id`, reference currency)
  with ordered `approval_rule_step` rows (`step_order`, `kind` = `finance_check | approval |
  final_approval`, `role_id`, optional `min_amount`/`max_amount` for amount bands). Several rows
  may share the final step order with non-overlapping bands. Resolution at submission: office
  rule if one exists, else the organization rule; for banded steps pick the band containing the
  DoA amount (`min < amount ≤ max`, open-ended top). Resolved steps are materialised as
  `pr_approval_step` rows for the current cycle (role + optional assignee). Eligibility for a
  step: holds the step's role in the tenant, has office access to the PR's office, is not the PR
  creator, and has not signed another step of the same PR (any cycle). Submission fails if any
  step has zero eligible users, naming the step and role (FR-020). Saving a rule is rejected
  unless step 1 is `finance_check` (FR-035) and bands are contiguous and non-overlapping.
- **Rationale**: Configuration over code (Principle VI); materialising steps freezes routing so
  later configuration edits do not change in-flight PRs (FR-005).
- **Alternatives considered**: Resolving the route on each action (config changes would alter
  pending PRs).

## R9. Audit history

- **Decision**: Generic trigger function `audit.log_change()` (AFTER INSERT/UPDATE/DELETE) on
  every tenant table, writing to append-only `audit_history`: tenant, table, record id, action,
  actor (`auth.uid()`), timestamp, `old`/`new` JSON, changed field list, and — when the row has a
  `status` column — from/to state. A transaction-local setting `app.audit_comment` (set by the
  service via `set_config(..., true)`) supplies reasons/comments. `audit_history` has insert-only
  grants; UPDATE/DELETE revoked and blocked by trigger. `updated_at` is maintained by a shared
  `app.touch_updated_at()` trigger. Draft PRs are the only business rows that may be deleted; a
  trigger blocks DELETE on any PR with a number.
- **Rationale**: Principle I requires DB-level audit; one trigger function covers config changes
  (FR-005) and PR edits (FR-044). The PR timeline is a read of `audit_history` +
  `approval_action` for that PR and its children.
- **Alternatives considered**: API-level audit middleware only (forbidden by Principle I);
  pgAudit (statement logs, not a user-facing timeline).

## R10. Drafts and autosave

- **Decision**: A draft PR exists on the server from its first save. The form (React Hook Form)
  mirrors into a Zustand store persisted to `localStorage` (per user + PR id) and autosaves with a
  debounced `PATCH /prs/:id` (≈2 s idle) carrying `version`; a 409 `VERSION_CONFLICT` prompts
  reload. Local copy is cleared after a successful save or submit.
- **Rationale**: FR-024 autosave without an offline layer; `localStorage` only protects against
  tab crashes between saves.
- **Alternatives considered**: Local-only drafts until submit (lost across devices; other users
  cannot see a draft is in progress).

## R11. Attachments

- **Decision**: Supabase Storage private bucket `pr-attachments`, object path
  `{tenant_id}/{pr_id}/{attachment_id}`. API issues signed upload URLs after validating type and
  size, then records `pr_attachment` (name, MIME, size, uploader). Storage RLS checks the first
  path segment with `app.current_tenant_id()` and office access via the PR. Limits: 10 MB per
  file, 20 files per PR; allowed: PDF, JPEG, PNG, WEBP, HEIC, DOCX, XLSX, CSV, TXT. Attachments can
  be added/removed while Draft or Returned; after submission they are locked (removal = soft
  delete only before submission).
- **Rationale**: Resolves the spec's open "reasonable per-file size limit"; 10 MB covers phone
  photos and scanned quotes on low-bandwidth links.
- **Alternatives considered**: 25 MB (too slow on field connections); public bucket (no).

## R12. Budget-line spreadsheet import

- **Decision**: Two-step import: `POST /grants/:id/budget-lines/import?mode=preview` parses an
  uploaded `.xlsx` or `.csv` with **exceljs** on the API, validates each row with the shared Zod
  schema (code required, text kept exactly as entered — cells are read as text, never as
  numbers, so `2.2.31` and leading zeros survive; category in the enum; amount > 0 with ≤ 2
  decimals; no duplicate code within the file or the grant), and returns valid rows + row-level
  errors. `mode=commit` re-validates and inserts all valid rows in one transaction.
- **Rationale**: FR-010 / US2-5 ("valid rows become budget lines, invalid rows reported, no
  partial bad data"); a preview prevents surprises.
- **Alternatives considered**: SheetJS `xlsx` from npm (registry version unmaintained with known
  advisories); client-side parsing (business validation must run on the server anyway).

## R13. PDF printing (PR form, budget report)

- **Decision**: @react-pdf/renderer in `apps/web`, rendered in the browser from
  `GET /prs/:id/print` data. IBM Plex Sans Arabic + IBM Plex Sans registered as TTF fonts;
  Arabic layout uses `direction: 'rtl'` styles and mirrored flex rows. Watermark text by status
  (`DRAFT`, `PENDING`, `CANCELLED`, `REJECTED`); footer has document number, print date
  (DD/MM/YYYY), and page x/y. **Spike first**: a one-page Arabic PR with mixed Arabic/Latin text
  and numbers; if react-pdf's bidi handling fails acceptance, fall back to server-side HTML→PDF
  with Playwright Chromium in the API image (same data contract, see
  [contracts/print-layout.md](./contracts/print-layout.md)).
- **Rationale**: Plan input mandates react-pdf; Arabic shaping works through fontkit but mixed
  bidi runs are the known weak point, so the risk is retired early.
- **Alternatives considered**: Puppeteer from day one (heavier Fly image, server CPU cost).

## R14. Amount in words

- **Decision**: Own implementation in `packages/shared/src/amount-in-words/` with `toWordsEn`
  and `toWordsAr`, both currency-aware (major + minor units from the `currency` table), handling
  Arabic number–noun agreement (1, 2 = dual, 3–10 plural, 11–99 singular accusative, 100+),
  thousands/millions/billions, and "فقط … لا غير" framing used on forms. Exhaustive table tests
  (0–1,000, boundaries, 870,710 SDG, fractional amounts).
- **Rationale**: Principle V / SC-006 require 100% correct words; libraries such as `n2words`
  produce number words but not currency grammar.
- **Alternatives considered**: `n2words` + manual currency suffix (grammatically wrong for many
  Arabic counts); `tafgeet` (SAR-centric, little maintenance).

## R15. Dates and digits

- **Decision**: One formatter module `packages/shared/src/format/date.ts`: `formatDate(isoDate)`
  slices `YYYY-MM-DD` strings (no `Date` parsing, no timezone shift) into `DD/MM/YYYY`;
  `formatDateTime(timestamptz, tz)` converts with `Intl.DateTimeFormat(..., { timeZone })`
  `formatToParts` and assembles `DD/MM/YYYY HH:mm` manually. Organization timezone default
  `Africa/Khartoum` (stored on tenant). Date inputs use a shared DD/MM/YYYY input component, not
  the browser's locale date picker. Western (Latin) digits in both languages, matching the paper
  forms and avoiding mixed digit systems in printed amounts. An ESLint `no-restricted-syntax`
  rule bans `toLocaleDateString` / `Intl.DateTimeFormat` outside the formatter.
- **Rationale**: FR-051 / SC-006; the corrupted DD/MM vs MM/DD dates in the samples came from
  locale-dependent formatting.
- **Alternatives considered**: Arabic-Indic digits in Arabic UI (configurable later; not now).

## R16. Notifications and "My tasks"

- **Decision**: `notification` rows inserted inside the same transaction as the PR transition
  (recipients: eligible users of the next step or the assignee; the requester on approve/reject/
  return). Web polls unread count every 30 s and on window focus (TanStack Query). "My tasks" is
  a query over `pr_approval_step` (pending, current step) joined with eligibility.
- **Rationale**: In-app only (spec assumption); polling is simple and adequate for this scale.
- **Alternatives considered**: Supabase Realtime (lower latency; more moving parts, revisit later).

## R17. Users and invitations

- **Decision**: API uses the service-role key (server only) to call
  `auth.admin.inviteUserByEmail`, creates `membership` (status `invited`) with name (ar/en),
  position title, offices, roles; on first sign-in the API activates the membership and sets
  `app_metadata.tenant_id`. Invitation emails go through Supabase Auth SMTP (the only email in
  this feature; PR notifications stay in-app).
- **Rationale**: FR-016; keeps tenant claim server-controlled.
- **Alternatives considered**: Self-sign-up + join codes (weaker control for NGOs).

## R18. Testing strategy

- **Decision**:
  - **Unit (Vitest, `apps/api/tests/unit`)**: one suite per business rule 1–12 and per clarified
    rule (reservation lifecycle, frozen grants, locked rates), testing services with in-memory
    repositories; `packages/shared` tests for money, conversion, amount-in-words, date formatter.
  - **Integration (Vitest + supertest, `apps/api/tests/integration`)**: against local Supabase
    (`supabase start`, Docker) — PR state machine end to end through HTTP, RLS isolation between
    two tenants and between offices, concurrency test firing parallel submits at the last
    available budget (exactly one succeeds), numbering under parallel submits, budget report
    performance with 5,000 seeded PRs.
  - **E2E (Playwright, `apps/web/e2e`)**: RTHA PR 0010 entered, submitted, finance-checked,
    approved, printed; run in `ar` and `en`. Visual verification and screenshots via Chrome
    DevTools MCP per the constitution's workflow.
- **Rationale**: Principle X; the plan input's three test layers.
- **Alternatives considered**: pgTAP for RLS (good, but a second test runner; RLS is covered via
  real JWTs in integration tests).

## R19. Theming and fonts

- **Decision**: shadcn tokens in `packages/ui` with `--primary` (and `--primary-foreground`,
  `--ring`) overridden as CSS variables; placeholder brand hue (deep teal, `hsl(174 72% 26%)`)
  until the owner chooses. Fonts via `next/font/google`: IBM Plex Sans Arabic (Arabic, default)
  and IBM Plex Sans (Latin), same families embedded in PDFs. Tailwind logical properties
  (`ms-*`, `me-*`, `ps-*`, `pe-*`) only; `dir` set on `<html>` from locale.
- **Rationale**: Plex Arabic has clearer tabular figures than Cairo for financial tables and a
  matching Latin family.
- **Alternatives considered**: Cairo (rounder, more decorative; kept as a one-line swap).

## R20. Tooling availability (environment)

- **Finding**: The constitution's workflow names Supabase MCP (migrations, type generation), Ref
  MCP (docs), and Chrome DevTools MCP (UI verification). In this workspace Supabase MCP and Ref
  MCP are not configured, and Chrome DevTools MCP failed to connect in the planning session.
- **Decision**: Migrations are authored as SQL files in `packages/database/migrations` (required
  anyway) and applied with Supabase MCP `apply_migration` once configured; until then the
  Supabase CLI (`supabase migration up`, `supabase gen types`) is the fallback. This is listed
  as a prerequisite in [quickstart.md](./quickstart.md) and must be confirmed before
  `/speckit-implement`.
