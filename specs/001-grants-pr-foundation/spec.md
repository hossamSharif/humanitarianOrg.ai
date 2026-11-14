# Feature Specification: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

**Feature Branch**: `001-grants-pr-foundation`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Feature 001 — Organization Setup, Grants & Budget Lines, and Purchase
Requisitions (see `docs/specify1.md`): the foundation (organization, offices, donors, grants,
budget lines, users, roles, approval rules) and the first procurement document, the Purchase
Requisition, including budget checking, approvals with electronic signatures, and budget
commitment."

## Context

Humanitarian NGOs in Sudan receive grants from donors (e.g. ADRA, Practical Action) and spend
them through procurement. Today they use Excel forms (PR, RFQ, Quotation Analysis, PO, GRN,
Payment Request). Real samples from one NGO (RTHA) showed broken links between forms, mismatched
amounts, corrupted dates, and manual budget checks. This feature replaces the paper/Excel
Purchase Requisition with a controlled, auditable workflow on top of the organization's real
structure and funding.

### Roles in this feature

| Role | What they do in this feature |
|------|------------------------------|
| Organization Admin | Sets up organization, offices, donors, grants, budget lines, users, roles, approval rules, numbering |
| Requester (usually Logistics Officer) | Creates and submits PRs |
| Finance Checker (Finance Assistant/Manager) | Verifies budget availability and coding on PRs |
| Approver (Program/Area Manager, Country Director) | Gives final approval within their authority limit |
| Viewer / Auditor | Read-only access to documents, history, and budget status |

A user can hold several roles. Users are assigned to one or more offices and see only data for
their offices unless granted organization-wide access.

## Clarifications

### Session 2026-11-14

- Q: Should a PR's budget be held (soft commitment) at submission or only at final approval? → A: Hold at submission as Reserved; converts to Committed at final approval; released on return, reject, or cancel.
- Q: Can one PR be charged to more than one grant? → A: No; exactly one grant per PR, lines may use different budget lines of that grant; multi-grant needs separate PRs.
- Q: Can low-value PRs skip Finance Check? → A: No; Finance Check is mandatory for every PR regardless of amount.
- Q: What happens to pending PRs when their grant is Suspended or Closed? → A: They freeze: no step can be signed until the grant is Active again; reservations stay held; return, reject, and cancel remain available; admins see the affected-PR count when changing status.
- Q: If rates change between submission and approval, which rate applies? → A: Rate (latest on or before PR date) is locked at submission and reused through approval; refreshed only on resubmission after Return.
- Q: After a Return, can a user who signed a step in an earlier cycle sign again? → A: Yes, but only the same step; they cannot sign a different step of that PR in any cycle, and never two steps in one cycle.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organization setup (Priority: P1)

An Organization Admin sets up the organization so procurement runs on its real structure:
organization profile (name in Arabic and English, logo, address, contact, base currency —
default SDG — and fiscal year start); offices/locations (e.g. Madani, Kosti, Gadaref, Port Sudan)
with bilingual name, short code, address, and phone; a units-of-measure list (PCs, PAK, Person,
Day, Kg, Liter…) seeded with defaults and editable; and document numbering per document type
(prefix, whether office code and year are included, padding). The default PR format is
`PR-{OFFICE}-{YYYY}-{0000}`, with the sequence resetting each year per office.

**Why this priority**: Nothing else can be created until the organization, offices, units, and
numbering exist.

**Independent Test**: Create a new organization, complete setup, and confirm offices, units,
and PR numbering are available when starting a PR.

**Acceptance Scenarios**:

1. **Given** a new organization, **When** the admin completes setup, **Then** offices, units,
   and numbering are available for PRs.
2. **Given** an office code is used by existing documents, **When** the admin tries to change
   it, **Then** the system blocks the change and explains why.
3. **Given** a new organization, **When** it is created, **Then** default units of measure,
   default roles, default PR numbering, and default PR approval steps are seeded and editable.

---

### User Story 2 - Donors, grants, and budget lines (Priority: P1)

An Organization Admin or Finance user registers donors, grants, and their budget lines so every
purchase can be charged correctly.

