---

description: "Task list for 001-grants-pr-foundation"
---

# Tasks: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

**Input**: Design documents from `specs/001-grants-pr-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (rest-api.md,
rls-and-permissions.md, print-layout.md), quickstart.md, `.specify/memory/constitution.md`

**Tests**: INCLUDED. Constitution Principle X requires a service-level test for every business
rule and an end-to-end acceptance test from real sample data (RTHA PR 0010); plan.md and
research R18 define the unit / integration / E2E layers. Within each story, write the tests
first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested
as an increment. The whole database schema is in Phase 2 because every story shares it and the
audit trigger (migration 0006) must attach to all tables.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: User story the task belongs to (US1–US8)
- Every task names its exact file path(s)

## Path Conventions

Monorepo per plan.md: `apps/api/src/`, `apps/api/tests/`, `apps/web/src/`, `apps/web/e2e/`,
`packages/shared/src/`, `packages/database/`, `packages/ui/`. Workspace scope `@ngo/*`.

## Conventions every task must follow

- Money columns `numeric(18,2)`, rates `numeric(18,6)`; money crosses the API as decimal strings
  `{ "amount": "870710.00", "currency": "SDG" }`; arithmetic only with decimal.js via
  `packages/shared/src/money/` (never JS `number`).
- Dates: ISO `YYYY-MM-DD` in API/DB; display only through `packages/shared/src/format/date.ts`
  (`DD/MM/YYYY`, Latin digits).
- No hard-coded UI strings: every label goes into `apps/web/src/messages/ar.json` **and**
  `en.json`; API errors render on the client by `code`.
- Every tenant table: `tenant_id` + RLS in its creating migration, policies only in the shapes of
  contracts/rls-and-permissions.md §1 using `(select app.current_tenant_id())`.
- Routes only validate (Zod from `@ngo/shared`) and delegate; business rules live in services;
  errors are `AppError(code, message, details?)` → `{ code, message, details? }`.
- All mutations go through the idempotency middleware; PR commands and budget-line amount edits
  run inside `withTenantTx` (research R4).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo initialization and tooling

- [X] T001 Create root monorepo files: `package.json` (pnpm 8.15 `packageManager`, scripts `dev`, `build`, `lint`, `type-check`, `test`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `turbo.json` (tasks dev/build/lint/type-check/test/test:unit/test:integration/e2e), `.npmrc`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `.nvmrc` (20)
- [X] T002 [P] Add formatting config at repo root: `.prettierrc` (single quotes, semicolons, printWidth 100, trailingComma es5, endOfLine lf), `.prettierignore`, `.editorconfig`, extend `.gitignore` (node_modules, .next, dist, .turbo, `.env*` except `.env.example`, supabase/.temp)
- [X] T003 [P] Create root ESLint config `eslint.config.mjs` with TypeScript + React rules, an i18n rule forbidding literal JSX text in `apps/web/src/**` (e.g. `react/jsx-no-literals` with allowlist for punctuation), and `no-restricted-syntax`/`no-restricted-properties` banning `toLocaleDateString`, `toLocaleString` on dates and `Intl.DateTimeFormat` everywhere except `packages/shared/src/format/date.ts` (research R15)
- [X] T004 [P] Scaffold `packages/shared` (`@ngo/shared`): `package.json` (deps zod 3.22, decimal.js; tsup build; vitest), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts` barrel
- [X] T005 [P] Scaffold `packages/database` (`@ngo/database`): `package.json` with scripts `migrate`, `gen:types`, `seed:demo`, `test`, `tsconfig.json`, empty `migrations/`, `src/index.ts`, `vitest.config.ts`
- [X] T006 [P] Scaffold `packages/ui` (`@ngo/ui`): `package.json`, `tailwind.preset.ts`, `src/styles/tokens.css` with shadcn tokens and `--primary: 174 72% 26%`, `--primary-foreground`, `--ring` (research R19), `components.json` for shadcn, `src/index.ts`; add base shadcn components (button, input, textarea, select, dialog, dropdown-menu, table, badge, tabs, toast, form, checkbox, popover, card, sheet) under `packages/ui/src/components/`
- [X] T007 [P] Scaffold `apps/api` (`@ngo/api`): `package.json` (express 4.18, zod, helmet 7, cors, express-rate-limit, @supabase/supabase-js 2, postgres 3, decimal.js, exceljs, jose; dev: tsup 8, vitest 1, supertest, tsx), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` with projects `unit` (`tests/unit/**`) and `integration` (`tests/integration/**`, sequential), scripts `dev`, `build`, `test:unit`, `test:integration`
- [X] T008 [P] Add `apps/api/Dockerfile` (Node 20 slim, pnpm deploy of `@ngo/api`) and `apps/api/fly.toml` (internal port 4000, health check `/api/v1/health`)
- [X] T009 [P] Scaffold `apps/web` (`@ngo/web`): Next.js 14.2 App Router, `package.json` (next-intl 3, @tanstack/react-query 5, @tanstack/react-table 8, @tanstack/react-virtual 3, react-hook-form 7, @hookform/resolvers, zustand 4, @react-pdf/renderer 3, @supabase/ssr, @supabase/supabase-js, lucide-react, @ngo/ui, @ngo/shared; dev: @playwright/test), `next.config.mjs` with next-intl plugin and `transpilePackages`, `tailwind.config.ts` using `@ngo/ui` preset, `postcss.config.js`, `tsconfig.json`, `playwright.config.ts` (projects `ar` and `en`, baseURL `http://localhost:3000`)
- [X] T010 Initialize Supabase locally: `supabase/config.toml` at repo root (project id `ngo-procurement`, Auth email invites enabled, API port defaults) and make `packages/database/scripts/migrate.ts` the single entry that applies `packages/database/migrations/*.sql` in filename order via `supabase db push --local`/`psql $DATABASE_URL` (Supabase MCP `apply_migration` when configured, research R20)
- [X] T011 [P] Create `apps/api/.env.example` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` with note "transaction pooler, prepare:false", `PORT=4000`, `CORS_ORIGINS`) and `apps/web/.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`); no real values
- [X] T012 [P] Add IBM Plex Sans Arabic and IBM Plex Sans TTF files (Regular, Medium, Bold) plus `OFL.txt` to `apps/web/src/fonts/` for PDF embedding (research R13, R19)
- [X] T013 **Gate for Phase 2**: verify tooling prerequisites from research R20 — Supabase MCP configured, else the Supabase CLI works (`npx supabase start`, `supabase db push`, `supabase gen types`); Chrome DevTools MCP connects, else Playwright screenshots work — and record the chosen path under "Prerequisites" in `specs/001-grants-pr-foundation/quickstart.md` (constitution v1.1.0 Development Workflow). Do not start Phase 2 until one path is confirmed for each

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, security, shared libraries, API and web skeletons that every
story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database schema (sequential — migrations depend on each other)

- [X] T014 Write `packages/database/migrations/0001_helpers_rls.sql`: `create extension` pgcrypto, citext, pg_trgm; schemas `app` and `audit`; `app.touch_updated_at()` trigger function; RLS helpers per contracts/rls-and-permissions.md §1 — `app.current_tenant_id()` (reads `auth.jwt()->'app_metadata'->>'tenant_id'`, returns it only if an `active` membership exists for `(auth.uid(), tenant)`, else NULL; never reads `user_metadata`), `app.current_membership_id()`, `app.has_office_access(office_id uuid)`, `app.has_permission(code text)`; all `STABLE SECURITY DEFINER`, `set search_path = ''`, written in `language plpgsql` so bodies may reference tables created in 0002
- [X] T015 Write `packages/database/migrations/0002_org_access.sql` per data-model §1: `tenant` (name_ar/name_en required, logo_path, address, phone, email, website, `base_currency char(3)` default `SDG`, `doa_reference_currency` default `USD`, `fiscal_year_start_month smallint` check 1–12 default 1, `timezone` default `Africa/Khartoum`, `max_backdate_days smallint` check 0–365 default 30; RLS `id = app.current_tenant_id()`), `membership` (unique `(tenant_id, user_id)`, email citext, full_name_ar/en, position_title, org_wide_access default false, status check `invited|active|suspended`, invited_at, activated_at), `office` (code check `^[A-Z0-9]{2,10}$`, unique `(tenant_id, code)`, name_ar/en, address, phone, is_active), `user_office` (unique `(tenant_id, membership_id, office_id)`), global `permission` (code PK, description_ar/en; read-only to authenticated), `role` (key null, name_ar/en unique per tenant, is_system), `role_permission` (PK `(role_id, permission_code)` + tenant_id), `user_role` (unique `(tenant_id, membership_id, role_id)`); FKs to currency deferred to 0003 via `alter table`; RLS + `tenant_select`/`tenant_write` policies; `touch_updated_at` triggers; standard columns (id, created_at, updated_at, created_by)
- [X] T016 Write `packages/database/migrations/0003_config.sql` per data-model §2: global `currency` (code char(3) PK, minor_units check 0–3, Arabic singular/dual/plural and English singular/plural major and minor names), add FKs `tenant.base_currency`/`doa_reference_currency → currency`; `unit_of_measure` (code unique per tenant, name_ar/en, is_active); `numbering_config` (doc_type check `= 'PR'`, unique `(tenant_id, doc_type)`, prefix default `PR`, include_office default true, include_year default true, padding check 1–10 default 4, separator default `-`); `document_sequence` (PK `(tenant_id, doc_type, office_id, year)`, `last_value integer check >= 0`; select/insert/update policies for tenant only, no delete); `approval_rule` (doc_type, office_id null, name, is_active, unique `(tenant_id, doc_type, office_id)` NULLS NOT DISTINCT); `approval_rule_step` (rule_id FK cascade, step_order ≥ 1, kind check `finance_check|approval|final_approval`, role_id FK, min_amount/max_amount numeric(18,2) null, check `max_amount is null or min_amount is null or max_amount > min_amount`, check finance_check rows have no band); RLS + triggers
- [X] T017 Write `packages/database/migrations/0004_funding.sql` per data-model §3: `donor` (name required, unique per tenant on `lower(name)`, short_name, contact_name/email/phone, notes, is_active), `"grant"` (donor_id FK, code unique per tenant stored as entered, name, currency FK, `total_amount check > 0`, start_date, end_date check `end_date >= start_date`, status check `active|suspended|closed`, `version integer`), `grant_office` (unique `(tenant_id, grant_id, office_id)`), `activity` (code unique per grant, name, is_active), `budget_line` (code text unique per grant, description, category check `supplies|services|staff|equipment|running_costs`, `budget_amount check >= 0`, office_id null, is_active, version), `exchange_rate` (currency FK, `rate_to_base numeric(18,6) check > 0`, rate_date, source text not null, index `(tenant_id, currency, rate_date desc, created_at desc)` — no uniqueness on date, so corrections are new rows; trigger rejecting currency = tenant base currency); all FKs `on delete restrict`; RLS + triggers
- [X] T018 Write `packages/database/migrations/0005_pr.sql` per data-model §4–5: `purchase_requisition` (all columns in data-model §4 incl. `version`, `submission_cycle smallint default 0`, `current_step_order`, locked DoA/grant rate columns incl. `doa_exchange_rate_id`/`grant_exchange_rate_id` (FK `exchange_rate` on delete restrict), `total_grant_currency`, `print_snapshot jsonb`, reasons; status check `draft|pending_finance_check|pending_approval|approved|returned|rejected|cancelled`; check `status = 'draft' or number is not null`; unique `(tenant_id, number)`; pr_type check `goods|services|mixed`); office-scoped RLS `tenant_id = (select app.current_tenant_id()) and (app.has_office_access(requesting_office_id) or requester_id = auth.uid())`; `pr_line` (line_no unique per PR, quantity numeric(18,3) check > 0, unit_cost check ≥ 0, `line_total numeric(18,2) generated always as (round(quantity * unit_cost, 2)) stored`, currency, budget_line_id, location_office_id not null, activity_id, locked rate columns, amount_grant); `pr_attachment` (storage_path, file_name, mime_type, `size_bytes check <= 10485760`, uploaded_by, deleted_at); `pr_approval_step` (unique `(pr_id, cycle, step_order)`, kind, required_role_id, rule_step_id, assigned_user_id, status check `waiting|pending|approved|rejected|returned|cancelled`, acted_at); `approval_action` (cycle, `step_order smallint null`, action check `submit|approve|reject|return|cancel|reassign|change_budget_line`, user_name, user_position, comment, payload jsonb, acted_at; unique partial index `(pr_id, cycle, user_id) where action = 'approve'`; trigger blocking UPDATE/DELETE; select+insert policies only); `budget_commitment` (unique `(pr_id, budget_line_id, cycle)`, `amount check > 0`, status check `reserved|committed|released`, reserved_at/committed_at/released_at, release_reason check `returned|rejected|cancelled|budget_line_changed`; partial index `(budget_line_id) where status in ('reserved','committed')`); `notification` (user_id, kind check per data-model §5, pr_id, params jsonb, read_at; RLS `tenant_id = (select app.current_tenant_id()) and user_id = auth.uid()`); `idempotency_key` (PK `(tenant_id, user_id, key)`, request_hash, status_code, response_json, created_at)
- [X] T019 In the same file `packages/database/migrations/0005_pr.sql`, add triggers and views: (a) `pr_line` trigger raising if `budget_line.grant_id` or `activity.grant_id` ≠ PR's `grant_id` (FR-023); (b) `purchase_requisition` BEFORE DELETE trigger allowing delete only when `status = 'draft' and number is null` (FR-043); (c) `office` BEFORE UPDATE trigger raising `OFFICE_CODE_IN_USE` when code changes and any PR references the office (FR-002); (d) deferred constraint trigger on `budget_commitment` (`deferrable initially deferred`) raising `BUDGET_EXCEEDED` when any touched budget line has `available < 0`; (e) view `budget_line_balance` (`security_invoker = true`) with budget, reserved, committed, `actual = 0`, `available = budget − reserved − committed − actual`, `pct_used = (reserved + committed + actual) / nullif(budget,0) * 100`; (f) view `grant_summary` (`security_invoker = true`) with budget_lines_total, difference, pending_pr_count; (f2) `exchange_rate` BEFORE UPDATE/DELETE trigger raising `EXCHANGE_RATE_IN_USE` when the row is referenced by any `pr_line.exchange_rate_id` or PR `doa_exchange_rate_id`/`grant_exchange_rate_id` (FR-015); (g) trigram GIN indexes on `purchase_requisition.number` and `pr_line.description`; (h) indexes for list filters `(tenant_id, status)`, `(tenant_id, requesting_office_id)`, `(tenant_id, grant_id)`, `(tenant_id, pr_date)`
- [X] T020 Write `packages/database/migrations/0006_audit.sql`: append-only `audit_history` (bigint identity id, tenant_id, table_name, record_id, action, actor_id, occurred_at, from_state, to_state, changed_fields text[], old_data, new_data, comment from `current_setting('app.audit_comment', true)`, request_id from `current_setting('app.request_id', true)`; index `(tenant_id, table_name, record_id, occurred_at)`; RLS select for `app.has_permission('audit:read')` or for PR-related records the caller can read; insert only via trigger; UPDATE/DELETE revoked and blocked by trigger); generic `audit.log_change()` (AFTER INSERT/UPDATE/DELETE, records from/to state when the row has `status`); attach it to every table from 0002–0005 except `audit_history`, `notification`, `idempotency_key`
- [X] T021 Write `packages/database/migrations/0007_storage.sql`: private buckets `pr-attachments` and `org-assets`; storage policies where `(storage.foldername(name))[1]::uuid = app.current_tenant_id()`, and for `pr-attachments` office access via the PR id in segment 2 (research R11)
- [X] T022 Write `packages/database/migrations/0008_seed_reference.sql`: `currency` rows SDG (جنيه سوداني/جنيهان سودانيان/جنيهات سودانية; قرش/قرشان/قروش; Sudanese Pound/Pounds; Piastre/Piastres), USD (دولار أمريكي…; سنت; Dollar/Cents), EUR (يورو; سنت; Euro/Cent), GBP, SAR, all minor_units 2; `permission` rows for the 13 codes in contracts/rls-and-permissions.md §3 with Arabic and English descriptions
- [X] T023 Implement `packages/database/scripts/migrate.ts` and `packages/database/scripts/gen-types.ts` (writes `packages/database/src/types.ts` via `supabase gen types typescript --local`), then run both and commit the generated `packages/database/src/types.ts`
- [X] T024 [P] Write RLS lint test `packages/database/tests/rls-lint.test.ts`: query `pg_class`/`pg_policies`; fail if any `public` table lacks RLS, lacks a policy, or has a policy whose `qual`/`with_check` does not call `app.current_tenant_id()` (allow-list only the global `currency` and `permission` tables, which get read-only policies)

### Shared package

- [X] T025 [P] Implement `packages/shared/src/permissions.ts`: `PERMISSIONS` const for all 13 codes in contracts/rls-and-permissions.md §3, `Permission` type, `SEEDED_ROLES` map (keys `org_admin`, `requester`, `finance_checker`, `approver`, `viewer` with permission lists exactly as §4: admin = all except `pr:finance_check`, `pr:approve`), and `STEP_KIND_PERMISSION` (`finance_check → pr:finance_check`, `approval|final_approval → pr:approve`)
- [X] T026 [P] Implement `packages/shared/src/errors.ts`: `ERROR_CODES` with every code and HTTP status from contracts/rest-api.md "Error codes", `ApiError` type `{ code, message, details? }`, typed `details` for `BUDGET_EXCEEDED` (`lines: [{ budgetLineId, code, requested, available, shortfall, currency, prLineIds }]`), `BUDGET_BELOW_USAGE` (`{ minimum }`), `EXCHANGE_RATE_MISSING` (`{ currencies, date }`), `PR_DATE_OUT_OF_RANGE` (`{ prDate, earliest, latest }`), `NO_ELIGIBLE_APPROVER` (`{ stepOrder, kind, roleId, roleName, ruleId }`)
- [X] T027 [P] Write tests `packages/shared/tests/money.test.ts` then implement `packages/shared/src/money/index.ts`: `Money` = `{ amount: string; currency: string }`, `parseAmount`, `add`, `multiply`, `roundHalfUp(value, minorUnits)`, `formatAmount` (`,` thousands, 2 decimals, code after amount), `convertLine(lineTotal, rateToBase, targetRateToBase, targetMinorUnits)` = `lineTotal × rate ÷ targetRate` rounded half-up per line (research R7), `sumByCurrency`; base currency implies rate 1
- [X] T028 [P] Write tests `packages/shared/tests/date.test.ts` then implement `packages/shared/src/format/date.ts`: `formatDate('2026-11-10') → '10/11/2026'` by string slicing (no `Date` parsing), `parseDisplayDate('10/11/2026') → '2026-11-10'` with validation, `formatDateTime(instant, timeZone)` → `DD/MM/YYYY HH:mm` via `Intl.DateTimeFormat(...).formatToParts`, Latin digits only
- [X] T029 [P] Implement `packages/shared/src/pr-state.ts`: `PR_STATUSES`, `PrAction` union, `TRANSITIONS` table exactly as data-model §6 (from, action, to), `canTransition(from, action)`, `isPending(status)`, `isEditableByRequester(status)` (`draft|returned`), `watermarkFor(status)` per print-layout.md rules
- [X] T030 [P] Implement `packages/shared/src/schemas/common.ts`: Zod `moneyString` (decimal string ≤ 2 dp, ≥ 0), `rateString` (≤ 6 dp, > 0), `isoDate`, `currencyCode` (`^[A-Z]{3}$`), `uuid`, `pagination` (`page` ≥ 1, `pageSize` 1–200 default 50), `sort` (`field:asc|desc`), `listResponse<T>()`, `expectedVersion`, `reason` (trimmed, min 1); export all from `packages/shared/src/index.ts`

### API skeleton

- [X] T031 Implement `apps/api/src/config/env.ts` (Zod-validated env from T011; fail fast on missing values)
- [X] T032 Implement DB access in `apps/api/src/db/`: `supabase.ts` (`createUserClient(accessToken)` user-scoped supabase-js client; `adminClient` with service-role key used only for Auth admin calls), `pool.ts` (`postgres(DATABASE_URL, { prepare: false })`), `tx.ts` `withTenantTx(ctx, fn)` running `set local role authenticated`, `set_config('request.jwt.claims', claimsJson, true)`, `set_config('app.request_id', ..., true)` and exposing `tx.setAuditComment(text)` (contracts/rls-and-permissions.md §2)
- [X] T033 [P] Implement `apps/api/src/middleware/request-id.ts` (echo/generate `X-Request-Id`) and `apps/api/src/middleware/error.ts` (`AppError` class, Zod → `400 VALIDATION_ERROR` with `details: [{ field, message }]`, Postgres errors raised by triggers with `BUDGET_EXCEEDED` / `OFFICE_CODE_IN_USE` / `EXCHANGE_RATE_IN_USE` messages mapped to their codes, unknown → `500 INTERNAL_ERROR`; response always `{ code, message, details? }`)
- [X] T034 [P] Implement `apps/api/src/middleware/auth.ts` (verify Bearer JWT with `SUPABASE_JWT_SECRET` via jose → `401 UNAUTHORIZED`; attach `req.auth = { userId, claims, accessToken }`)
- [X] T035 Implement `apps/api/src/middleware/tenant.ts` (read `app_metadata.tenant_id`, load active membership, permissions, office ids, `orgWideAccess` once per request → `req.ctx`; no tenant/membership → `403 FORBIDDEN`) and `apps/api/src/middleware/permission.ts` (`requirePermission(code)` → `403 FORBIDDEN`)
- [X] T036 [P] Implement `apps/api/src/middleware/validate.ts` (`validate({ body?, query?, params? })` with shared Zod schemas) and `apps/api/src/middleware/rate-limit.ts` (300 req/min/user, writes 60/min → `429 RATE_LIMITED`)
- [X] T037 Implement `apps/api/src/middleware/idempotency.ts`: for POST/PATCH/PUT/DELETE with `Idempotency-Key`, hash method+path+body; replay same key+hash → stored status/response; same key different hash → `409 IDEMPOTENCY_KEY_REUSED`; store response in `idempotency_key`; purge rows older than 24 h opportunistically
- [X] T038 Implement `apps/api/src/repositories/base.repository.ts` (tenant-scoped supabase-js helpers: list with pagination/sort → `{ data, page, pageSize, total }`, getById → `404 NOT_FOUND`, insert, update with `expectedVersion` → `409 VERSION_CONFLICT`; camelCase ↔ snake_case mapping)
- [X] T039 Implement `apps/api/src/index.ts` (middleware order exactly as contracts/rls-and-permissions.md §5) and `apps/api/src/routes/index.ts` mounting `/api/v1` routers plus `GET /api/v1/health` → `{ status: 'ok', version }`
- [X] T040 Implement session endpoints: `apps/api/src/services/session.service.ts` (`getMe` → user, active membership, memberships list, permissions[], offices[], orgWideAccess; activates an `invited` membership on first call and sets `app_metadata.tenant_id` via admin client; `switchTenant(tenantId)` requires active membership, sets `app_metadata.tenant_id`) and `apps/api/src/routes/session.routes.ts` (`GET /me`, `POST /session/tenant`)

### Web skeleton

- [X] T041 Configure i18n: `apps/web/src/i18n.ts` (locales `ar` default, `en`), `apps/web/src/middleware.ts` (next-intl locale routing + Supabase session refresh), `apps/web/src/messages/ar.json` and `en.json` with `common`, `errors` (one key per error code from T026), `nav`, `status` (each PR status) namespaces
- [X] T042 Implement `apps/web/src/app/[locale]/layout.tsx` (`<html lang dir>` from locale: `ar → rtl`; IBM Plex Sans Arabic + IBM Plex Sans via `next/font/google`; import `@ngo/ui` tokens), `apps/web/src/app/providers.tsx` (QueryClientProvider, NextIntlClientProvider, Toaster)
- [X] T043 [P] Implement Supabase clients `apps/web/src/lib/supabase/client.ts` and `apps/web/src/lib/supabase/server.ts` (`@supabase/ssr`), login page `apps/web/src/app/[locale]/(auth)/login/page.tsx` (email + password and magic link), invite-accept/set-password page `apps/web/src/app/[locale]/(auth)/accept-invite/page.tsx`
- [X] T044 [P] Implement `apps/web/src/lib/api-client.ts` (fetch wrapper: Bearer token, new `Idempotency-Key` uuid per mutation retained across retries, parses `{ code, message, details }` into `ApiError`), `apps/web/src/lib/query-keys.ts`, and `apps/web/src/lib/use-api-error.ts` (renders `errors.<code>` via next-intl)
- [X] T045 [P] Implement shared inputs in `packages/ui/src/components/date-input.tsx` (DD/MM/YYYY text input using `parseDisplayDate`/`formatDate`, emits ISO) and `packages/ui/src/components/money-input.tsx` (decimal string, currency suffix, no float parsing)
- [X] T046 Implement the authenticated app shell `apps/web/src/app/[locale]/(app)/layout.tsx` with `apps/web/src/features/shell/app-nav.tsx` (permission-aware links from `GET /me`), `apps/web/src/features/shell/org-switcher.tsx` (`POST /session/tenant` then session refresh), `apps/web/src/features/shell/locale-switcher.tsx`, and `apps/web/src/lib/use-me.ts`; use Tailwind logical properties only (`ms-*`, `pe-*`…)

### Test infrastructure

- [X] T047 Implement integration harness `apps/api/tests/integration/helpers/`: `setup.ts` (requires `supabase start`; runs migrations once; truncates tenant tables between files), `factories.ts` (`createTenant`, `createUser(roles, offices)` via Auth admin, `tokenFor(user)` with `app_metadata.tenant_id`, `createGrant`, `createBudgetLine`, `createRate`, `createDraftPr`), `http.ts` (supertest agent with auth + idempotency headers)
- [X] T048 [P] Implement unit helpers `apps/api/tests/unit/helpers/in-memory-repos.ts` (in-memory implementations of repository interfaces used by services) and `apps/api/tests/unit/helpers/builders.ts` (PR, line, budget line, rule builders)
- [X] T049 [P] Write `apps/api/tests/integration/rls-isolation.int.test.ts` (tenant part): tenant A token cannot read or write any tenant B row via API (`404 NOT_FOUND`) or direct supabase-js; a suspended membership loses access immediately (FR-006)
- [X] T050 [P] Write `apps/api/tests/integration/tx-context.int.test.ts`: consecutive `withTenantTx` calls for different users/tenants through the pooler never leak `request.jwt.claims` or `app.audit_comment` (plan Risks)

**Checkpoint**: Schema migrated, RLS lint green, `GET /me` works, web shell renders in `ar` (RTL) and `en`.

---

## Phase 3: User Story 1 — Organization setup (Priority: P1) 🎯 MVP

**Goal**: An admin creates an organization and maintains profile, offices, units of measure, and
PR numbering; defaults are seeded.

**Independent Test**: Create a new organization, complete setup, and confirm offices, units, and
PR numbering (preview `PR-MAD-2026-0001`) are available when starting a PR.

### Tests for User Story 1 ⚠️

- [ ] T051 [P] [US1] Unit test `apps/api/tests/unit/tenant-setup.service.test.ts`: creating a tenant seeds the 11 units (PCs, PAK, Person, Day, Kg, Liter, Box, Set, Meter, Month, Lump sum), 5 roles with exactly the permissions of `SEEDED_ROLES`, `numbering_config` PR (`PR`, include office, include year, padding 4, `-`), default org-wide rule (step 1 `finance_check` → Finance Checker; step 2 `final_approval` band 0–∞ → Approver), and a membership for the creator with `org_admin` and `org_wide_access = true` (US1-3)
- [ ] T052 [P] [US1] Unit test `apps/api/tests/unit/numbering.service.test.ts`: `formatNumber` → `PR-MAD-2026-0010` for defaults; respects include_office=false, include_year=false, padding 1–10, custom separator/prefix; year = calendar year of the **submission date** in the tenant timezone, not the PR date — a PR dated 28/12/2025 submitted on 02/01/2026 gets a 2026 number (Business Rule 9 formatting, FR-004)
- [ ] T053 [P] [US1] Integration test `apps/api/tests/integration/org-setup.int.test.ts`: `POST /tenants` → caller is admin and defaults exist; `PATCH /tenant` requires `settings:manage`; office code validation `^[A-Z0-9]{2,10}$` and uniqueness; changing the code of an office referenced by a PR → `409 OFFICE_CODE_IN_USE` (US1-2); `GET/PUT /numbering/PR` returns `preview`; changes are written to `audit_history` (FR-005)

### Implementation for User Story 1

- [X] T054 [P] [US1] Add Zod schemas `packages/shared/src/schemas/tenant.ts` (create/update profile: nameAr, nameEn required; baseCurrency, doaReferenceCurrency, fiscalYearStartMonth 1–12, timezone, maxBackdateDays 0–365), `office.ts` (code `^[A-Z0-9]{2,10}$`, nameAr, nameEn, address?, phone?, isActive), `unit.ts` (code, nameAr, nameEn, isActive), `numbering.ts` (prefix, includeOffice, includeYear, padding 1–10, separator)
- [ ] T055 [P] [US1] Implement repositories `apps/api/src/repositories/tenant.repository.ts`, `office.repository.ts`, `unit.repository.ts`, `numbering.repository.ts` (extend base repository; numbering repo exposes `nextValue(tx, docType, officeId, year)` using `insert … on conflict do update set last_value = document_sequence.last_value + 1 returning last_value`, research R6)
- [ ] T056 [US1] Implement `apps/api/src/services/tenant-setup.service.ts`: `createTenant(user, input)` in one `withTenantTx` — insert tenant, seed units, roles + role_permissions from `SEEDED_ROLES`, numbering_config, default approval rule + steps, admin membership/user_role; set `app_metadata.tenant_id` via admin client; `updateProfile`, `createLogoUploadUrl` (bucket `org-assets`, versioned path `{tenantId}/logo-{uuid}`; never overwrite or delete earlier logos because `print_snapshot` references them); `base_currency` immutable once any PR is submitted (depends on T054, T055)
- [ ] T057 [US1] Implement `apps/api/src/services/numbering.service.ts`: `formatNumber(config, officeCode, year, seq)`, `preview(docType, officeId?)`, `assignNumber(tx, docType, officeId, submittedAt, timeZone)` — year from the submission instant in the tenant timezone (used by US4 submit)
- [ ] T058 [P] [US1] Implement `apps/api/src/services/office.service.ts` and `apps/api/src/services/unit.service.ts` (CRUD, deactivate via `isActive=false`, never hard delete; map trigger error to `409 OFFICE_CODE_IN_USE`)
- [ ] T059 [US1] Implement routes `apps/api/src/routes/tenant.routes.ts` (`POST /tenants`, `GET/PATCH /tenant`, `POST /tenant/logo-upload-url`), `offices.routes.ts`, `units.routes.ts`, `numbering.routes.ts` (`GET/PUT /numbering/:docType` with `preview`) with permissions per contracts/rest-api.md; mount in `apps/api/src/routes/index.ts`
- [ ] T060 [P] [US1] Build onboarding page `apps/web/src/app/[locale]/(app)/onboarding/page.tsx` (create organization when the user has no membership) and `apps/web/src/features/setup/organization-form.tsx` + page `apps/web/src/app/[locale]/(app)/setup/organization/page.tsx` (bilingual names, logo upload via signed URL, address, contact, base currency, DoA reference currency, fiscal year start month, timezone, maximum PR backdating days)
- [ ] T061 [P] [US1] Build `apps/web/src/app/[locale]/(app)/setup/offices/page.tsx` with `apps/web/src/features/setup/offices-table.tsx` and `office-dialog.tsx` (code shown read-only with explanation when `OFFICE_CODE_IN_USE`)
- [ ] T062 [P] [US1] Build `apps/web/src/app/[locale]/(app)/setup/units/page.tsx` with `apps/web/src/features/setup/units-table.tsx` (inline add/edit/deactivate)
- [ ] T063 [P] [US1] Build `apps/web/src/app/[locale]/(app)/setup/numbering/page.tsx` with `apps/web/src/features/setup/numbering-form.tsx` (live preview from `GET /numbering/PR`, note that changes affect future numbers only)
- [ ] T064 [US1] Add all US1 strings to `apps/web/src/messages/ar.json` and `en.json` (`setup.*` namespace)

**Checkpoint**: US1 independently testable — new organization with offices, units, numbering preview.

---

## Phase 4: User Story 2 — Donors, grants, and budget lines (Priority: P1)

**Goal**: Maintain donors, grants, budget lines (manual + spreadsheet import), activities, and
manual exchange rates, with derived Budget / Reserved / Committed / Actual / Available.

**Independent Test**: Register a donor, a USD grant, budget lines (manually and by import), and an
exchange rate; budget figures display correctly and the grant is offered by
`GET /grants?selectableFor=pr`.

### Tests for User Story 2 ⚠️

- [ ] T065 [P] [US2] Unit test `apps/api/tests/unit/budget.service.test.ts`: balances derive Available = Budget − Reserved − Committed − Actual with Actual = 0 (FR-012); reducing `budget_amount` below reserved + committed + actual → `BUDGET_BELOW_USAGE` with `details.minimum` (US2-6, FR-014); grant summary difference ≠ 0 → warning flag, never error (US2-4, FR-013)
- [ ] T066 [P] [US2] Unit test `apps/api/tests/unit/exchange-rate.service.test.ts`: lookup returns latest `rate_date <= date`, and the latest-entered row when several share that date; updating or deleting a rate referenced by a PR → `EXCHANGE_RATE_IN_USE`, unused rates may be edited/deleted; none → `EXCHANGE_RATE_MISSING` with `{ currencies, date }`; base currency → rate 1 / source `base`; rate for base currency rejected (FR-015)
- [ ] T067 [P] [US2] Unit test `apps/api/tests/unit/budget-import.service.test.ts`: cells read as text so `2.2.31`, `010`, `10202` stay exactly as entered (FR-009); category must be one of `supplies|services|staff|equipment|running_costs` (Arabic/English labels accepted and mapped); amount > 0 with ≤ 2 decimals; duplicate code within file or existing in grant reported; invalid rows carry `{ row, values, errors: [{ column, code }] }`; commit with zero valid rows → `IMPORT_INVALID_ROWS` (US2-5, FR-010)
- [ ] T068 [P] [US2] Unit test `apps/api/tests/unit/grant.service.test.ts`: `end_date >= start_date`; status change with pending PRs returns `{ requiresConfirmation: true, pendingPrCount }` until `confirmPendingCount` matches (FR-022); currency immutable once any budget line has a commitment; `selectableFor=pr` lists only `active` grants covering `prDate` operating in `officeId` (US2-2, Business Rule 1)
- [ ] T069 [P] [US2] Integration test `apps/api/tests/integration/funding.int.test.ts`: donors/grants/budget lines/activities/rates CRUD with `grants:manage` / `rates:manage` enforcement; `GET /grants/:id/budget-lines` returns `budget, reserved, committed, actual, available, pctUsed` as decimal strings; import preview then commit of a fixture `apps/api/tests/fixtures/budget-lines.xlsx` (one bad category row) creates only valid rows in one transaction; budget-line reduction below usage under concurrent reservation → `422 BUDGET_BELOW_USAGE`

### Implementation for User Story 2

- [ ] T070 [P] [US2] Add Zod schemas `packages/shared/src/schemas/donor.ts` (name required, shortName?, contactName?, contactEmail?, contactPhone?, notes?), `grant.ts` (donorId, code, name, currency, totalAmount > 0, startDate, endDate ≥ startDate, officeIds[] min 1; status `active|suspended|closed`; status-change body `{ status, expectedVersion, confirmPendingCount? }`), `budget-line.ts` (code text min 1, description, category enum, budgetAmount ≥ 0, officeId?; balance response), `activity.ts` (code, name, isActive), `exchange-rate.ts` (currency, rateToBase > 0 ≤ 6 dp, rateDate, source required), `budget-import.ts` (preview/commit response)
- [ ] T071 [P] [US2] Implement repositories `apps/api/src/repositories/donor.repository.ts`, `grant.repository.ts` (incl. `grant_office` sync and `grant_summary` read), `budget-line.repository.ts` (incl. `budget_line_balance` read and `lockForUpdate(tx, ids)` ordered by id ascending), `activity.repository.ts`, `exchange-rate.repository.ts` (`latestOnOrBefore(currency, date)` ordered by `rate_date desc, created_at desc`; `isInUse(id)`)
- [ ] T072 [US2] Implement `apps/api/src/services/grant.service.ts` (donor + grant CRUD, office list, status change with pending-PR confirmation, currency immutability, selectable-for-PR query) and `apps/api/src/services/activity.service.ts`
- [ ] T073 [US2] Implement `apps/api/src/services/budget.service.ts`: budget-line CRUD; `updateAmount` inside `withTenantTx` locking the line and rejecting below usage (`BUDGET_BELOW_USAGE`); `getBalances(grantId)`; and the commitment primitives used by US4–US6 — `checkAvailability(tx, perLineAmounts, { excludePrId? })` returning per-line shortfalls, `reserve(tx, prId, cycle, perLineAmounts)`, `commit(tx, prId, cycle)`, `release(tx, prId, reason)`, `moveReservation(tx, prId, cycle, fromLineId, toLineId, amount)`
- [ ] T074 [US2] Implement `apps/api/src/services/exchange-rate.service.ts` (CRUD with update/delete refused for in-use rates → `409 EXCHANGE_RATE_IN_USE`; list items expose `inUse`; `lookup(currency, date)`; `resolveRate(tx, currency, date)` returning `{ rateToBase, rateDate, source, exchangeRateId }` or throwing `EXCHANGE_RATE_MISSING`)
- [ ] T075 [US2] Implement `apps/api/src/services/budget-import.service.ts`: parse `.xlsx`/`.csv` ≤ 5 MB with exceljs reading every cell as text, header columns `code, description, category, amount`, validate with shared schema, `preview` and `commit` (re-validate, insert all valid rows in one transaction)
- [ ] T076 [US2] Implement routes `apps/api/src/routes/donors.routes.ts`, `grants.routes.ts` (incl. `POST /grants/:id/status`, `GET /grants?selectableFor=pr&prDate=&officeId=`), `budget-lines.routes.ts` (incl. multipart `POST /grants/:id/budget-lines/import?mode=preview|commit`), `activities.routes.ts`, `exchange-rates.routes.ts` (incl. `/exchange-rates/lookup` and `DELETE /exchange-rates/:id`); mount in `apps/api/src/routes/index.ts`
- [ ] T077 [P] [US2] Build `apps/web/src/app/[locale]/(app)/donors/page.tsx` with `apps/web/src/features/grants/donors-table.tsx` and `donor-dialog.tsx`
- [ ] T078 [P] [US2] Build `apps/web/src/app/[locale]/(app)/grants/page.tsx` (list with status/donor filters) and `apps/web/src/features/grants/grant-form.tsx` (donor, code, name, currency, total, DD/MM/YYYY dates, offices multi-select) with status-change dialog `apps/web/src/features/grants/grant-status-dialog.tsx` showing the pending-PR count confirmation
- [ ] T079 [US2] Build `apps/web/src/app/[locale]/(app)/grants/[id]/page.tsx` and `apps/web/src/app/[locale]/(app)/grants/[id]/budget-lines/page.tsx` with `apps/web/src/features/grants/budget-lines-table.tsx` (Budget, Reserved, Committed, Actual, Available, % used; difference-from-total warning banner; `BUDGET_BELOW_USAGE` shows minimum) and `budget-line-dialog.tsx`; activities tab `apps/web/src/features/grants/activities-table.tsx`
- [ ] T080 [P] [US2] Build import wizard `apps/web/src/features/budget-import/import-wizard.tsx` (upload → preview valid/invalid rows with reasons → commit) opened from the budget-lines page
- [ ] T081 [P] [US2] Build `apps/web/src/app/[locale]/(app)/rates/page.tsx` with `apps/web/src/features/grants/rates-table.tsx` and `rate-dialog.tsx` (currency, rate to base, DD/MM/YYYY date, source; in-use rates shown read-only with an "Enter correction" action that opens a new rate prefilled with the same currency and date)
- [ ] T082 [US2] Add all US2 strings (`donors.*`, `grants.*`, `budgetLines.*`, `import.*`, `rates.*`, categories) to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US2 independently testable — funding structure with derived balances and import.

---

## Phase 5: User Story 3 — Users, roles, and approval rules (Priority: P1)

**Goal**: Invite users, assign roles/offices, edit roles, and configure DoA approval rules with
office precedence and amount bands.

**Independent Test**: Invite users with different roles, configure DoA bands, and use
`POST /approval-rules/resolve` for amounts/offices to confirm each resolves to the correct role
and eligible-user count.

### Tests for User Story 3 ⚠️

- [ ] T083 [P] [US3] Unit test `apps/api/tests/unit/approval-routing.service.test.ts`: office rule beats org-wide rule (US3-3); band match uses `min < amount ≤ max` with open top so 5,000 → band 1 and 7,000 → band 2 (US3-1); rule validation → `APPROVAL_RULE_INVALID` when step 1 is not `finance_check`, a second `finance_check` exists, finance check has a band, final step not highest, bands gap/overlap/don't start at 0/don't end open, non-final step has >1 row (FR-019, FR-035)
- [ ] T084 [P] [US3] Unit test `apps/api/tests/unit/eligibility.test.ts`: eligible = holds `required_role_id` AND that role grants the step kind's permission AND office access to the PR's requesting office AND not the PR creator AND has no `approve` action on a *different* `step_order` of the PR in any cycle AND no `approve` action in the current cycle (FR-032: re-signing the same step after a Return is allowed); assigned step limits eligibility to the assignee; zero eligible → `NO_ELIGIBLE_APPROVER` naming step, role, rule (US3-2, FR-020, Business Rules 5–6)
- [ ] T085 [P] [US3] Integration test `apps/api/tests/integration/users-roles.int.test.ts`: invite creates `invited` membership + offices + roles, first `GET /me` activates it; suspend removes access; role delete blocked while assigned or referenced by a rule; `PUT /approval-rules/:id` invalid → `422 APPROVAL_RULE_INVALID`; `POST /approval-rules/resolve` returns steps with eligible counts; edits appear in `audit_history`

### Implementation for User Story 3

- [ ] T086 [P] [US3] Add Zod schemas `packages/shared/src/schemas/user.ts` (invite: email, fullNameAr, fullNameEn, positionTitle, officeIds[], roleIds[] min 1, orgWideAccess; update adds `status active|suspended`), `role.ts` (nameAr, nameEn, permissions[] of `Permission`), `approval-rule.ts` (officeId|null, name, isActive, steps[{ stepOrder ≥ 1, kind, roleId, minAmount?, maxAmount? }]; resolve body `{ officeId, amount }`)
- [ ] T087 [P] [US3] Implement repositories `apps/api/src/repositories/membership.repository.ts` (with user_office, user_role sync), `role.repository.ts` (with role_permission sync), `approval-rule.repository.ts` (rule + steps full replace)
- [ ] T088 [US3] Implement `apps/api/src/services/user.service.ts` (invite via `adminClient.auth.admin.inviteUserByEmail` with redirect to `/[locale]/accept-invite`, create membership `invited`; update names/position/offices/roles/org-wide/status; never edit past signatures) and `apps/api/src/services/role.service.ts` (CRUD; block delete when assigned or referenced by `approval_rule_step`)
- [ ] T089 [US3] Implement `apps/api/src/services/approval-routing.service.ts`: `validateRule(steps)` (all rules from T083), `resolveRoute(officeId, doaAmount)` (office rule else org rule; picks band), `eligibleUsers(step, pr)` and `isEligible(userId, step, pr)` per T084, `materialiseSteps(tx, pr, cycle, route)` inserting `pr_approval_step` rows (step 1 `pending`, others `waiting`) — used by US4 submit
- [ ] T090 [US3] Implement routes `apps/api/src/routes/users.routes.ts` (`GET /users`, `POST /users/invite`, `PATCH /users/:membershipId`), `roles.routes.ts` (`GET /permissions`, CRUD `/roles`), `approval-rules.routes.ts` (`GET ?docType=PR`, `POST`, `PUT /:id`, `POST /resolve`); mount in `apps/api/src/routes/index.ts`
- [ ] T091 [P] [US3] Build `apps/web/src/app/[locale]/(app)/users/page.tsx` with `apps/web/src/features/users/users-table.tsx`, `invite-user-dialog.tsx`, `edit-user-dialog.tsx` (bilingual names, position title, offices, roles, org-wide toggle, suspend)
- [ ] T092 [P] [US3] Build `apps/web/src/app/[locale]/(app)/roles/page.tsx` with `apps/web/src/features/users/role-editor.tsx` (permission checklist grouped by resource, descriptions from `GET /permissions` in current locale)
- [ ] T093 [P] [US3] Build `apps/web/src/app/[locale]/(app)/approval-rules/page.tsx` with `apps/web/src/features/approval-rules/rule-editor.tsx` (ordered steps, Finance Check step locked as step 1 and not removable, final-approval band rows in DoA reference currency, office scope selector) and `rule-preview.tsx` (amount + office → resolved steps with eligible counts)
- [ ] T094 [US3] Add all US3 strings (`users.*`, `roles.*`, `permissions.*`, `approvalRules.*`) to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US3 independently testable — users invited, roles edited, DoA resolves correctly.

---

## Phase 6: User Story 4 — Create and submit a Purchase Requisition (Priority: P1)

**Goal**: Requesters create multi-line PRs with attachments and autosaved drafts, and submit them
with full validation, rate locking, numbering, routing, and budget reservation.

**Independent Test**: With a seeded organization, grant, budget line, and rate, a requester creates
a multi-line PR, submits it, and receives `PR-MAD-2026-0010` and status Pending Finance Check;
budget line Reserved increases by the PR total in grant currency.

### Tests for User Story 4 ⚠️

- [ ] T095 [P] [US4] Unit test `apps/api/tests/unit/pr-submit.service.test.ts` covering each guard and error: zero lines or zero total → `PR_EMPTY` (US4-4); required-by < PR date → `REQUIRED_BY_BEFORE_PR_DATE` (US4-3); PR date after the submission date or more than `max_backdate_days` (default 30) before it → `PR_DATE_OUT_OF_RANGE`, boundaries 0 and 30 days accepted, also on resubmission (FR-025); grant not active → `GRANT_NOT_ACTIVE`; PR date outside grant dates → `GRANT_PERIOD_MISMATCH` (US2-3, Business Rule 1); requesting office not in grant offices → `GRANT_OFFICE_MISMATCH`; missing rate for any line, grant, or DoA currency → `EXCHANGE_RATE_MISSING` (US4-5); per budget line Σ amount_grant > available → `BUDGET_EXCEEDED` with per-line `requested, available, shortfall, prLineIds` (US4-2, Business Rule 3); no eligible user for a step → `NO_ELIGIBLE_APPROVER`; non-creator or status not draft/returned → `FORBIDDEN`/`INVALID_STATE`; stale version → `VERSION_CONFLICT`
- [ ] T096 [P] [US4] Unit test `apps/api/tests/unit/pr-submit-effects.test.ts`: on success rates (value, date, source, exchange_rate id) are copied onto each line and the PR (including `doa_exchange_rate_id`/`grant_exchange_rate_id`) (Business Rule 11, FR-028); `amount_grant` rounded half-up per line and `total_grant_currency` = Σ lines; DoA amount computed in reference currency; number assigned only when `number is null`; `submission_cycle + 1`; steps materialised; one `reserved` commitment per budget line; `submit` approval_action with requester name/position snapshot; `pr_action_required` notifications for step-1 eligible users; requester snapshot `requester_name/position` set
- [ ] T097 [P] [US4] Unit test `apps/api/tests/unit/pr-draft.service.test.ts`: only the creator may update/delete; update only in `draft`/`returned`; delete only when `draft` and never numbered (Business Rule 8); lines renumbered 1..n; line location defaults to deliver-to office; budget line must belong to the PR grant (Business Rule 2); attachment rules: allowed MIME types (PDF, JPEG, PNG, WEBP, HEIC, DOCX, XLSX, CSV, TXT), ≤ 10 MB, ≤ 20 per PR, only while `draft`/`returned`
- [ ] T098 [P] [US4] Integration test `apps/api/tests/integration/budget-concurrency.int.test.ts`: 10 parallel submits of PRs that each fit alone but only one fits together → exactly one `200`, nine `422 BUDGET_EXCEEDED`; `budget_line_balance.available` never < 0; direct SQL insert of an over-budget commitment is rejected by the deferred trigger (SC-003, FR-037)
- [ ] T099 [P] [US4] Integration test `apps/api/tests/integration/numbering.int.test.ts`: parallel submits in one office/year get distinct consecutive numbers; sequence seeded to 9 → next is `PR-MAD-2026-0010` (US4-1); rolled-back submit consumes no number; deleted drafts leave no gaps; different office/year start their own sequence; the year comes from the submission date, not the PR date (SC-007, FR-026, FR-004)
- [ ] T100 [P] [US4] Integration test `apps/api/tests/integration/pr-draft.int.test.ts`: create draft → autosave `PATCH` with `expectedVersion` (stale → `409 VERSION_CONFLICT`); other user cannot edit/delete; attachment upload-url → complete → signed download URL; submit happy path returns `{ status: 'pending_finance_check', number, steps, reservations }` and requester then gets `409 INVALID_STATE` on `PATCH` (FR-027)

### Implementation for User Story 4

- [ ] T101 [P] [US4] Add Zod schemas `packages/shared/src/schemas/pr.ts`: draft header (prDate, requestingOfficeId, grantId, deliverToOfficeId, deliveryAddress?, contactName?, contactPhone?, requiredByDate?, activityId?, purpose?, prType `goods|services|mixed`), line (description required, specifications?, quantity > 0 ≤ 3 dp, unitId, unitCost ≥ 0 ≤ 2 dp, currency, budgetLineId, locationOfficeId, activityId?), `prDraftUpdate { expectedVersion, header, lines[] }`, `prSubmit { expectedVersion }`, PR detail response (header, lines with locked conversion fields, attachments, steps with `canApprove/canReject/canReturn/canChangeBudgetLine`, signatures, `availableActions[]`), attachment upload body `{ fileName, mimeType, sizeBytes }` with the allow-list and limits
- [ ] T102 [P] [US4] Implement repositories `apps/api/src/repositories/pr.repository.ts` (header + lines read/write, `lockForUpdate(tx, id)`, version bump), `pr-attachment.repository.ts`, `pr-approval-step.repository.ts`, `approval-action.repository.ts` (insert-only), `budget-commitment.repository.ts`, `notification.repository.ts` (insert within tx)
- [ ] T103 [US4] Implement `apps/api/src/services/pr.service.ts` (drafts): `createDraft`, `updateDraft` (diff against stored lines with `expectedVersion`: update changed lines by id, insert new, delete removed — never a full replace; no write and no version bump when nothing changed; creator + `draft|returned` only, renumber lines, default line location), `deleteDraft`, `getDetail(prId, user)` computing `availableActions` and per-step eligibility flags via `approval-routing.service`, attachment `createUploadUrl` / `completeUpload` / `softDelete` / `downloadUrl` (bucket `pr-attachments`, path `{tenantId}/{prId}/{attachmentId}`)
- [ ] T104 [US4] Implement `apps/api/src/services/notification.service.ts` `notifyStepEligible(tx, pr, step)` and `notifyRequester(tx, pr, kind)` inserting `notification` rows with `params { number, stepKind, actorName }` inside the caller's transaction (research R16)
- [ ] T105 [US4] Implement `submit` in `apps/api/src/services/pr-workflow.service.ts` inside one `withTenantTx`: lock PR `FOR UPDATE` and check creator/status/version; validate header rules incl. PR date within `[submission date − max_backdate_days, submission date]` in tenant timezone; resolve and lock rates per line currency, grant currency and DoA currency at the latest date ≤ PR date; compute `amount_grant` per line and DoA amount; resolve route and verify eligibility for every step; lock affected budget lines ascending; `checkAvailability` (excluding nothing); assign number via `numbering.service.assignNumber` (submission instant, tenant timezone) if null; set `submission_cycle + 1`, `current_step_order = 1`, status `pending_finance_check`, `submitted_at`; materialise steps; `reserve`; build and store `print_snapshot` (organization incl. `logoPath`, offices, grant, donor, activity, per-line unit/budget-line code/budget location/donor short name); write `submit` approval_action; set audit comment; notify step 1 (depends on T073, T074, T057, T089, T104)
- [ ] T106 [US4] Implement routes in `apps/api/src/routes/prs.routes.ts`: `POST /prs`, `GET /prs/:id`, `PATCH /prs/:id`, `DELETE /prs/:id`, `POST /prs/:id/attachments/upload-url`, `POST /prs/:id/attachments/:attId/complete`, `DELETE /prs/:id/attachments/:attId`, `GET /prs/:id/attachments/:attId/url`, `POST /prs/:id/submit`; mount in `apps/api/src/routes/index.ts`
- [ ] T107 [US4] Build PR form `apps/web/src/features/pr/pr-form.tsx` (React Hook Form + shared Zod resolver): header section (DD/MM/YYYY dates, office, grant picker from `GET /grants?selectableFor=pr&prDate&officeId`, deliver-to, address, contact, required-by, activity, purpose, type) and `apps/web/src/features/pr/pr-lines-table.tsx` (field array: description, specifications expandable, quantity, unit, unit cost, calculated line total, currency default base, budget line filtered by grant with Available hint, location default deliver-to, activity; totals per currency via `@ngo/shared` money)
- [ ] T108 [US4] Implement autosave `apps/web/src/features/pr/autosave-store.ts` (Zustand persisted to `localStorage` keyed by user id + PR id) and `apps/web/src/features/pr/use-autosave.ts` (debounced 2 s `PATCH /prs/:id` with version, skipped when the form hash is unchanged since the last save; on `VERSION_CONFLICT` prompt to reload; clear local copy after save/submit; restore on reopen) (research R10, FR-024)
- [ ] T109 [P] [US4] Build `apps/web/src/features/pr/attachments-panel.tsx` (signed-URL upload with type/size/count checks, list, remove while editable, download)
- [ ] T110 [US4] Build pages `apps/web/src/app/[locale]/(app)/prs/new/page.tsx` (creates draft then redirects), `apps/web/src/app/[locale]/(app)/prs/[id]/edit/page.tsx` (form + autosave + attachments + submit), and `apps/web/src/features/pr/submit-button.tsx` (on `BUDGET_EXCEEDED` highlight failing lines with shortfall in currency; on other codes show i18n message, e.g. "contact Finance" for `EXCHANGE_RATE_MISSING`)
- [ ] T111 [US4] Build read-only PR detail `apps/web/src/app/[locale]/(app)/prs/[id]/page.tsx` with `apps/web/src/features/pr/pr-header-view.tsx`, `pr-lines-view.tsx` (shows locked rate/date/source and grant-currency amounts), `pr-status-badge.tsx`, `pr-steps-view.tsx` (steps and signatures with name, position, DD/MM/YYYY HH:mm)
- [ ] T112 [US4] Add all US4 strings (`pr.form.*`, `pr.lines.*`, `pr.attachments.*`, `pr.submit.*`, PR types) to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US4 independently testable — draft → submitted with number, routing, reservation.

---

## Phase 7: User Story 5 — Review, approve, reject, or return (Priority: P1)

**Goal**: Eligible users sign Finance Check and Final Approval, or reject/return with a reason;
finance can move a line's budget line; admins can reassign; approval commits the budget.

**Independent Test**: Take a submitted PR through Finance Check and Final Approval with two
different users and confirm signatures (name, position, timestamp), status Approved, and Reserved
→ Committed on the budget line.

### Tests for User Story 5 ⚠️

- [ ] T113 [P] [US5] Unit test `apps/api/tests/unit/pr-approve.service.test.ts`: finance step approve → `pending_approval`, next step `pending`, next-step users notified; final approve → `approved`, `approved_at`, commitments `reserved → committed`, Available unchanged, requester notified `pr_approved` (US5-1, FR-036); signature stores user name + position at signing (later position change does not alter it, FR-031); creator → `SEGREGATION_OF_DUTIES` (US5-2, Business Rule 5); finance signer at final step → `SEGREGATION_OF_DUTIES` (US5-3, Business Rule 6); grant suspended/closed → `GRANT_NOT_ACTIVE`; grant dates no longer cover PR date → `GRANT_PERIOD_MISMATCH` (FR-034); wrong `stepId` or non-pending status → `INVALID_STATE`
- [ ] T114 [P] [US5] Unit test `apps/api/tests/unit/pr-return-reject.service.test.ts`: reject/return require reason; reject → `rejected`, release with `release_reason = 'rejected'`, notify `pr_rejected`; return → `returned`, open steps `returned`/`cancelled`, release `returned`, `return_reason` set, notify `pr_returned`; resubmitting a returned PR keeps its number, re-locks rates using rates entered since, restarts from step 1 in a new cycle with a fresh availability check and reservation (US5-5, US5-7, FR-038); after a Return at Final Approval, the cycle-1 Finance Checker may sign Finance Check in cycle 2 but is not eligible for Final Approval (FR-032)
- [ ] T115 [P] [US5] Unit test `apps/api/tests/unit/pr-change-budget-line.service.test.ts`: only in `pending_finance_check` by an eligible finance checker; target must be in the same grant; availability on target excludes this PR's own reservation; insufficient → `BUDGET_EXCEEDED` with shortfall (US5-4); success moves reservation (`release_reason = 'budget_line_changed'` + new reserved row), logs `change_budget_line` action with `{ lineId, fromBudgetLineId, toBudgetLineId }` (FR-033)
- [ ] T116 [P] [US5] Unit test `apps/api/tests/unit/pr-reassign.service.test.ts`: requires `pr:reassign`; target must be eligible for the step; sets `assigned_user_id`, logs `reassign` with `{ fromUserId, toUserId }` and reason, notifies the new user `pr_reassigned` (US5-6, FR-039)
- [ ] T117 [P] [US5] Integration test `apps/api/tests/integration/pr-state-machine.int.test.ts`: every transition in data-model §6 via HTTP and every disallowed one → `409 INVALID_STATE`; approved PR cannot be edited (`PATCH` → `INVALID_STATE`, Business Rule 7, FR-040) or deleted
- [ ] T118 [P] [US5] Integration test `apps/api/tests/integration/segregation.int.test.ts`: creator with approver role gets `403 SEGREGATION_OF_DUTIES` and `availableActions` excludes approval; finance signer cannot sign final step; DB unique index blocks a second `approve` row by the same user in the same cycle but accepts one in a new cycle (same `step_order`, after Return)
- [ ] T119 [P] [US5] Integration test `apps/api/tests/integration/frozen-grant.int.test.ts`: suspend grant with a pending PR → status endpoint first returns `requiresConfirmation` with `pendingPrCount`; approve blocked `422 GRANT_NOT_ACTIVE`; reservation kept; return/reject/cancel allowed and release it; reactivating unfreezes (FR-022)
- [ ] T120 [P] [US5] Integration test `apps/api/tests/integration/locked-rates.int.test.ts`: SDG PR on a USD grant; a new rate entered after submission does not change `amount_grant`, DoA amount, or committed amount at final approval (US2-1); after return + resubmit the new rate is used (FR-028)

### Implementation for User Story 5

- [ ] T121 [P] [US5] Add Zod schemas to `packages/shared/src/schemas/pr-actions.ts`: approve `{ expectedVersion, stepId, comment? }`, reject/return `{ expectedVersion, stepId, reason }`, change budget line `{ expectedVersion, budgetLineId, comment? }`, reassign `{ expectedVersion, userId, reason }`
- [ ] T122 [US5] Implement `approve`, `reject`, `return` in `apps/api/src/services/pr-workflow.service.ts` inside `withTenantTx`: lock PR, verify version/status/step is current and pending, eligibility + segregation (`SEGREGATION_OF_DUTIES`), approve-only guards (grant active and period covers PR date, not frozen); write signature `approval_action` with cycle, `step_order` and name/position snapshot; advance or finalise (`budget.service.commit`) or release (`budget.service.release`); update step statuses, `current_step_order`, reasons, timestamps; set `app.audit_comment`; notifications (depends on T073, T089, T104, T105)
- [ ] T123 [US5] Implement `changeBudgetLine` and `reassign` in `apps/api/src/services/pr-workflow.service.ts` (lock PR + both budget lines ascending, availability excluding own reservation, `moveReservation`, update `pr_line.budget_line_id`, log action; reassign eligibility check and notification)
- [ ] T124 [US5] Add routes to `apps/api/src/routes/prs.routes.ts`: `POST /prs/:id/approve`, `/reject`, `/return`, `/lines/:lineId/budget-line`, `/steps/:stepId/reassign`; update `getDetail` flags in `apps/api/src/services/pr.service.ts` (`canApprove`, `canReject`, `canReturn`, `canChangeBudgetLine`, frozen indicator)
- [ ] T125 [US5] Build `apps/web/src/features/pr/actions-panel.tsx` on the PR detail page: Approve (sign) with optional comment and confirmation showing the signer's name/position, Reject and Return dialogs with required reason (`apps/web/src/features/pr/reason-dialog.tsx`), frozen-grant banner; render only actions present in `availableActions`
- [ ] T126 [P] [US5] Build `apps/web/src/features/pr/change-budget-line-dialog.tsx` (finance checker, per line, budget lines of the same grant with Available; shows shortfall on `BUDGET_EXCEEDED`)
- [ ] T127 [P] [US5] Build `apps/web/src/features/pr/reassign-step-dialog.tsx` (users eligible for the step, reason required; visible with `pr:reassign`)
- [ ] T128 [US5] Allow resubmission from `returned` in `apps/web/src/app/[locale]/(app)/prs/[id]/edit/page.tsx` (show return reason banner, keep number) and add US5 strings (`pr.actions.*`, `pr.frozen.*`) to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US1–US5 complete the core P1 workflow: an approved PR with signatures and committed budget.

---

## Phase 8: User Story 6 — Cancel a PR (Priority: P2)

**Goal**: Requesters cancel their own PR before approval; users with `pr:cancel_approved` cancel
approved PRs; holds are released; cancelled PRs stay visible and numbers are never reused.

**Independent Test**: Cancel an approved PR and confirm Committed decreases by its amount and the
PR remains visible as Cancelled.

### Tests for User Story 6 ⚠️

- [ ] T129 [P] [US6] Unit test `apps/api/tests/unit/pr-cancel.service.test.ts`: reason required; creator may cancel from `pending_*` or `returned` (releases reservation if held, FR-041); a non-creator with `pr:cancel_approved` may also cancel `pending_*`/`returned` PRs and the requester gets `pr_cancelled`; a non-creator without it → `FORBIDDEN`; approved PR cancel requires `pr:cancel_approved` → `committed → released` with `release_reason = 'cancelled'` (US6-1, FR-042); without it → `FORBIDDEN` and `availableActions` excludes cancel (US6-2); `draft`, `rejected`, `cancelled` → `INVALID_STATE`; `cancel_reason`, `cancelled_by`, `closed_at` set; `cancel` approval_action logged; requester notified `pr_cancelled` when cancelled by someone else
- [ ] T130 [P] [US6] Integration test `apps/api/tests/integration/pr-cancel.int.test.ts`: cancel approved PR → budget report Committed drops by its amount and the PR still appears in `GET /prs` and `GET /prs/:id`; next submit in the same office/year gets the following number, never the cancelled one (US6-3, SC-007); cancelled PR cannot be deleted (FR-043)

### Implementation for User Story 6

- [ ] T131 [US6] Implement `cancel` in `apps/api/src/services/pr-workflow.service.ts` (lock PR + its budget lines, permission/creator checks per state — pending/returned: creator or `pr:cancel_approved`; approved: `pr:cancel_approved` only — `budget.service.release`, close open steps as `cancelled`, set fields, audit comment, notification) and `cancel` schema `{ expectedVersion, reason }` in `packages/shared/src/schemas/pr-actions.ts`
- [ ] T132 [US6] Add `POST /prs/:id/cancel` to `apps/api/src/routes/prs.routes.ts` and the cancel flag to `availableActions` in `apps/api/src/services/pr.service.ts`
- [ ] T133 [US6] Add Cancel action (reason dialog, extra warning for approved PRs and when cancelling another user's PR) to `apps/web/src/features/pr/actions-panel.tsx` and the edit page for `returned`; add `pr.cancel.*` strings to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US6 testable on its own on top of US4/US5.

---

## Phase 9: User Story 7 — Print the PR (Priority: P2)

**Goal**: Bilingual PDF matching the RTHA paper form with amount in words, signature blocks, and
status watermark.

**Independent Test**: Print the approved RTHA PR 0010 sample and compare it field by field with
sheet "PR" of `RTHA Procurement Forms _091811.xlsx` (contracts/print-layout.md checklist).

### Tests for User Story 7 ⚠️

- [ ] T134 [P] [US7] Tests `packages/shared/tests/amount-in-words.test.ts`: table-driven English and Arabic cases 0–1,000, 1/2 (dual)/3–10 (plural)/11–99 (singular accusative)/100s, thousands/millions/billions boundaries, fractional minor units (piastres/cents), "فقط … لا غير" framing, and `870710.00 SDG` in both languages (SC-006, research R14, Business Rule 12)
- [ ] T135 [P] [US7] Unit test `apps/api/tests/unit/pr-print.service.test.ts`: `PrPrintData` matches the shape in contracts/print-layout.md; watermark mapping (`draft|returned → DRAFT`, `pending_* → PENDING`, `rejected → REJECTED`, `cancelled → CANCELLED`, `approved → null`) (US7-2); `requestedBy` from requester snapshot, `financeCheck`/`finalApproval` from latest-cycle approve signatures with position at signing (US7-1); one `totals[]` entry per line currency with words in ar and en; `grantTotal` with rates when currencies differ; per-line donor short name, budget location, budget line code; for a non-draft PR, renaming the organization or an office, replacing the logo, or editing a budget line code after approval leaves `PrPrintData` unchanged (labels come from `print_snapshot`, Principle VI)

### Implementation for User Story 7

- [ ] T136 [US7] Spike (research R13): render a one-page Arabic PR with mixed Arabic/Latin text, `PR-MAD-2026-0010`, `10202` and amounts in `apps/web/src/features/pr/print/spike.tsx` with @react-pdf/renderer and the IBM Plex fonts; record pass/fail and screenshots in `specs/001-grants-pr-foundation/research.md` under R13; if it fails, switch T140 to server-side Playwright HTML→PDF in `apps/api/src/services/pr-pdf.service.ts` with the same `PrPrintData` contract
- [ ] T137 [P] [US7] Implement `packages/shared/src/amount-in-words/en.ts`, `ar.ts`, `index.ts` (`amountInWords(amount: string, currency: CurrencyNames, locale: 'ar'|'en')` using major/minor names from the `currency` table) until T134 passes
- [ ] T138 [P] [US7] Add `packages/shared/src/schemas/print.ts` with the `PrPrintData` Zod schema from contracts/print-layout.md
- [ ] T139 [US7] Implement `apps/api/src/services/pr-print.service.ts` (assemble `PrPrintData` from PR, lines, currency names, signatures, taking organization/header/line labels from `print_snapshot` when status ≠ `draft` and from live data for drafts; amounts via `amountInWords`) and `GET /prs/:id/print` in `apps/api/src/routes/prs.routes.ts`
- [ ] T140 [US7] Implement PDF templates in `apps/web/src/features/pr/print/`: `fonts.ts` (register IBM Plex Sans Arabic/IBM Plex Sans from `apps/web/src/fonts/`), `pr-document.tsx` (A4 portrait, 15 mm margins; zones header band, info grid, item table with repeating header row, totals with words in locale language and the other language beneath, three signature boxes with blank lines when empty, footer with number, printed `DD/MM/YYYY HH:mm`, page x / y; diagonal 40 % grey watermark), `styles.ts` with `ar` (RTL, mirrored columns, LTR runs for numbers/codes) and `en` variants per contracts/print-layout.md
- [ ] T141 [US7] Add `apps/web/src/features/pr/print/print-button.tsx` on the PR detail page (choose Arabic/English, fetch `/prs/:id/print`, render blob with `pdf()` and open/download) and `pr.print.*` strings to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US7 testable — approved PR prints in both languages; non-approved PRs carry watermarks.

---

## Phase 10: User Story 8 — Lists, search, notifications, history, and budget status (Priority: P2)

**Goal**: PR list with filters/search, "My tasks", in-app notifications, PR history timeline, and
a per-grant budget status report with drill-down and PDF/Excel export.

**Independent Test**: With several PRs in different states, confirm list filters, office scoping,
"My tasks", notifications, the timeline, and that report Committed equals the sum of approved,
non-cancelled PRs with drill-down listing them.

### Tests for User Story 8 ⚠️

- [ ] T142 [P] [US8] Integration test `apps/api/tests/integration/pr-list.int.test.ts`: filters `status[]`, `officeId`, `grantId`, `requesterId`, `dateFrom/dateTo`, `amountMin/amountMax` (grant currency), `q` by number and line description (trigram); pagination/sort; PR list p95 < 500 ms at seeded scale (FR-046)
- [ ] T143 [P] [US8] Extend `apps/api/tests/integration/rls-isolation.int.test.ts` with the office case: a Kosti-only user sees only Kosti PRs (plus their own) in `GET /prs` and gets `404` on Madani PR ids; an org-wide user sees all (US8-3, FR-018)
- [ ] T144 [P] [US8] Integration test `apps/api/tests/integration/my-tasks-notifications.int.test.ts`: PR moving to Pending Approval appears in the approver's `GET /prs/my-tasks` and creates a `pr_action_required` notification (US8-1); creator never sees their own PR in My tasks; requester gets `pr_approved|pr_rejected|pr_returned`; `unreadCount`, `POST /notifications/:id/read`, `read-all`; users never read others' notifications (FR-047, FR-048)
- [ ] T145 [P] [US8] Integration test `apps/api/tests/integration/pr-history.int.test.ts`: `GET /prs/:id/history` returns ordered entries `{ at, actor { name, position }, action, fromState, toState, comment, changes [{ field, from, to }] }` covering create, draft edits, submit, budget-line change, reassign, approve, return, resubmit, cancel (FR-044, SC-002); 20 autosaves containing one real line change write exactly one `pr_line` audit row, and a burst of draft edits within 10 minutes appears as a single timeline entry
- [ ] T146 [P] [US8] Integration test `apps/api/tests/integration/budget-report.int.test.ts`: per-line Committed = Σ approved non-cancelled PRs and Reserved = Σ pending PRs; drill-down `?status=committed|reserved` lists them with amounts (US8-2); `export.xlsx` has DD/MM/YYYY dates and numeric 2-dp cells; requires `budget:read`
- [ ] T147 [P] [US8] Performance test `apps/api/tests/integration/budget-report.perf.test.ts`: seed 5,000 PRs (~50k lines) on one tenant; `GET /reports/budget-status?grantId=` < 2 s (SC-004)

### Implementation for User Story 8

- [ ] T148 [P] [US8] Add Zod schemas `packages/shared/src/schemas/pr-list.ts` (list query filters + list item with number, status, dates, office, grant, requester, totals), `history.ts` (timeline entry), `report.ts` (budget status rows + grant totals + drill-down rows), `notification.ts` (list item with `kind`, `params`, `readAt`; `unreadCount`)
- [ ] T149 [US8] Implement list and My tasks in `apps/api/src/repositories/pr.repository.ts` (`list(filters)` using RLS + trigram `q`; `myTasks(userId)` = pending current steps where the user is eligible or assigned) and `apps/api/src/services/pr.service.ts`; routes `GET /prs`, `GET /prs/my-tasks` in `apps/api/src/routes/prs.routes.ts` (register `/prs/my-tasks` before `/prs/:id`)
- [ ] T150 [US8] Implement `apps/api/src/services/pr-history.service.ts` (merge `audit_history` for the PR and its children with `approval_action`, resolve actor names/positions, compute field changes; merge consecutive draft `update` entries by the same actor within 10 minutes into one entry with combined `changes[]`, per FR-044) and `GET /prs/:id/history` in `apps/api/src/routes/prs.routes.ts`
- [ ] T151 [P] [US8] Implement `apps/api/src/services/notification.service.ts` read side (`list(unread?)`, `unreadCount`, `markRead`, `markAllRead`) and `apps/api/src/routes/notifications.routes.ts`; mount in `apps/api/src/routes/index.ts`
- [ ] T152 [US8] Implement `apps/api/src/services/report.service.ts` (budget status from `budget_line_balance` + grant totals; drill-down from `budget_commitment` joined to PRs; Excel export with exceljs: localized headers, DD/MM/YYYY via shared formatter, numeric cells `#,##0.00`) and `apps/api/src/routes/reports.routes.ts` (`/reports/budget-status`, `/reports/budget-status/lines/:budgetLineId/prs`, `/reports/budget-status/export.xlsx`); mount in `apps/api/src/routes/index.ts`
- [ ] T153 [P] [US8] Build `apps/web/src/app/[locale]/(app)/prs/page.tsx` with `apps/web/src/features/pr/pr-list-table.tsx` (TanStack Table + Virtual, server-side pagination/sort) and `pr-list-filters.tsx` (status multi-select, office, grant, requester, DD/MM/YYYY range, amount range, search box; state in URL search params)
- [ ] T154 [P] [US8] Build `apps/web/src/app/[locale]/(app)/my-tasks/page.tsx` with `apps/web/src/features/pr/my-tasks-list.tsx` (step kind, PR number, amount, waiting since)
- [ ] T155 [P] [US8] Build `apps/web/src/features/notifications/notification-bell.tsx` (unread count polled every 30 s and on window focus, dropdown list rendered from `kind` + `params` via i18n, mark read / read all, link to PR) and add it to `apps/web/src/features/shell/app-nav.tsx`
- [ ] T156 [P] [US8] Build `apps/web/src/features/pr/history-timeline.tsx` (actor name/position, action, from → to state, comment, changed fields, `DD/MM/YYYY HH:mm`) and add it to `apps/web/src/app/[locale]/(app)/prs/[id]/page.tsx`
- [ ] T157 [US8] Build `apps/web/src/app/[locale]/(app)/reports/budget-status/page.tsx` with `apps/web/src/features/reports/budget-status-table.tsx` (grant picker, Budget/Reserved/Committed/Actual/Available/% used per line and totals), `drill-down-sheet.tsx` (reserving/committing PRs with links), `budget-status-pdf.tsx` (client-side react-pdf export reusing `apps/web/src/features/pr/print/fonts.ts`), and Excel download button
- [ ] T158 [US8] Add all US8 strings (`prList.*`, `myTasks.*`, `notifications.*` per kind, `history.*`, `reports.*`) to `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: All user stories independently functional.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Demo data, E2E acceptance, verification, and documentation

- [ ] T159 Implement `packages/database/scripts/seed-demo.ts` per quickstart.md: tenant RTHA (base SDG, DoA USD); offices MAD (Madani), KST (Kosti), GDF (Gadaref), PSD (Port Sudan); donor ADRA; USD grant operating in MAD with budget line `10202`; SDG→USD rate dated before the sample PR date; users `requester@`, `finance@`, `approver@`, `kosti-viewer@` (Kosti only), `admin@` with printed passwords; `document_sequence` MAD/2026 = 9 so the next PR is `PR-MAD-2026-0010`
- [ ] T160 Transcribe the 9 lines of sheet "PR" from `RTHA Procurement Forms _091811.xlsx` into `apps/web/e2e/fixtures/rtha-pr-0010.json` (header fields, descriptions, quantities, units, unit costs, budget line `10202`, donor ADRA, office Madani); assert the total is exactly `870710.00 SDG`
- [ ] T161 Write Playwright E2E `apps/web/e2e/rtha-pr-0010.spec.ts` running in `ar` and `en` projects: requester enters the fixture (closes and reopens tab mid-entry to verify autosave), submits → `PR-MAD-2026-0010` Pending Finance Check; finance approves from My tasks; approver approves → Approved; budget report shows Committed; print PDF text contains every field, three signatures, DD/MM/YYYY dates, and correct amount in words (SC-001, SC-005, SC-006)
- [ ] T162 [P] Add `apps/web/e2e/negative-checks.spec.ts` for quickstart "Negative checks": missing rate, budget reduction below usage, office code change, suspended grant flow, import with a bad row, PR date out of range, editing an in-use rate
- [ ] T163 [P] Add `apps/api/tests/unit/business-rules.index.test.ts` (or a README table in `apps/api/tests/unit/README.md`) mapping Business Rules 1–12 from `docs/specify1.md` (rule 4 as clarified by FR-036) and the five clarifications to the test files that prove them (Principle X)
- [ ] T164 Run the full quickstart validation (`pnpm lint && pnpm type-check`, all test suites, manual acceptance steps 1–8) and capture Arabic and English screenshots of PR form, PR detail, print, and budget report via Chrome DevTools MCP into `specs/001-grants-pr-foundation/screenshots/`
- [ ] T165 [P] Security pass: verify no secrets in repo (`git grep` for keys), service-role key used only in `apps/api/src/db/supabase.ts` admin calls, CORS origins from env, helmet enabled, signed URLs short-lived; document findings in `specs/001-grants-pr-foundation/checklists/security.md`
- [ ] T166 [P] Write root `README.md` (workspace layout, setup commands from quickstart, env vars, test commands, deployment to Vercel/Fly.io)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories (schema, RLS, shared libs, API/web skeletons)
- **US1, US2, US3 (Phases 3–5)**: depend only on Foundational; can run in parallel
- **US4 (Phase 6)**: depends on Foundational plus services from US1 (`numbering.service`, T057), US2 (`budget.service` commitment primitives T073, `exchange-rate.service` T074, grant selection), and US3 (`approval-routing.service` T089)
- **US5 (Phase 7)**: depends on US4 (`pr-workflow.service` submit, PR detail)
- **US6 (Phase 8)**: depends on US4; approved-PR cancel test also needs US5
- **US7 (Phase 9)**: depends on US4 (print data); signature blocks need US5; amount-in-words (T134, T137) can start right after Foundational
- **US8 (Phase 10)**: depends on US4 (PRs to list); My tasks/notification tests need US5; report drill-down uses US2 balances
- **Polish (Phase 11)**: depends on all stories

### User Story Dependency Graph

```text
Setup → Foundational ─┬─ US1 (org setup) ──────┐
                      ├─ US2 (funding) ────────┼─▶ US4 (create/submit) ─▶ US5 (approve) ─┬─▶ US6 (cancel)
                      └─ US3 (users/DoA) ──────┘                                         ├─▶ US7 (print)
                                                                                         └─▶ US8 (lists/report)
                                                                       ─────────────────────▶ Polish
```

### Within Each User Story

- Tests first; confirm they fail
- Shared Zod schemas → repositories → services → routes → web pages → i18n strings
- Story checkpoint before moving on

### Parallel Opportunities

- Setup: T002–T009, T011, T012 in parallel after T001
- Foundational: shared package T025–T030 in parallel with migrations T014–T022 (sequential among themselves); middleware T033, T034, T036 in parallel; web T043–T045 in parallel; tests T049, T050 in parallel
- After Foundational: US1, US2, US3 by three developers in parallel; amount-in-words (T134, T137) in parallel too
- Within stories: all test tasks marked [P]; schema/repository tasks marked [P]; web pages on different routes marked [P]
- After US5: US6, US7, US8 in parallel

---

## Parallel Example: User Story 4

```bash
# Tests first, together:
Task: "Unit test apps/api/tests/unit/pr-submit.service.test.ts"
Task: "Unit test apps/api/tests/unit/pr-submit-effects.test.ts"
Task: "Unit test apps/api/tests/unit/pr-draft.service.test.ts"
Task: "Integration test apps/api/tests/integration/budget-concurrency.int.test.ts"
Task: "Integration test apps/api/tests/integration/numbering.int.test.ts"
Task: "Integration test apps/api/tests/integration/pr-draft.int.test.ts"

# Then schemas and repositories together:
Task: "Zod schemas packages/shared/src/schemas/pr.ts"
Task: "Repositories apps/api/src/repositories/pr*.repository.ts, budget-commitment, notification"
```

## Parallel Example: User Stories 1–3 after Foundational

```bash
Developer A: T051–T064 (US1 organization setup)
Developer B: T065–T082 (US2 donors, grants, budget lines)
Developer C: T083–T094 (US3 users, roles, approval rules)
```

---

## Implementation Strategy

### MVP First

The spec marks US1–US5 all P1: a PR has no control value until it is approved and committed. The
MVP is therefore Phases 1–7.

1. Phase 1 Setup → Phase 2 Foundational (CRITICAL)
2. US1 + US2 + US3 (parallel) — validate each at its checkpoint
3. US4 — validate submit with number and reservation
4. US5 — **STOP and VALIDATE**: RTHA-like PR approved by two users, Reserved → Committed
5. Demo the MVP

### Incremental Delivery

1. MVP (US1–US5)
2. + US6 Cancel → validate commitment release
3. + US7 Print → validate against the paper form
4. + US8 Lists / My tasks / notifications / report → validate figures and performance
5. Polish: seed, E2E in ar/en, quickstart validation, screenshots

---

## Notes

- [P] tasks = different files, no dependency on incomplete tasks
- Several tasks extend the same file across stories (`apps/api/src/services/pr-workflow.service.ts`, `apps/api/src/routes/prs.routes.ts`, `apps/api/src/services/pr.service.ts`, `messages/*.json`) — they are deliberately not marked [P] with each other
- Commit after each task or logical group; per the constitution, commit to `001-grants-pr-foundation` after each `/speckit-implement` run
- Out-of-scope ideas (RFQ, PO, payments, email notifications, offline) go to a backlog note, not code
