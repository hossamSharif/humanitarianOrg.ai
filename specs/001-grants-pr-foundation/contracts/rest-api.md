# REST API Contract — `/api/v1`

**Feature**: `001-grants-pr-foundation` | Data model: [../data-model.md](../data-model.md)

Request/response bodies are defined once as Zod schemas in `packages/shared/src/schemas/` and
shared by API and web; this document is the human-readable contract.

## Conventions

- **Auth**: `Authorization: Bearer <Supabase access token>`. Tenant comes from the token's
  `app_metadata.tenant_id` (verified against `membership`); clients never send a tenant id.
- **Idempotency**: every `POST`, `PATCH`, `PUT`, `DELETE` accepts `Idempotency-Key: <uuid>`;
  a replay with the same key and body returns the stored response; same key with a different
  body → `409 IDEMPOTENCY_KEY_REUSED`.
- **Concurrency**: mutable resources expose `version`; updates and PR actions send
  `expectedVersion` and receive `409 VERSION_CONFLICT` if stale.
- **Money**: decimal strings with currency, `{ "amount": "870710.00", "currency": "SDG" }`.
- **Dates**: ISO `YYYY-MM-DD`; instants ISO 8601 UTC. Formatting to `DD/MM/YYYY` is the
  client's job (shared formatter).
- **Lists**: `?page=1&pageSize=50` (max 200), `?sort=field:asc|desc`; response
  `{ data: T[], page, pageSize, total }`.
- **Errors**: always `{ code, message, details? }` with HTTP status; `message` is English for
  logs, clients render i18n by `code`; `details` carries structured data (field errors,
  shortfalls).
- **Headers**: `X-Request-Id` echoed/generated; rate limit 300 req/min/user (writes 60/min).

### Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod failure; `details: [{ field, message }]` |
| 401 | `UNAUTHORIZED` | missing/invalid token |
| 403 | `FORBIDDEN` | missing permission, no tenant, no office access |
| 403 | `SEGREGATION_OF_DUTIES` | creator approving, or user signing a second step |
| 404 | `NOT_FOUND` | (also returned for other tenants' ids) |
| 409 | `VERSION_CONFLICT` / `IDEMPOTENCY_KEY_REUSED` / `INVALID_STATE` | stale version / key reuse / action not allowed in current status |
| 409 | `OFFICE_CODE_IN_USE` | changing a referenced office code |
| 422 | `BUDGET_EXCEEDED` | `details.lines: [{ budgetLineId, code, requested, available, shortfall, currency, prLineIds }]` |
| 422 | `BUDGET_BELOW_USAGE` | reducing a budget line below reserved + committed + actual; `details: { minimum }` |
| 422 | `GRANT_NOT_ACTIVE` | grant suspended/closed (selection or signing) |
| 422 | `GRANT_PERIOD_MISMATCH` | PR date outside grant dates |
| 422 | `PR_DATE_OUT_OF_RANGE` | PR date in the future or more than `maxBackdateDays` before submission; `details: { prDate, earliest, latest }` |
| 409 | `EXCHANGE_RATE_IN_USE` | editing or deleting a rate used by a PR; enter a corrected rate instead |
| 422 | `GRANT_OFFICE_MISMATCH` | requesting office not in grant offices |
| 422 | `EXCHANGE_RATE_MISSING` | `details: { currencies: ['USD'], date }` |
| 422 | `PR_EMPTY` | no lines or zero total |
| 422 | `REQUIRED_BY_BEFORE_PR_DATE` | |
| 422 | `NO_ELIGIBLE_APPROVER` | `details: { stepOrder, kind, roleId, roleName, ruleId }` |
| 422 | `APPROVAL_RULE_INVALID` | missing finance check, band gaps/overlaps |
| 422 | `IMPORT_INVALID_ROWS` | commit with zero valid rows |
| 429 | `RATE_LIMITED` | |
| 500 | `INTERNAL_ERROR` | |

---

## Session & organization

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/me` | auth | user, active membership, memberships list, permissions[], offices[], orgWideAccess |
| POST | `/session/tenant` | auth | `{ tenantId }` — must have active membership; sets `app_metadata.tenant_id`; client refreshes session |
| POST | `/tenants` | auth | create organization (bootstrap) → seeds defaults (data-model §8); caller becomes admin |
| GET / PATCH | `/tenant` | read: member / write: `settings:manage` | profile: names, logo, address, contact, baseCurrency, doaReferenceCurrency, fiscalYearStartMonth, timezone, maxBackdateDays |
| POST | `/tenant/logo-upload-url` | `settings:manage` | signed upload URL |

## Offices, units, numbering

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/offices` | member | `?active=true` |
| POST | `/offices` | `settings:manage` | `{ code, nameAr, nameEn, address?, phone? }` |
| PATCH | `/offices/:id` | `settings:manage` | code change → `409 OFFICE_CODE_IN_USE` if referenced |
| GET / POST / PATCH | `/units`, `/units/:id` | read: member / write: `settings:manage` | deactivate via `isActive=false` |
| GET / PUT | `/numbering/:docType` | `settings:manage` | `{ prefix, includeOffice, includeYear, padding, separator }`; response includes `preview` (e.g. `PR-MAD-2026-0001`) |

## Users, roles, approval rules

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/users` | `users:manage` | memberships with roles, offices |
| POST | `/users/invite` | `users:manage` | `{ email, fullNameAr, fullNameEn, positionTitle, officeIds[], roleIds[], orgWideAccess }` |
| PATCH | `/users/:membershipId` | `users:manage` | same fields + `status` (`active`/`suspended`) |
| GET | `/permissions` | `roles:manage` | catalogue |
| GET / POST / PATCH / DELETE | `/roles`, `/roles/:id` | `roles:manage` | `{ nameAr, nameEn, permissions[] }`; delete blocked while assigned or referenced by a rule |
| GET | `/approval-rules?docType=PR` | `settings:manage` | |
| PUT | `/approval-rules/:id` | `settings:manage` | full replace `{ officeId|null, name, isActive, steps: [{ stepOrder, kind, roleId, minAmount?, maxAmount? }] }` → `422 APPROVAL_RULE_INVALID` |
| POST | `/approval-rules` | `settings:manage` | create office-specific rule |
| POST | `/approval-rules/resolve` | `settings:manage` | `{ officeId, amount }` → resolved steps + eligible user counts (admin preview) |

## Donors, grants, budget lines, activities, rates

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST / PATCH | `/donors`, `/donors/:id` | read: member / write: `grants:manage` | |
| GET | `/grants` | member | `?status=&officeId=&selectableFor=pr&prDate=` (only active, covering date, operating in office) |
| POST / PATCH | `/grants`, `/grants/:id` | `grants:manage` | `{ donorId, code, name, currency, totalAmount, startDate, endDate, officeIds[] }` |
| GET | `/grants/:id` | member | includes `budgetLinesTotal`, `difference` (warning when ≠ 0), `pendingPrCount` |
| POST | `/grants/:id/status` | `grants:manage` | `{ status, expectedVersion, confirmPendingCount? }` — first call without confirmation returns `200 { requiresConfirmation: true, pendingPrCount }` when pending PRs exist |
| GET | `/grants/:id/budget-lines` | member | each with `budget, reserved, committed, actual, available, pctUsed` |
| POST / PATCH | `/grants/:id/budget-lines`, `/budget-lines/:id` | `grants:manage` | `{ code, description, category, budgetAmount, officeId? }`; reduce below usage → `422 BUDGET_BELOW_USAGE` |
| POST | `/grants/:id/budget-lines/import?mode=preview\|commit` | `grants:manage` | multipart `file` (.xlsx/.csv, ≤ 5 MB, columns `code, description, category, amount`); response `{ validRows: [...], invalidRows: [{ row, values, errors: [{ column, code }] }], created? }`; commit inserts all valid rows in one transaction |
| GET / POST / PATCH | `/grants/:id/activities`, `/activities/:id` | read: member / write: `grants:manage` | |
| GET | `/exchange-rates` | member | `?currency=&from=&to=` |
| GET | `/exchange-rates/lookup?currency=USD&date=2026-11-10` | member | latest on or before date (latest-entered wins on the same date), or `404` |
| POST / PATCH / DELETE | `/exchange-rates`, `/exchange-rates/:id` | `rates:manage` | `{ currency, rateToBase, rateDate, source }`; PATCH/DELETE of a rate used by a PR → `409 EXCHANGE_RATE_IN_USE`; each item returns `inUse` |

## Purchase requisitions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/prs` | `pr:read` | filters: `status[]`, `officeId`, `grantId`, `requesterId`, `dateFrom`, `dateTo`, `amountMin`, `amountMax` (grant currency), `q` (number or line description, trigram search); office-scoped by RLS |
| GET | `/prs/my-tasks` | auth | PRs whose current step the user is eligible for (or assigned to) |
| POST | `/prs` | `pr:create` | create draft `{ header?, lines? }` → `201 { id, version, status: 'draft' }` |
| GET | `/prs/:id` | `pr:read` | header, lines (with locked conversion fields), attachments, steps (with eligibility flags for the caller: `canApprove`, `canReject`, `canReturn`, `canChangeBudgetLine`), signatures, `availableActions[]` |
| PATCH | `/prs/:id` | creator, status `draft`/`returned` | full draft document `{ expectedVersion, header, lines[] }` (autosave) |
| DELETE | `/prs/:id` | creator, `draft` never submitted | hard delete |
| POST | `/prs/:id/attachments/upload-url` | creator, `draft`/`returned` | `{ fileName, mimeType, sizeBytes }` → `{ attachmentId, signedUrl }`; type/size/count validated |
| POST | `/prs/:id/attachments/:attId/complete` | creator | confirms upload |
| DELETE | `/prs/:id/attachments/:attId` | creator, `draft`/`returned` | soft delete |
| GET | `/prs/:id/attachments/:attId/url` | `pr:read` | short-lived signed download URL |
| POST | `/prs/:id/submit` | creator + `pr:create` | `{ expectedVersion }` → `200 { status, number, steps, reservations: [{ budgetLineId, amount }] }`; failures per error table (e.g. `BUDGET_EXCEEDED` with per-line shortfall) |
| POST | `/prs/:id/approve` | eligible for current step | `{ expectedVersion, stepId, comment? }` → new status; final step commits budget |
| POST | `/prs/:id/reject` | eligible for current step | `{ expectedVersion, stepId, reason }` |
| POST | `/prs/:id/return` | eligible for current step | `{ expectedVersion, stepId, reason }` |
| POST | `/prs/:id/lines/:lineId/budget-line` | eligible finance checker, status `pending_finance_check` | `{ expectedVersion, budgetLineId, comment? }` → recheck availability (excluding this PR's own reservation), move reservation |
| POST | `/prs/:id/cancel` | creator (before approval) or `pr:cancel_approved` (pending, returned, or approved) | `{ expectedVersion, reason }` |
| POST | `/prs/:id/steps/:stepId/reassign` | `pr:reassign` | `{ expectedVersion, userId, reason }` — target must be eligible |
| GET | `/prs/:id/history` | `pr:read` | timeline entries `{ at, actor: { name, position }, action, fromState, toState, comment, changes: [{ field, from, to }] }` |
| GET | `/prs/:id/print` | `pr:read` | print data for PDF ([print-layout.md](./print-layout.md)); includes `watermark`, amount in words (ar, en), signature blocks |

## Reports & notifications

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/budget-status?grantId=` | `budget:read` | per line `{ code, description, category, budget, reserved, committed, actual, available, pctUsed }` + grant totals; target < 2 s at 5,000 PRs |
| GET | `/reports/budget-status/lines/:budgetLineId/prs?status=reserved\|committed` | `budget:read` | drill-down list of PRs and amounts |
| GET | `/reports/budget-status/export.xlsx?grantId=&locale=` | `budget:read` | Excel (exceljs), DD/MM/YYYY dates, numeric cells with 2-dp format |
| GET | `/notifications` | auth | `?unread=true`; `{ data, unreadCount }` |
| POST | `/notifications/:id/read`, `/notifications/read-all` | auth | |

PDF export of the budget report is rendered client-side from the JSON report.

## Health

| GET | `/health` | none | `{ status: 'ok', version }` |
|---|---|---|---|