- **Donor**: name, short name, contact, notes.
- **Grant (project)**: name, code, donor, grant currency (e.g. USD, EUR, SDG), total amount,
  start and end date, offices where it operates, status (Active, Suspended, Closed).
- **Budget line**: belongs to one grant; donor's line code stored as free text (e.g. `10202`,
  `2.2.31`), description, category (Supplies, Services, Staff, Equipment, Running costs), budget
  amount in grant currency, optional office/location.
- **Activities** (optional, per grant): name and code, e.g. "Training of Community Based
  Protection Networks".
- Budget lines can be imported from a spreadsheet (code, description, category, amount).
- Each budget line shows Budget, Reserved, Committed, Actual, Available. Reserved is held by
  submitted, not-yet-approved PRs; Actual stays 0 in this feature.
- **Exchange rates**: Finance enters manual rates (currency, rate to base currency, date, source
  note). The latest rate on or before a document's date is used.

**Why this priority**: Every PR line must be charged to a grant budget line; without funding
structure there is nothing to check budget against.

**Independent Test**: Register a donor, a USD grant, budget lines (manually and by import), and
an exchange rate; confirm budget figures display correctly and the grant is selectable on a PR.

**Acceptance Scenarios**:

1. **Given** a grant in USD with a budget line of 10,000 USD, **When** a PR in SDG is approved,
   **Then** the commitment is converted to USD using the stored rate, and the rate, rate date,
   and source are saved on the PR.
2. **Given** a grant is Closed or Suspended, **When** a user creates a PR, **Then** that grant
   cannot be selected.
3. **Given** a PR date outside the grant start/end dates, **When** the requester submits,
   **Then** submission is blocked.
4. **Given** budget lines whose total differs from the grant total, **When** the grant is
   viewed, **Then** the difference is shown as a warning, not an error.
5. **Given** a spreadsheet with code, description, category, and amount columns, **When** it is
   imported, **Then** valid rows become budget lines and invalid rows are reported with the
   reason, without creating partial bad data.
6. **Given** a budget line with Reserved + Committed of 4,000, **When** a user tries to reduce
   its budget to 3,000, **Then** the change is blocked.

---

### User Story 3 - Users, roles, and approval rules (Priority: P1)

An Organization Admin invites users, assigns roles and offices, and configures who approves
what.

- Invite users by email; set name (Arabic/English), position title, offices, roles.
- Roles are permission sets (`pr:create`, `pr:finance_check`, `pr:approve`, `pr:cancel_approved`,
  `grants:manage`, `settings:manage`, `audit:read`…). Default roles are seeded and editable.
- Approval rules (Delegation of Authority) for PRs: an ordered list of steps. Default: Step 1
  Finance Check, Step 2 Final Approval. Each step defines the required role; Final Approval maps
  amount ranges (in a reference currency equivalent) to roles (e.g. up to 5,000 USD-equivalent →
  Program Area Manager; above → Country Director). Rules can be per office or
  organization-wide.
- Position title is captured on each signature as it was at signing time.

**Why this priority**: Segregation of duties and DoA routing are required before any PR can be
approved.

**Independent Test**: Invite users with different roles, configure DoA ranges, submit PRs of
different amounts, and confirm each is routed to the correct role.

**Acceptance Scenarios**:

1. **Given** DoA ranges are configured, **When** a PR of 7,000 USD-equivalent is submitted,
   **Then** Final Approval is routed to the role configured for that range.
2. **Given** no eligible approver exists for a required step, **When** a PR is submitted,
   **Then** submission is blocked with a message naming the missing rule or role.
3. **Given** an office-specific rule and an organization-wide rule both exist, **When** a PR for
   that office is submitted, **Then** the office-specific rule applies.

---

### User Story 4 - Create and submit a Purchase Requisition (Priority: P1)

A Requester creates a PR for goods or services and submits it for approval.

- **Header**: PR number (auto), PR date, requesting office, grant, deliver-to office/location,
  delivery address, contact name and phone, required-by date, activity (optional),
  purpose/comments, type (Goods / Services / Mixed).
