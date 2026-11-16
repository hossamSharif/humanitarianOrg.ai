<!--
Sync Impact Report
- Version change: 1.1.0 → 1.2.0 (MINOR: new principle XI; expanded guidance in II, III, VII and
  Development Workflow)
- Modified principles:
  - II. Segregation of Duties and Approval Integrity (adds per-document-type segregation rules)
  - III. Fund Integrity (Available ≥ 0 covers every budget-holding document under concurrency)
  - VII. Document Linkage and Traceability (inherited fields immutable downstream; sealed prices)
- Added sections: Principle XI. Accounting Integrity; Development Workflow bullet "Regression gate"
- Removed sections: none
- Templates: plan/spec/tasks templates read the constitution at runtime; no template edits needed.
  specs/002-procurement-to-payment/plan.md already checks XI (marked "proposed"; now ratified).
- Follow-up TODOs:
  - Governance names I–V as strict and VI–X as deviable; XI is in neither list. The amendment
    input did not classify it — decide in a PATCH amendment (recommended: strict).
-->

# NGO Procurement & Grants Platform Constitution

## Purpose

A multi-tenant SaaS for humanitarian NGOs operating in Sudan that manages grants, budget lines,
and the full procurement cycle (PR → RFQ/Tender → PO → GRN → Payment) in a way that survives a
donor audit. Every rule below exists because donors can reject costs that cannot be proven
compliant.

## Core Principles

### I. Audit Trail Is Non-Negotiable

- Business records MUST NOT be hard-deleted once they leave Draft. Records are Cancelled or
  Voided, with a mandatory reason, user, and timestamp.
- Every state change, approval, rejection, return, and edit MUST be written to an append-only
  history (who, when, from-state, to-state, comment, changed fields).
- History MUST be readable by authorized users on every document as a timeline.
- Audit logging MUST be enforced at the database level (triggers), not only in the API.

**Rationale**: Donor auditors reject costs without a provable trail.

### II. Segregation of Duties and Approval Integrity

- The creator of a document MUST NOT approve it.
- One person MUST NOT perform two approval steps on the same document.
- Approval routes MUST be resolved from the organization's configured Delegation of Authority
  (DoA) matrix by document type, amount, and office — never hard-coded.
- Every approval is an electronic signature: user, position at the time of signing, timestamp,
  and optional comment, stored immutably.
- Approved documents MUST be locked. Changing them requires a formal amendment or cancellation
  flow, never a silent edit.
- Segregation rules MUST be defined per document type in one place, and include at least:
  - the creator of a PR MUST NOT approve the award;
  - the creator of any document MUST NOT approve it;
  - the receiver and the inspector of goods MUST be different people;
  - whoever received, inspected, or prepared a payment MUST NOT approve it;
  - a voucher MUST be entered, checked, and approved by three different people;
  - committee members MUST sign a conflict-of-interest declaration before scoring.

**Rationale**: Separation of duties is the first control auditors test.

### III. Fund Integrity

- Every financial line (PR line, PO line, payment line) MUST carry grant, donor budget line,
  and location. Activity is optional but supported.
- A budget line tracks Budget, Reserved, Committed, Actual, and Available
  (Available = Budget − Reserved − Committed − Actual). Reserved is a pre-approval hold and
  Committed an approved obligation; both are commitments. All values except Budget MUST be
  derived, never typed.
- The system MUST block any action that would make Available negative on a line, unless an
  explicit, permissioned, logged override exists for that action.
- The Available ≥ 0 guarantee MUST cover every document that holds or consumes budget (PRs, POs,
  contracts, amendments, direct payments, advances, journals) and MUST hold under concurrent
  actions.
- Funds are restricted: a line of one grant MUST NOT be charged for another grant.
- Donor budget line codes MUST be stored as the donor's own text code (e.g. `10202`, `2.2.31`);
  the system MUST NOT force a single numeric format.

**Rationale**: NGO accounting answers "was each donor's money spent as agreed", not "did we
make profit".

### IV. Tenant Isolation and Security

- Every tenant-owned table MUST have `tenant_id` and Row-Level Security enabled from its first
  migration.
- Tenant identity in RLS MUST come only from server-controlled data: Supabase `app_metadata` or
  a `memberships` table. Never from `user_metadata`, which users can edit.
- One RLS pattern is defined once (helper SQL function) and reused by every policy. No table
  may invent its own pattern.
- Permissions use `resource:action` strings (e.g. `pr:create`, `pr:approve`) and MUST be
  enforced in the API; the UI only hides what the API already forbids.
- Secrets, keys, and tokens MUST NOT appear in the repository — including docs folders. All
  configuration comes from environment variables, documented in `.env.example`.

**Rationale**: Multi-tenant NGO financial data leaking across organizations would end the
product.

### V. Arabic-First, Bilingual, Correct Formats

- Arabic and English are first-class; Arabic is RTL and MUST be fully usable. UI strings MUST
  NOT be hard-coded.
- Dates MUST be stored as ISO (`YYYY-MM-DD` / timestamptz) and always displayed as
  `DD/MM/YYYY`, regardless of browser locale.
- Money MUST be stored as fixed-point decimal (`numeric`), never floating point. Rounding rules
  are explicit per currency.
- Every amount MUST carry its currency. Any amount converted between currencies stores the
  exchange rate, rate date, and rate source used at that moment.
