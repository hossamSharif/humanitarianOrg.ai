# REST API Contract — `/api/v1` additions

**Feature**: `002-procurement-to-payment` | Data model: [../data-model.md](../data-model.md)

All conventions in the [001 contract](../../001-grants-pr-foundation/contracts/rest-api.md)
apply unchanged:

- Bearer auth, with the tenant taken from `app_metadata`.
- `Idempotency-Key` on every mutation.
- `expectedVersion` with `409 VERSION_CONFLICT`.
- Decimal strings for money.
- ISO dates.
- `{ data, page, pageSize, total }` lists.
- The `{ code, message, details? }` error shape.

Zod schemas live in `packages/shared/src/schemas/<module>.ts`. **Computed fields are never
accepted in request bodies.** Unknown keys are rejected by `.strict()`, so a client cannot send
`gross`, `net`, `supplierId` on a GRN, a price score, and so on.

All 001 endpoints, including `/prs/*` and `/prs/my-tasks`, keep their contract.

## Shared document actions

Every approvable type `X` exposes the same action set, implemented by
`document-workflow.service.ts`:

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/X/:id/submit` | `{ expectedVersion }` | number on first submit, route materialized, type-specific `onSubmit` |
| POST | `/X/:id/approve` | `{ expectedVersion, stepId, comment? }` | eligibility + segregation; final step runs `onApproved` |
| POST | `/X/:id/reject` | `{ expectedVersion, stepId, reason }` | |
| POST | `/X/:id/return` | `{ expectedVersion, stepId, reason }` | |
| POST | `/X/:id/cancel` | `{ expectedVersion, reason }` | releases exactly what the doc holds (BR-21) |
| POST | `/X/:id/steps/:stepId/reassign` | `{ expectedVersion, userId, reason }` | `<type>:reassign` or `settings:manage` |
| GET | `/X/:id/history` | — | 001 timeline shape |
| GET | `/X/:id/print` | `?locale=` | print data ([print-layout.md](./print-layout.md)) |
| GET | `/X/:id/trail` | — | alias of `/trail/:docType/:id` |
| POST | `/X/:id/attachments/upload-url`, `…/:attId/complete`, DELETE `…/:attId`, GET `…/:attId/url` | | generic `doc_attachment` (R31) |

`X` ∈ `bid-analyses`, `waivers`, `pos`, `contracts`, `amendments`, `payment-requests`,
`direct-payments`, `advances`, `settlements`, `vouchers`. GET detail responses include
`availableActions[]` and per-step `canApprove/canReject/canReturn` for the caller, as for PRs.

## New error codes

| HTTP | code | When |
|---|---|---|
| 422 | `PROCUREMENT_BANDS_INVALID` | `details: { gaps: [[min,max]], overlaps: [[min,max]] }` |
| 422 | `METHOD_BELOW_REQUIRED` | chosen method rank < required with no approved waiver; `details: { required, chosen, estimatedValue, currency }` |
| 422 | `CRITERIA_WEIGHTS_INVALID` | Σ ≠ 100 per stage; `details: { stage, total }` |
| 422 | `TOO_FEW_SUPPLIERS` | invited approved < minimum, or valid offers < minimum; `details: { required, actual }` |
| 422 | `SUPPLIER_NOT_ELIGIBLE` | not approved / blacklisted / vetting overdue / expired document; `details: { supplierId, reasons[] }` |
| 409 | `PR_LINE_ALREADY_SOURCING` | `details: { prLineIds, eventId }` |
| 422 | `MIXED_GRANTS` | PR lines of different grants or offices in one event |
| 422 | `SPLITTING_ACK_REQUIRED` | warning present but not acknowledged; `details: { prIds, total, bandMax }` |
| 409 | `SOURCING_NOT_OPENED` | price, terms, or scan before the opening |
| 409 | `DEADLINE_NOT_PASSED` | opening before the deadline (DB clock); `details: { deadline, now }` |
| 422 | `TOO_FEW_ATTENDEES` | < 2 (RFQ) / < 3 (tender) |
| 409 | `OFFER_LATE` | late bid on a tender, or a late RFQ offer not accepted |
| 409 | `OFFER_FROZEN` | edit after the opening record or analysis is signed |
| 403 | `DECLARATION_REQUIRED` | committee member without a COI declaration |
| 422 | `COMMITTEE_TOO_SMALL` | `details: { minimum, eligible }` |
| 422 | `JUSTIFICATION_REQUIRED` | recommendation ≠ highest score without justification + criterion |
| 422 | `SPLIT_AWARD_NOT_ALLOWED` | |
| 422 | `INHERITED_FIELD_MISMATCH` | DB backstop (BR-1/BR-2) |
| 422 | `MILESTONES_INVALID` | Σ pct ≠ 100 or Σ amount ≠ total |
| 409 | `PO_NOT_ACKNOWLEDGED` | GRN/SCC before acknowledgement |
| 422 | `OVER_RECEIPT` | `details: { poLineId, ordered, alreadyAccepted, tolerancePct, maxAcceptable }` |
| 422 | `OVER_CERTIFIED` | |
| 409 | `DUPLICATE_INVOICE` | same supplier invoice number |
| 422 | `MATCH_FAILED` | `details: { lines: [{ lineId, result, invoicedQty, acceptedQty, invoicedPrice, poPrice, tolerancePct }] }` |
| 422 | `PO_OVERPAID` | Σ requests > PO total (incl. amendments); `details: { total, requested, remaining }` |
| 422 | `ADVANCE_LIMIT_EXCEEDED` | |
| 422 | `PROCUREMENT_ONLY_CATEGORY` | direct payment in a procurement-only category |
| 422 | `ADVANCE_OVERDUE` | `details: { advanceIds, daysOverdue }` |
| 422 | `CURRENCY_MISMATCH` | payment currency ≠ money-account currency |
| 422 | `BUDGET_LINE_UNMAPPED` | `details: { budgetLineIds, codes }` |
| 422 | `VOUCHER_UNBALANCED` | `details: { baseDebit, baseCredit, difference }` |
| 422 | `RATE_CURRENCY_CONTRADICTION` | base-currency line with rate ≠ 1, or foreign line without its own rate |
| 409 | `PERIOD_CLOSED` | `details: { year, month }` |
| 409 | `VOUCHER_POSTED_IMMUTABLE` | |
| 422 | `RECEIVED_BY_REQUIRED` | posting cash/cheque without received-by and signed copy |
| 422 | `REASON_REQUIRED` | JV, period reopen, override, manual close |
| 422 | `ALLOCATION_NOT_100` / `RECONCILIATION_UNBALANCED` | |
| 403 | `SEGREGATION_OF_DUTIES` | extended; `details: { rule }` with rule ∈ `creator_approves`, `pr_creator_approves_award`, `same_user_two_steps`, `receiver_is_inspector`, `certifier_is_confirmer`, `receiver_approves_payment`, `preparer_approves_payment`, `voucher_three_people` |
| 422 | `BUDGET_EXCEEDED` | unchanged shape (001), now also raised by PO/amendment approval, posting, JV, settlement, allocation |

---

## Procurement configuration (US1)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / PUT | `/procurement-settings` | read `procurement:read` / write `procurement:configure` | tolerances, committee min (≥ 2), re-vetting months, guarantee days, advance overdue days, acknowledgement flag |
| GET / PUT | `/procurement-settings/method-bands` | same | full replace `{ bands: [{ method, minAmount?, maxAmount?, minQuotations }] }` → `PROCUREMENT_BANDS_INVALID` |
| GET / PUT | `/grants/:id/procurement-rules` | `procurement:configure` | same shape; empty = none |
| POST | `/procurement-settings/resolve-method` | `procurement:read` | `{ prLineIds[] }` → `{ estimatedValue, currency, requiredMethod, minQuotations, bandsUsed, splittingWarning? }` |
| GET / POST / PATCH | `/deduction-types`, `/payment-categories`, `/supplier-categories` | `procurement:configure` / `accounts:manage` (deductions) | |
| GET / PUT | `/approval-rules?docType=` | `settings:manage` | 001 endpoints; `docType` ∈ D1 DoA types |
| GET / PUT | `/numbering/:docType` | `settings:manage` | 001 endpoint; new doc types |

## Suppliers (US2)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/suppliers` | `suppliers:read` | `?status=&categoryId=&q=&compliance=eligible|flagged` |
| POST / PATCH | `/suppliers`, `/suppliers/:id` | `suppliers:manage` | response includes `duplicateWarnings[]` (FR-012) |
| POST | `/suppliers/:id/status` | `suppliers:manage` (approve requires `suppliers:vet`) | `{ status, reason?, expectedVersion }` |
| GET / POST | `/suppliers/:id/documents` | `suppliers:manage` | |
| POST | `/suppliers/:id/vettings` | `suppliers:vet` | insert-only |
| POST | `/pos/:id/rating` | `po:create` or `grn:create` | `{ onTime, quality, documentation, comment? }` |
| GET | `/suppliers/:id/history` | `suppliers:read` | invitations, offers, awards, POs, GRNs, payments |
| GET / POST / PATCH | `/staff-payees`, `/staff-payees/:id` | `payment:create` | |