- **Lines**: line number, description, specifications (optional long text), quantity, unit,
  estimated unit cost, estimated total (calculated), currency (defaults to base currency), budget
  line (from the selected grant), location, activity (optional). Lines may use different budget
  lines of the same grant.
- **Attachments**: any files (specs, photos, price references).
- Drafts autosave and can be edited or deleted by their creator.
- On submit, each budget line is checked: this PR's lines on that budget line (converted to
  grant currency) ≤ Available. Otherwise the PR cannot be submitted and failing lines are
  highlighted with the shortfall. If the check passes, the amount is Reserved on each budget
  line, reducing Available immediately.
- On submit, the PR receives its permanent number and becomes read-only for the requester.

**Why this priority**: The PR is the first procurement document and the core value of the
feature.

**Independent Test**: With a seeded organization, grant, budget line, and rate, a requester
creates a multi-line PR, submits it, and receives a number and "Pending Finance Check" status.

**Acceptance Scenarios**:

1. **Given** a draft PR with 9 lines on budget line 10202 and enough budget, **When** it is
   submitted, **Then** it moves to "Pending Finance Check" and gets number `PR-MAD-2026-0010`
   (per numbering configuration).
2. **Given** one budget line's PR total exceeds Available, **When** the requester submits,
   **Then** submission is blocked and the affected lines show the shortfall amount.
3. **Given** a required-by date earlier than the PR date, **When** the requester submits,
   **Then** submission is blocked.
4. **Given** a PR with zero lines or a zero total, **When** the requester submits, **Then**
   submission is blocked.
5. **Given** no exchange rate on or before the PR date for a line's currency, **When** the
   requester submits, **Then** submission is blocked with a message to contact Finance.

---

### User Story 5 - Review, approve, reject, or return (Priority: P1)

A Finance Checker or Approver acts on PRs assigned to them. Each step can Approve (sign), Reject
(final, reason required), or Return for revision (reason required; the PR goes back to the
requester as editable and approvals restart from step 1 on resubmission). Finance Check confirms
budget coding and availability; the checker may change a line's budget line (logged), after
which availability is rechecked and the reservation moves to the new budget line. On Final
Approval the PR becomes Approved and its Reserved amount becomes Committed on each budget line.
Return, Reject, or Cancel releases the reservation.

**States**: `Draft → Pending Finance Check → Pending Approval → Approved`, plus `Returned`
(editable again), `Rejected` (final), `Cancelled` (final).

**Why this priority**: Without approval and commitment, PRs have no control value.

**Independent Test**: Take a submitted PR through Finance Check and Final Approval with two
different users and confirm signatures, status, and budget commitment.

**Acceptance Scenarios**:

1. **Given** a PR Pending Approval, **When** the approver approves, **Then** status is Approved,
   the signature (name, position, timestamp) is stored, and the PR total in grant currency
   moves from Reserved to Committed on each budget line (Available is unchanged).
2. **Given** a user who created the PR, **When** they open it, **Then** approval actions are not
   available to them even if they hold the approver role.
3. **Given** a user who signed Finance Check, **When** they open the same PR at Final Approval,
   **Then** they cannot sign it.
4. **Given** the Finance Checker moves a line to a budget line without enough Available,
   **When** they approve, **Then** the approval is blocked with the shortfall shown.
5. **Given** a PR is returned with a reason, **When** the requester edits and resubmits it,
   **Then** it keeps its number and approvals restart from Finance Check.
6. **Given** a pending step whose approver is unavailable, **When** the admin reassigns it to
   another user holding the required role, **Then** the reassignment is recorded in history.
7. **Given** a submitted PR holding a reservation, **When** it is returned or rejected, **Then**
   its Reserved amount is released and Available increases accordingly; on resubmission it is
   reserved again after a fresh budget check.

---

### User Story 6 - Cancel a PR (Priority: P2)

The requester can cancel their own PR before final approval (reason required); any reservation
it holds is released. An approved PR can be cancelled only by a user with `pr:cancel_approved`,
with a reason; its commitment is released from the budget lines. Cancelled PRs remain visible with full history.

**Why this priority**: Needed for real operations but not for the first approved PR.

**Independent Test**: Cancel an approved PR and confirm Committed decreases by its amount and
the PR remains visible as Cancelled.