- Printed amounts MUST include amount-in-words, generated automatically in Arabic and English,
  never typed by users.

**Rationale**: The real paper forms analyzed contained corrupted dates (DD/MM read as MM/DD)
and wrong amounts in words.

### VI. Configuration Over Hard-Coding

- Procurement thresholds, DoA matrix, document numbering formats, units of measure, approval
  steps, and budget code formats MUST be tenant configuration.
- Defaults are seeded for a new tenant but MUST always be editable by its admin.
- Configuration changes MUST themselves be audited (Principle I) and MUST NOT retroactively
  alter approved documents.

**Rationale**: Every NGO and every donor sets different rules.

### VII. Document Linkage and Traceability

- Each downstream document MUST be created from its upstream document and inherit its data
  (items, grant, budget line, location). Users never retype it.
- Every document MUST store a reference to its source (PR → RFQ → PO → GRN → Payment) and be
  navigable in both directions.
- Downstream documents MUST inherit supplier, grant, budget line, donor, and location from their
  source; these fields MUST NOT be changeable downstream.
- Quotation and bid prices MUST NOT be readable by anyone before the opening is recorded.
- Document numbers MUST be unique per tenant, generated server-side by sequence, per document
  type, office, and year (format configurable).

**Rationale**: Broken links between forms were the most common error found in real samples.

### VIII. Official Printable Documents

- Every approvable document MUST have a PDF print layout matching the organization's official
  form: logo, header fields, item table, totals, and signature blocks filled from electronic
  approvals.
- Printouts MUST show document number, print date, and status (e.g. a "DRAFT" or "CANCELLED"
  watermark when not approved).

**Rationale**: Field offices and donors still file signed paper.

### IX. Consistent Architecture

- Monorepo (pnpm + Turborepo): `apps/web`, `apps/api`, `packages/shared`, `packages/database`,
  `packages/ui`.
- The API follows routes → services → repositories. Business rules MUST live in services only;
  routes only validate and delegate.
- Validation schemas (Zod) and types MUST live in `packages/shared` and be used by both API and
  web.
- All mutating endpoints MUST accept an `Idempotency-Key` to make retries safe.
- Errors MUST use one shape: `{ code, message, details? }`.

**Rationale**: A single, predictable structure keeps business rules in one testable place and
lets web and API share one source of truth for validation.

### X. Business Rules Are Tested

- Every business rule in a spec (budget check, segregation of duties, state transitions,
  numbering) MUST have an automated test at the service level.
- Each module MUST have at least one end-to-end acceptance test built from real sample data
  (e.g. RTHA PR 0010).

**Rationale**: The controls in Principles I–III are only credible to an auditor if they are
proven to hold on every change.

### XI. Accounting Integrity

- Every voucher MUST balance in the base currency before it can be checked, and this MUST be
  enforced by a database constraint, not only by the UI or API.
- Posted vouchers and their lines MUST be immutable. Corrections MUST be made only by a linked
  reversal voucher followed by a new voucher.
- Posting into a closed accounting period MUST be blocked. Reopening a period MUST require a
  dedicated permission and a reason, and MUST be audited.
- Every voucher line in a currency other than the base currency MUST store its own exchange rate,
  rate date, and source. A currency label that contradicts its rate is invalid.
- Budget-line Actual MUST be derived only from posted voucher lines. It is never typed or edited.
- Expense recognition MUST follow the organization's configured basis (cash basis by default).

**Rationale**: Donor audits rely on a ledger that cannot be silently changed. The real vouchers
analyzed contained a USD label with a 1.0000 rate on an SDG amount and an amount in words that
did not match the figure.

## Development Workflow

- **Database**: all schema changes, migrations, and type generation go through Supabase MCP
  tools (`apply_migration`, `list_tables`, `generate_typescript_types`) when configured,
  otherwise through the Supabase CLI (`supabase db push`, `supabase gen types`). Migrations are
  always kept as SQL files in `packages/database/migrations`.
- **Documentation lookup**: use Ref MCP for library and framework docs.
- **UI verification**: use Chrome DevTools MCP for browser testing and screenshots when it is
  connected, otherwise Playwright screenshots, in both Arabic (RTL) and English.
- **Commits**: commit all changes to the active feature branch after each completed
  `/speckit.implement` run, with a descriptive message. If a commit fails, halt and ask for
  human attention.
- **Regression gate**: refactors of existing tables MUST keep all earlier features' tests green;
  a feature's first implementation phase MUST end with a regression gate.
- **Scope**: implement only what the current spec defines. Out-of-scope ideas go into a backlog
  note, not into code.

## Governance

- This constitution supersedes other practices. Amendments require: rationale, owner approval,
  a migration plan for existing code, and a semantic version bump.
- Versioning: MAJOR for removing or redefining a principle; MINOR for adding a principle or
  section or materially expanding guidance; PATCH for clarifications and wording fixes.
- Principles I–V (audit, segregation, funds, security, formats) are strict: deviation is never
  permitted.
- Principles VI–X may be deviated from only with a written justification in the plan's
  Complexity Tracking section.
- Every plan MUST include a Constitution Check against all principles.

**Version**: 1.2.0 | **Ratified**: 2026-11-14 | **Last Amended**: 2026-11-16