## RFQs and tenders (US3, US4, US9)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/sourcing/pr-lines` | `rfq:create` | approved PR lines with `sourcingStatus = not_sourced`, `?grantId=&officeId=` |
| GET / POST | `/rfqs` | `procurement:read` / `rfq:create` | create `{ prLineIds[], title, ... }` → `MIXED_GRANTS`, `PR_LINE_ALREADY_SOURCING` |
| GET / PATCH | `/rfqs/:id` | read / `rfq:create` (draft) | lines (reword/group), criteria, invitations, chosen method, waiver link |
| POST | `/rfqs/:id/issue` | `rfq:issue` | `{ expectedVersion, splittingAcknowledgement?: { comment } }` → number assigned; guards per data model §4 |
| POST | `/rfqs/:id/offers` | `rfq:create` | receipt only `{ supplierId, receivedAt, receivedById }`; extra keys rejected |
| POST | `/rfqs/:id/open` | `rfq:open` | `{ expectedVersion, attendees: [{ userId? , externalName?, function }], acceptLate: [{ offerId, reason }] }` |
| PUT | `/rfqs/:id/offers/:offerId/terms` | `rfq:open` | after the opening: `{ currency, deliveryDays, validityDays, paymentTerms, essentialCompliance, linePrices: [{ sourcingLineId, unitPrice, quantity? }] }` |
| POST | `/rfqs/:id/offers/:offerId/scan-upload-url` | `rfq:open` | `409 SOURCING_NOT_OPENED` before the opening |
| POST | `/rfqs/:id/reissue` | `rfq:create` | `{ reason }` → new draft linked by `reissuedFromId`, lines moved |
| POST | `/rfqs/:id/cancel` | `rfq:create` | `{ reason }` → PR lines back to `not_sourced` |
| GET / POST / PATCH | `/tenders`, `/tenders/:id` | `tender:manage` | same as RFQ plus lots, publication, bid security terms |
| POST | `/tenders/:id/publications`, `/clarifications` | `tender:manage` | |
| POST | `/tenders/:id/bids` | `tender:manage` | receipt log `{ supplierId, receivedAt, receivedById, bidSecurityReceived }` |
| POST | `/tenders/:id/open` | `tender:open` | ≥ 3 attendees |
| PUT | `/tenders/:id/bids/:offerId/prices` | `tender:open` | during the session, before attendee signatures |
| POST | `/tenders/:id/opening/sign` | attendee | `doc_signature attend` |
| GET / POST / PATCH | `/tenders/:id/securities`, `/securities/:id` | `tender:manage` | return / forfeit (reason); cash deposits produce BRV/CPV drafts |
| POST | `/tenders/:id/retender` | `tender:manage` | new number, link kept, lines moved (US9-5) |