**Acceptance Scenarios**:

1. **Given** an approved PR, **When** a user with `pr:cancel_approved` cancels it with a reason,
   **Then** status is Cancelled and the commitment is released.
2. **Given** an approved PR, **When** a user without `pr:cancel_approved` tries to cancel it,
   **Then** the action is not available.
3. **Given** a cancelled PR, **When** a new PR is submitted in the same office and year, **Then**
   the cancelled PR's number is not reused.

---

### User Story 7 - Print the PR (Priority: P2)

The PR prints as a PDF matching the NGO's paper form: logo and organization name, PR number,
dates, project/grant, deliver-to, contact, item table with donor, budget location and donor
budget line per line, total and total in words, and three signature blocks (Requested By,
Finance Check, Final Approval) filled with name, position, and date from the electronic
approvals. Arabic and English print versions are available.

**Why this priority**: Field offices and donors file signed paper, but printing is not needed to
operate the workflow.

**Independent Test**: Print the RTHA PR 0010 sample after approval and compare it field by field
with the paper form.

**Acceptance Scenarios**:

1. **Given** an approved PR, **When** it is printed, **Then** all three signature blocks show
   name, position at signing, and date, and the total in words is generated automatically.
2. **Given** a PR that is not yet approved, **When** it is printed, **Then** it carries a
   "DRAFT" or "PENDING" watermark; a cancelled PR carries "CANCELLED".
3. **Given** any PR, **When** printed in Arabic, **Then** the layout is right-to-left and dates
   appear as DD/MM/YYYY.

---

### User Story 8 - Lists, search, notifications, and budget status (Priority: P2)

Users find and track PRs and budget usage: a PR list filtered by status, office, grant,
requester, date range, and amount, with search by number or item description; a "My tasks" view
of PRs waiting for the user's action; in-app notifications when a PR needs the user's action or
when the user's PR is approved, rejected, or returned; a history timeline on every PR; and a
budget status report per grant showing each budget line's Budget, Reserved, Committed, Actual,
Available, and % used, with drill-down to the reserving and committing PRs, exportable to PDF and Excel.

**Why this priority**: Improves daily efficiency and oversight once the core workflow exists.

**Independent Test**: With several PRs in different states, confirm filters, "My tasks",
notifications, and the budget status report figures.

**Acceptance Scenarios**:

1. **Given** a PR moves to Pending Approval, **When** the assigned approver opens "My tasks",
   **Then** the PR appears there and they have an in-app notification.
2. **Given** a grant with approved PRs, **When** the budget status report is opened, **Then**
   each line's Committed equals the sum of its approved, non-cancelled PRs, and drill-down lists
   them.
3. **Given** a user assigned only to Kosti, **When** they open the PR list, **Then** they see
   only Kosti PRs unless they have organization-wide access.

---

### Edge Cases

- Exchange rate missing for a PR currency on the PR date → submission blocked with a message to
  Finance.
- Two PRs are submitted for the last available budget at the same moment → only the one that
  fits is submitted and reserves the budget; the other gets a clear error showing the shortfall.
- A PR's reservation is held until it is approved, returned, rejected, or cancelled; there is no
  automatic expiry in this feature.
- A user's role or position changes after signing → existing signatures keep the name and
  position at signing time.
- A budget line is reduced below its Reserved + Committed + Actual → the change is blocked.
- Approver unavailable → admin reassigns the pending step to another user holding the required
  role (logged).
- A PR with zero lines or zero total cannot be submitted.
- A grant is suspended or closed while one of its PRs is pending → the PR is frozen: no step can
  be signed until the grant is Active again, its reservation stays held, and it can still be
  returned, rejected, or cancelled (which releases the reservation). When changing the grant's
  status, the admin is warned with the number of pending PRs affected.
- A grant's dates are changed so they no longer cover a pending PR's date → approval is blocked
  (Business Rule 1 is rechecked at each step).
- A deleted draft never consumed a number, so deleting drafts creates no gaps in PR numbering.
- An office code used by existing documents cannot be changed.
- Finance enters a new or corrected exchange rate after a PR is submitted → the pending PR keeps
  its locked rate and amounts; the new rate applies only if the PR is returned and resubmitted.

