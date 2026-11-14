# NGO Procurement & Grants Platform — Constitution

> Input for `/speckit.constitution`. Paste this whole file as the argument.
> Product name is a placeholder; replace "NGO Platform" when the brand is decided.

## Purpose

A multi-tenant SaaS for humanitarian NGOs operating in Sudan that manages grants,
budget lines, and the full procurement cycle (PR → RFQ/Tender → PO → GRN → Payment)
in a way that survives a donor audit. Every rule below exists because donors can
reject costs that cannot be proven compliant.

## Core Principles

### I. Audit Trail Is Non-Negotiable

- No business record is ever hard-deleted once it leaves Draft. Records are
  Cancelled or Voided, with a mandatory reason, user, and timestamp.
- Every state change, approval, rejection, return, and edit is written to an
  append-only history (who, when, from-state, to-state, comment, changed fields).
- History is readable by authorized users on every document as a timeline.
- Audit logging is enforced at the database level (triggers), not only in the API.

**Rationale**: Donor auditors reject costs without a provable trail.

### II. Segregation of Duties and Approval Integrity

- The creator of a document can never approve it.
- One person cannot perform two approval steps on the same document.
- Approval routes are resolved from the organization's configured Delegation of
  Authority (DoA) matrix by document type, amount, and office — never hard-coded.
- Every approval is an electronic signature: user, position at the time of
  signing, timestamp, and optional comment, stored immutably.
- Approved documents are locked. Changing them requires a formal amendment or
  cancellation flow, never a silent edit.

**Rationale**: Separation of duties is the first control auditors test.

### III. Fund Integrity

- Every financial line (PR line, PO line, payment line) MUST carry: grant,
  donor budget line, and location. Activity is optional but supported.
- A budget line has four tracked values: Budget, Committed, Actual, Available
  (Available = Budget − Committed − Actual). These are derived, never typed.
- The system blocks any action that would make Available negative on a line,
  unless an explicit, permissioned, logged override exists for that action.
- Funds are restricted: a line of one grant can never be charged for another grant.
- Donor budget line codes are stored as the donor's own text code (e.g. `10202`,
  `2.2.31`); the system never forces a single numeric format.

**Rationale**: NGO accounting answers "was each donor's money spent as agreed",
not "did we make profit".

### IV. Tenant Isolation and Security

- Every tenant-owned table has `tenant_id` and Row-Level Security enabled from
  its first migration.
- Tenant identity in RLS comes ONLY from server-controlled data: Supabase
  `app_metadata` or a `memberships` table. Never from `user_metadata`, which
  users can edit.
- One RLS pattern is defined once (helper SQL function) and reused by every
  policy. No table may invent its own pattern.
- Permissions use `resource:action` strings (e.g. `pr:create`, `pr:approve`)
  and are enforced in the API; the UI only hides what the API already forbids.
- No secrets, keys, or tokens in the repository — including docs folders.
  All configuration via environment variables, documented in `.env.example`.

**Rationale**: Multi-tenant NGO financial data leaking across organizations
would end the product.

### V. Arabic-First, Bilingual, Correct Formats

- Arabic and English are first-class; Arabic is RTL and must be fully usable.
  No hard-coded UI strings.
- Dates are stored as ISO (`YYYY-MM-DD` / timestamptz) and always displayed as
  `DD/MM/YYYY`, regardless of browser locale.
- Money is stored as fixed-point decimal (`numeric`), never floating point.
  Rounding rules are explicit per currency.
- Every amount carries its currency. Any amount converted between currencies
  stores the exchange rate, rate date, and rate source used at that moment.
- Printed amounts include amount-in-words, generated automatically in Arabic
  and English. Never typed by users.

**Rationale**: The real paper forms analyzed contained corrupted dates
(DD/MM read as MM/DD) and wrong amounts in words.

### VI. Configuration Over Hard-Coding

- Procurement thresholds, DoA matrix, document numbering formats, units of
  measure, approval steps, and budget code formats are tenant configuration.
- Defaults are seeded for a new tenant but always editable by its admin.
- Configuration changes are themselves audited (Principle I) and never
  retroactively alter approved documents.

**Rationale**: Every NGO and every donor sets different rules.

### VII. Document Linkage and Traceability

- Each downstream document is created FROM its upstream document and inherits
  its data (items, grant, budget line, location). Users never retype it.
- Every document stores a reference to its source (PR → RFQ → PO → GRN →
  Payment) and is navigable in both directions.
- Document numbers are unique per tenant, generated server-side by sequence,
  per document type, office, and year (format configurable).

**Rationale**: Broken links between forms were the most common error found in
real samples.

### VIII. Official Printable Documents

- Every approvable document has a PDF print layout matching the organization's
  official form: logo, header fields, item table, totals, and signature blocks
  filled from electronic approvals.
- Printouts show document number, print date, and status (e.g. "DRAFT" or
  "CANCELLED" watermark when not approved).

**Rationale**: Field offices and donors still file signed paper.

### IX. Consistent Architecture

- Monorepo (pnpm + Turborepo): `apps/web`, `apps/api`, `packages/shared`,
  `packages/database`, `packages/ui`.
- API follows routes → services → repositories. Business rules live in
  services only; routes only validate and delegate.
- Validation schemas (Zod) and types live in `packages/shared` and are used by
  both API and web.
- All mutating endpoints accept an `Idempotency-Key` to make retries safe.
- Errors use one shape: `{ code, message, details? }`.

### X. Business Rules Are Tested

- Every business rule in a spec (budget check, segregation of duties, state
  transitions, numbering) has an automated test at the service level.
- Each module has at least one end-to-end acceptance test built from real
  sample data (e.g. RTHA PR 0010).

## Development Workflow

- **Database**: all schema changes, migrations, and type generation through
  Supabase MCP tools (`apply_migration`, `list_tables`,
  `generate_typescript_types`). Migrations are also kept as SQL files in
  `packages/database/migrations`.
- **Documentation lookup**: use Ref MCP for library and framework docs.
- **UI verification**: use Chrome DevTools MCP for browser testing and
  screenshots in both Arabic (RTL) and English.
- **Commits**: commit all changes to the active feature branch after each
  completed `/speckit.implement` run, with a descriptive message. If a commit
  fails, halt and ask for human attention.
- **Scope**: implement only what the current spec defines. Out-of-scope ideas
  go into a backlog note, not into code.

## Governance

- This constitution supersedes other practices. Amendments require: rationale,
  owner approval, migration plan for existing code, and a semantic version bump.
- Principles I–V (audit, segregation, funds, security, formats) are strict:
  deviation is never permitted.
- Other principles may be deviated from only with a written justification in
  the plan's Complexity Tracking section.
- Every plan MUST include a Constitution Check against all principles.

**Version**: 1.0.0