## Analysis and award (US5)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/bid-analyses` | `rfq:create` / `tender:manage` | `{ sourcingEventId }` after the opening (tender: record signed) |
| GET | `/bid-analyses/:id` | `procurement:read`; prices hidden for undeclared members (RLS) | comparison table, rates used, results, recommendation |
| PUT | `/bid-analyses/:id/committee` | `rfq:create` / `tender:manage` | members `[{ userId, function }]`, replacements |
| POST | `/bid-analyses/:id/declaration` | member | `{ hasConflict, conflictSupplierIds[], note? }` |
| PUT | `/bid-analyses/:id/scores` | member + `evaluation:score` | `{ scores: [{ offerId, criterionId, score }] }` (1–5); price never accepted |
| POST | `/bid-analyses/:id/disqualify` | `evaluation:score` | `{ offerId, reason }` |
| PUT | `/bid-analyses/:id/recommendation` | `rfq:create` / `tender:manage` | `{ offerId? , lines?: [{ sourcingLineId, offerId }], justification?, justificationCriterionIds? }` |
| POST | `/bid-analyses/:id/sign` | member + `evaluation:sign` | freezes results on the first signature |
| POST | `/bid-analyses/:id/notices` | `rfq:create` | unsuccessful supplier notices |
| — | shared actions | `award:approve` for steps | `/submit` once all members have signed; FR-030 budget check on the final approval |