## Requirements *(mandatory)*

### Functional Requirements

**Organization & configuration**

- **FR-001**: System MUST let an Organization Admin maintain an organization profile: name
  (Arabic and English), logo, address, contact, base currency (default SDG), fiscal year start.
- **FR-002**: System MUST let admins maintain offices/locations with bilingual name, unique short
  code, address, and phone, and MUST block changing a code already used by documents.
- **FR-003**: System MUST provide an editable units-of-measure list, seeded with defaults.
- **FR-004**: System MUST let admins configure document numbering per document type (prefix,
  include office code, include year, padding), defaulting PRs to `PR-{OFFICE}-{YYYY}-{0000}` with
  a sequence per office per year.
- **FR-005**: All configuration changes MUST be recorded in history and MUST NOT alter documents
  already submitted or approved.
- **FR-006**: Each organization's data MUST be completely isolated from every other
  organization's.

**Donors, grants, budget lines, rates**

- **FR-007**: System MUST let authorized users maintain donors (name, short name, contact,
  notes).
- **FR-008**: System MUST let authorized users maintain grants (name, code, donor, currency,
  total amount, start/end date, operating offices, status Active/Suspended/Closed).
- **FR-009**: System MUST let authorized users maintain budget lines per grant with the donor's
  free-text code, description, category, budget amount in grant currency, and optional
  office/location; codes MUST be stored exactly as entered.
- **FR-010**: System MUST let authorized users import budget lines from a spreadsheet (code,
  description, category, amount), reporting invalid rows with reasons.
- **FR-011**: System MUST let authorized users maintain optional activities (name, code) per
  grant.
- **FR-012**: System MUST show for each budget line Budget, Reserved, Committed, Actual, and
  Available, where Available = Budget − Reserved − Committed − Actual, all calculated and never
  typed; Reserved is the sum of submitted, not-yet-approved PRs; Actual is 0 in this feature.
- **FR-013**: System MUST warn (not block) when the sum of a grant's budget lines differs from
  the grant total, showing the difference.
- **FR-014**: System MUST block reducing a budget line's amount below its Reserved + Committed +
  Actual.
- **FR-015**: System MUST let Finance record manual exchange rates (currency, rate to base
  currency, date, source note) and MUST use the latest rate on or before a document's date.

**Users, roles, approval rules**

- **FR-016**: System MUST let admins invite users by email and set bilingual name, position
  title, offices, and roles; a user may hold multiple roles and offices.
- **FR-017**: System MUST provide roles as editable permission sets, seeded with default roles
  (Organization Admin, Requester, Finance Checker, Approver, Viewer/Auditor).
- **FR-018**: System MUST restrict users to data of their assigned offices unless granted
  organization-wide access.
- **FR-019**: System MUST let admins configure PR approval rules as ordered steps, each with a
  required role; Final Approval MUST support amount ranges (in a configured reference-currency
  equivalent) mapped to roles; rules MAY be office-specific or organization-wide, with
  office-specific rules taking precedence.
- **FR-020**: System MUST block submission when no eligible user exists for a required step and
  name the missing rule or role.

**Purchase requisitions**

- **FR-021**: Requesters MUST be able to create PRs with the header, lines, and attachments
  listed in User Story 4; line totals and PR total MUST be calculated.
- **FR-022**: Only Active grants whose start/end dates cover the PR date MUST be selectable and
  accepted at submission and at every approval step. Pending PRs of a Suspended or Closed grant
  MUST keep their reservations and MUST remain returnable, rejectable, and cancellable, but no
  approval step may be signed; changing a grant's status MUST warn with the count of pending PRs
  affected.
- **FR-023**: A PR MUST be charged to exactly one grant, selected in the header; every PR line
  MUST have exactly one budget line belonging to that grant, and lines MAY use different budget
  lines of it. Charging several grants requires separate PRs.
- **FR-024**: Drafts MUST autosave and MUST be editable and deletable only by their creator;
  drafts do not consume a PR number.
- **FR-025**: On submission, the system MUST validate: at least one line and a non-zero total;
  required-by date ≥ PR date; grant validity (FR-022); an exchange rate available for every
  line currency; and, per budget line, PR total converted to grant currency ≤ Available. Failing
  lines MUST be highlighted with the shortfall.
- **FR-026**: On first submission, the PR MUST receive its permanent number, which is unique per
  organization, sequential per office and year, and never reused, including after
  cancellation.
- **FR-027**: After submission the PR MUST be read-only for the requester unless returned.
- **FR-028**: Every currency conversion MUST store the rate, rate date, and rate source used.
  Conversion rates MUST be locked at submission (latest rate on or before the PR date) and reused
  unchanged for the reservation, every approval step, the DoA amount, and the final commitment;
  they are refreshed only when a returned PR is resubmitted. Rates entered later MUST NOT change
  a submitted PR's converted amounts.

**Approvals**

- **FR-029**: On submission, the system MUST route the PR through the configured steps, resolving
  Final Approval by amount and office per FR-019.
- **FR-030**: At each step, an eligible user MUST be able to Approve (electronic signature),
  Reject (final, reason required), or Return (reason required).
- **FR-031**: Each signature MUST store the user, their position title at signing, timestamp,
  and optional comment, and MUST never change afterward.
- **FR-032**: The PR creator MUST NOT perform any approval step on it, regardless of roles held;
  a user MUST NOT sign more than one step of the same PR. After a Return, a user who signed a
  step in an earlier cycle MAY sign that same step again, but MUST NOT sign a different step of
  that PR.
- **FR-033**: The Finance Checker MUST be able to change a line's budget line (within the same
  grant), which is logged and triggers an availability recheck.
- **FR-034**: Grant validity MUST be rechecked at each step, and availability MUST be rechecked
  whenever a line's budget line changes (FR-033), excluding the PR's own reservation; a step MUST
  NOT be approved if a check fails.
- **FR-035**: Finance Check MUST apply to every PR regardless of amount and MUST NOT be skippable;
  approval-rule configuration MUST NOT allow removing the Finance Check step for PRs.
- **FR-036**: On successful submission, the PR total per budget line (in grant currency) MUST be
  Reserved on that budget line; at Final Approval the reservation MUST convert to Committed; on
  Return, Reject, or Cancel before approval the reservation MUST be released; cancelling an
  approved PR MUST release its commitment.
- **FR-037**: When two actions (e.g. simultaneous submissions or budget-line changes) compete for
  the same remaining budget, the system MUST ensure Available never becomes negative; only
  actions that fit succeed and others receive a clear error.
- **FR-038**: A returned PR MUST become editable by the requester, keep its number, release its
  reservation, and restart approvals from step 1 on resubmission (with a fresh budget check and
  reservation).
- **FR-039**: Admins MUST be able to reassign a pending step to another user holding the required
  role, recorded in history.
- **FR-040**: Approved PRs MUST NOT be editable.

**Cancellation**

- **FR-041**: Requesters MUST be able to cancel their own PR before final approval with a reason.
- **FR-042**: Only users with `pr:cancel_approved` MUST be able to cancel an approved PR, with a
  reason; the commitment MUST be released.
- **FR-043**: PRs that have left Draft MUST never be deleted; Cancelled and Rejected PRs remain
  visible with full history.

**History, printing, lists, notifications, reports**

- **FR-044**: Every state change, approval, rejection, return, reassignment, and edit MUST be
  recorded (who, when, from-state, to-state, comment, changed fields) and shown as a timeline on
  the PR to authorized users. Consecutive draft edits by the same user within 10 minutes MAY be
  shown as one timeline entry; the underlying history keeps every change.
- **FR-045**: System MUST produce a printable PDF of a PR per User Story 7, in Arabic and English,
  with automatically generated total in words and status watermarks for non-approved PRs.
- **FR-046**: System MUST provide a PR list with filters (status, office, grant, requester, date
  range, amount) and search by number or item description.
- **FR-047**: System MUST provide a "My tasks" view of PRs awaiting the current user's action.
- **FR-048**: System MUST send in-app notifications when a PR needs the user's action and when
  the user's PR is approved, rejected, or returned.