## Waivers (US10)

`/waivers` CRUD (`waiver:create`) + shared actions (`waiver:approve`). Body:
`{ reasonCategory, justification, coveredDocType, coveredDocId }`.

## POs, contracts, amendments (US6, US8, US10)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/bid-analyses/:id/pos` | `po:create` | creates one draft per awarded supplier; `kind` from service type or explicit `contract` |
| GET / PATCH | `/pos/:id`, `/contracts/:id` | `procurement:read` / `po:create` (draft) | only non-inherited fields writable |
| PUT | `/contracts/:id/milestones`, `/contracts/:id/guarantees` | `po:create` | |
| POST | `/pos/:id/acknowledge` | `po:create` | `{ acknowledgedAt, acknowledgedByName, attachmentId }` |
| POST | `/pos/:id/close` | `po:close` | `{ reason }` → releases remaining commitment |
| GET | `/pos/:id/versions`, `/pos/:id/versions/:v` | `procurement:read` | frozen snapshots |
| POST | `/pos/:id/amendments` | `po:amend` | `{ reason, changes: { header?, lines?, milestones? } }` → draft `AMD` |
| — | shared actions on `/pos`, `/contracts`, `/amendments` | `po:approve` | approval runs D2 transitions; `BUDGET_EXCEEDED` with shortfall |
| POST | `/pos/:id/cancel` | `po:cancel` | |

## Receipt (US7, US8)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/pos/:id/grns` | `grn:create` | `{ receivedDate, deliveryNoteNo, supplierInvoiceNo?, shipmentType, lines: [{ poLineId, deliveredQty, acceptedQty, rejectedQty, rejectReason?, conditionRemarks?, isAsset }] }` |
| POST | `/grns/:id/sign` | `grn:create` (as `received`) / `grn:inspect` (as `inspected`) | `{ role: 'received' | 'inspected' }`; completion when both exist |
| POST | `/grns/:id/lines/:lineId/return` | `grn:create` | `{ returnedOn }` |
| POST | `/pos/:id/completion-certificates` | `grn:create` | `{ milestoneId? , poLineId?, completionPct, periodText }` |
| POST | `/completion-certificates/:id/sign` | `grn:inspect` | `{ role: 'certified' | 'confirmed' }` |

## Invoices and payment requests (US11, US15)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/pos/:id/invoices` | `invoice:register` | `{ supplierInvoiceNo, invoiceDate, currency, lines: [{ poLineId, quantity, unitPrice }], attachmentId }` → `DUPLICATE_INVOICE` |
| POST | `/pos/:id/payment-requests` | `payment:create` | `{ kind: 'order'|'retention', invoiceId?, isAdvance?, grnIds?, certificateIds?, paymentMethod, moneyAccountId, currency }` → computed draft incl. match |
| POST | `/payment-requests/:id/match-override` | `payment:override_match` | `{ reason }` |
| POST | `/direct-payments` | `payment:create` | `{ payeeType, supplierId?|staffPayeeId?|payeeName?, grantId, categoryId, periodText, paymentMethod, moneyAccountId, currency, lines: [{ budgetLineId, locationOfficeId, activityId?, description, amount }] }` |
| — | shared actions | `payment:check` (finance_check) / `payment:approve` | segregation `preparer_approves_payment`, `receiver_approves_payment` |
| POST | `/payment-requests/:id/voucher` | `voucher:create` | generates a BPV/CPV draft (pure generator) → `BUDGET_LINE_UNMAPPED`, `CURRENCY_MISMATCH` |