- **FR-049**: System MUST provide a budget status report per grant (Budget, Committed, Actual,
  Available, % used per line) with drill-down to committing PRs, exportable to PDF and Excel.

**Language & formats**

- **FR-050**: All screens and printouts MUST be available in Arabic (right-to-left) and English.
- **FR-051**: All dates MUST display as DD/MM/YYYY in both languages regardless of device locale.
- **FR-052**: Every amount MUST carry its currency; amounts MUST be exact decimal values with
  explicit per-currency rounding.

### Key Entities *(include if feature involves data)*

- **Organization**: The tenant NGO; bilingual name, logo, contact, base currency, fiscal year
  start. Owns all other data.
- **Office / Location**: A site of the organization with a unique short code used in document
  numbers.
- **User / Membership**: A person invited to the organization with bilingual name, position
  title, assigned offices, roles, and optional organization-wide access.
- **Role / Permission**: A named, editable set of `resource:action` permissions.
- **Approval Rule (DoA)**: Ordered steps for a document type, each requiring a role; Final
  Approval has amount ranges mapped to roles; scoped to an office or organization-wide.
- **Numbering Configuration**: Per document type format and per office/year sequence.
- **Unit of Measure**: Editable list of units for PR lines.
- **Donor**: Funding organization.
- **Grant**: Funding agreement with a donor; currency, total, dates, offices, status.
- **Budget Line**: Donor-coded line of a grant with budget amount and derived Reserved,
  Committed, Actual, Available.
- **Activity**: Optional program activity within a grant.
- **Exchange Rate**: Manually entered rate of a currency to the base currency on a date, with
  source.
- **Purchase Requisition**: Header, state, number, grant, office, dates, purpose, type; has
  lines, attachments, signatures, and history.
- **PR Line**: Item description, specs, quantity, unit, unit cost, total, currency, budget line,
  location, activity, and the conversion (rate, date, source) to grant currency.
- **Signature / Approval Record**: Immutable record of an approval step: user, position at
  signing, timestamp, comment.
- **Budget Commitment**: Amount held on a budget line by a PR, with status Reserved (submitted,
  pending approval) or Committed (approved); released on return, rejection, or cancellation.
- **History Entry**: Append-only record of every change on a document or configuration.
- **Notification**: In-app message to a user about a PR needing action or a status change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A requester can create and submit a 10-line PR in under 5 minutes.
- **SC-002**: 100% of approved PRs have complete signature data (name, position at signing,
  date) for every step and a complete history.
- **SC-003**: 0 PRs can be submitted or approved that exceed Available budget, including under
  simultaneous submissions competing for the same budget line; Available is never negative.
- **SC-004**: The budget status report for any grant appears in under 2 seconds for an
  organization with 5,000 PRs.
- **SC-005**: The full RTHA sample (PR 0010, 9 lines, budget line 10202, ADRA, Madani, total
  870,710 SDG) can be entered, approved, and printed so that every field matches the paper form.
- **SC-006**: 100% of printed and displayed dates use DD/MM/YYYY, and 100% of totals in words
  match the numeric total, in both languages.
- **SC-007**: 0 PR numbers are duplicated or reused within an organization.

## Assumptions

- Each organization is a separate tenant; users belong to one or more organizations and act
  within one at a time.
- Users have internet access; offline mode is out of scope.
- The DoA reference currency for amount ranges is USD-equivalent by default, configurable per
  organization; the PR amount is converted using the rate rules of FR-015.
- Different lines of one PR may use different currencies; each line is converted to the grant
  currency independently.
- A deleted draft does not consume a number; numbers are assigned at first submission.
- A rejected PR is final; a new PR must be created to request the same items.
- Returned PRs can be cancelled by the requester.
- Attachments accept common document and image formats with a reasonable per-file size limit
  (to be set during planning).
- Actual amounts stay 0 until the future Payments feature.
- Email delivery of notifications is out of scope; notifications are in-app only.
- Out of scope: RFQ, quotation analysis, tenders and committees, purchase orders, GRN, payments,
  accounting vouchers and chart of accounts, supplier registry, item catalog, payroll, offline
  mode, subscriptions/billing, mobile app.