## Advances (US16)

`/advances` CRUD (`advance:request`) + shared actions (`advance:approve`) +
`POST /advances/:id/voucher` (`voucher:create`). `/settlements` (`advance:settle`) +
shared actions + `POST /settlements/:id/vouchers` (JV + CRV/BPV drafts).

## Accounting (US12–US14, US17, US18)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST / PATCH / DELETE | `/gl-accounts` | `finance:read` / `accounts:manage` | delete blocked when used → `409 ACCOUNT_IN_USE` |
| GET / PUT | `/gl-accounts/category-mapping`, `/control-accounts` | `accounts:manage` | |
| PATCH | `/budget-lines/:id/expense-account` | `accounts:manage` | |
| GET / POST / PATCH | `/bank-accounts`, `/cash-boxes` (both over `money_account`) | `bank:manage` | |
| GET / POST | `/periods` | `finance:read` / `periods:manage` | |
| POST | `/periods/:id/close` | `periods:manage` | `{ confirm? }` → first call returns `{ requiresConfirmation, unpostedApproved: [...] }` |
| POST | `/periods/:id/reopen` | `periods:manage` | `{ reason }` |
| GET / POST / PATCH | `/vouchers` | `finance:read` / `voucher:create` | manual JV, BRV/CRV, TRF; `lines[]` accept account, description, currency, debit/credit, dimensions; rates are looked up server-side, never sent |
| POST | `/vouchers/:id/check` | `voucher:check` | = approve on the `check` step (balance enforced) |
| POST | `/vouchers/:id/post` | `voucher:post` | `{ expectedVersion, receivedByName?, receivedOn?, receivedCopyAttachmentId? }` → Actual, consumption, request `paid` |
| POST | `/vouchers/:id/reverse` | `voucher:reverse` | `{ reason, reversalDate }` → reversing draft (mirrored lines, original rates) |
| POST | `/imports/:kind?mode=preview|commit` | `accounts:manage` | R32; multipart file |
| GET / POST / PUT | `/allocations`, `/allocations/:id/apply` | `allocation:manage` | `{ voucherLineId }` → JV draft |
| GET / POST | `/bank-reconciliations`, `/:id/lines`, `/:id/import`, `/:id/matches`, `/:id/sign-off`, `/:id/reopen` | `bank:reconcile` | |

## Reports, trail, tasks, notifications (US19, US21)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/budget-vs-actual?grantId=&periodFrom=&periodTo=` | `reports:read` | < 3 s (SC-005); `.xlsx` variant via `/export.xlsx` |
| GET | `/reports/donor?grantId=&periodFrom=&periodTo=` | `reports:read` | includes `ratesUsed[]` |
| GET | `/reports/procurement-register` | `reports:read` | |
| GET | `/reports/open-commitments`, `/supplier-history`, `/advances-outstanding`, `/grant-funding` | `reports:read` | |
| GET | `/reports/general-ledger`, `/account-statement`, `/trial-balance`, `/bank-book`, `/cash-book` | `reports:finance` | |
| GET | `/reports/*/export.xlsx` | same | DD/MM/YYYY, 2-dp numeric cells; filters grant, donor, office, period, dates, locale |
| GET | `/trail/:docType/:docId` | read on the starting doc | `{ nodes: [{ docType, id, number, status, date, amount, currency, depth, direction, signatures[], attachments[] }], edges[] }`; nodes the caller cannot read appear as `{ docType, number, restricted: true }` |
| GET | `/my-tasks` | auth | `{ groups: [{ docType, items: [{ id, number, action, dueAt?, amount }] }] }` |
| GET | `/notifications` | auth | 001 endpoint; new kinds carry `docType`, `docId` |
