# Feature 001: Organization Setup, Grants & Budget Lines, and Purchase Requisitions

> Input for `/speckit.specify`. Paste this whole file as the argument.
> It describes WHAT and WHY only. Technology belongs in `/speckit.plan`.

## Context

Humanitarian NGOs in Sudan receive grants from donors (e.g. ADRA, Practical
Action) and spend them through procurement. Today they use Excel forms: a
Purchase Requisition (PR), RFQ, Quotation Analysis, Purchase Order, GRN, and
Payment Request. Real samples from one NGO (RTHA) showed broken links between
forms, mismatched amounts, corrupted dates, and manual budget checks.

This feature delivers the foundation (organization, offices, donors, grants,
budget lines, users, roles, approval rules) and the first procurement document:
the **Purchase Requisition**, including budget checking, approvals with
electronic signatures, and budget commitment.

Later features (out of scope here): RFQ, quotation analysis, tenders, PO, GRN,
payments, accounting vouchers, supplier registry, offline mode.

## Users and Roles

| Role | What they do in this feature |
|---|---|
| Organization Admin | Sets up the organization, offices, donors, grants, budget lines, users, roles, approval rules, numbering |
| Requester (usually Logistics Officer) | Creates and submits PRs |
| Finance Checker (Finance Assistant/Manager) | Verifies budget availability and coding on PRs |
| Approver (Program/Area Manager, Country Director) | Gives final approval within their authority limit |
| Viewer / Auditor | Read-only access to documents, history, and budget status |

A user can hold several roles. Users are assigned to one or more offices and
see only data for their offices unless granted organization-wide access.

## User Stories

### US1 — Organization setup (P1)

As an Organization Admin, I set up my organization so that procurement can run
on its real structure.

- Organization profile: name (Arabic and English), logo, address, contact,
  base currency (default SDG), fiscal year start.
- Offices / locations (e.g. Madani, Kosti, Gadaref, Port Sudan) with name in
  both languages, short code (used in document numbers), address, phone.
- Units of measure list (PCs, PAK, Person, Day, Kg, Liter…) seeded with
  defaults and editable.
- Document numbering per document type: prefix, whether it includes office
  code and year, and padding. Default PR format: `PR-{OFFICE}-{YYYY}-{0000}`.
  Sequence resets each year per office.

**Acceptance**
- Given a new organization, when the admin completes setup, then offices,
  units, and numbering are available for PRs.
- Given an office code is used by existing documents, when the admin tries to
  change it, then the system blocks the change and explains why.

### US2 — Donors, grants, and budget lines (P1)

As an Organization Admin or Finance user, I register donors, grants, and their
budget lines so every purchase can be charged correctly.

- Donor: name, short name, contact, notes.
- Grant (project): name, code, donor, grant currency (e.g. USD, EUR, SDG),
  total amount, start and end date, offices where it operates, status
  (Active, Suspended, Closed).
- Budget line: belongs to one grant; donor's line code stored as free text
  (e.g. `10202`, `2.2.31`), description, category (e.g. Supplies, Services,
  Staff, Equipment, Running costs), budget amount in grant currency, optional
  office/location.
- Activities (optional, per grant): name and code, e.g. "Training of
  Community Based Protection Networks".
- Budget lines can be imported from a spreadsheet (code, description,
  category, amount).
- For each budget line the system shows: Budget, Committed, Actual, Available.
  Actual stays 0 in this feature (filled by the future Payments feature).
- Exchange rates: Finance enters manual rates (currency, rate to base
  currency, date, source note). The latest rate on or before a document's
  date is used.

**Acceptance**
- Given a grant with currency USD and a budget line of 10,000 USD, when a PR in
  SDG is approved, then the commitment is converted to USD using the stored
  rate, and the rate, date, and source are saved on the PR.
- Given a grant is Closed or Suspended, when a user creates a PR, then that
  grant cannot be selected.
- Given a PR date is outside the grant start/end dates, then submission is
  blocked.
- The total of budget lines may differ from the grant total; the system shows
  the difference as a warning, not an error.

### US3 — Users, roles, and approval rules (P1)

As an Organization Admin, I invite users, assign roles and offices, and
configure who approves what.

- Invite users by email; set name (Arabic/English), position title, offices,
  roles.
- Roles are permission sets (`pr:create`, `pr:finance_check`, `pr:approve`,
  `grants:manage`, `settings:manage`, `audit:read`…). Default roles are
  seeded and editable.
- Approval rules (Delegation of Authority) for PRs: an ordered list of steps.
  Default: Step 1 Finance Check, Step 2 Final Approval.
  Each step defines the role required and, for Final Approval, amount ranges
  mapping to roles (e.g. up to 5,000 USD-equivalent → Program Area Manager;
  above → Country Director). Rules can be per office or organization-wide.
- Position title is captured on each signature as it was at signing time.

**Acceptance**
- Given DoA ranges are configured, when a PR of 7,000 USD-equivalent is
  submitted, then Final Approval is routed to the role configured for that range.
- Given no approver exists for a required step, then submission is blocked with
  a message telling the admin which rule is missing.

### US4 — Create and submit a Purchase Requisition (P1)

As a Requester, I create a PR for goods or services and submit it for approval.

**Header**: PR number (auto), PR date, requesting office, grant, deliver-to
office/location, delivery address, contact name and phone, required-by date,
activity (optional), purpose/comments, type (Goods / Services / Mixed).

**Lines**: line number, description, specifications (optional long text), quantity,
unit, estimated unit cost, estimated total (calculated), currency (defaults to
base currency), budget line (from the selected grant), location, activity
(optional). Lines in the same PR may use different budget lines of the same grant.

**Attachments**: any files (specs, photos, price references).

- Draft PRs autosave and can be edited or deleted by their creator.
- On submit, the system checks each budget line: total of this PR's lines on
  that budget line (converted to grant currency) ≤ Available. If not, the PR
  cannot be submitted and the failing lines are highlighted with the shortfall.
- On submit, the PR receives its permanent number and becomes read-only for
  the requester.
- Required-by date must be on or after the PR date.

**Acceptance**
- Given a draft PR with 9 lines on budget line 10202, when submitted with
  enough budget, then it moves to "Pending Finance Check" and gets number
  `PR-MAD-2026-0010` (per numbering config).
- Given one line exceeds Available, then submission is blocked and that line
  shows the shortfall amount.

### US5 — Review, approve, reject, or return (P1)

As a Finance Checker or Approver, I act on PRs assigned to me.

- Each step can: Approve (sign), Reject (final, reason required), or Return for
  revision (reason required; back to the requester as editable; approvals
  restart from step 1 on resubmission).
- Finance Check confirms budget coding and availability; the checker may change
  a line's budget line (logged), then the availability check reruns.
- Final Approval: on approve, the PR becomes Approved and the commitment is
  recorded on each budget line.
- Segregation: the requester cannot act on any step of their own PR; one user
  cannot sign two steps of the same PR.
- Availability is rechecked at each step; if budget became insufficient, the
  step cannot be approved.

**States**
`Draft → Pending Finance Check → Pending Approval → Approved`
plus `Returned` (→ back to editable), `Rejected` (final), `Cancelled` (final).

**Acceptance**
- Given a PR Pending Approval, when the approver approves, then status is
  Approved, the signature (name, position, timestamp) is stored, and the
  budget line Committed increases by the PR total in grant currency.
- Given a user who created the PR, when they open it, then approval actions are
  not available to them even if they hold the approver role.

### US6 — Cancel an approved or pending PR (P2)

- The requester can cancel their PR before final approval (reason required).
- An approved PR can be cancelled only by a user with `pr:cancel_approved`,
  with a reason; the commitment is released from the budget lines.
- Cancelled PRs remain visible with their full history.

### US7 — Print the PR (P2)

- PDF layout follows the NGO's paper form: logo and organization name, PR
  number, dates, project/grant, deliver-to, contact, item table with donor,
  budget location and donor budget line per line, total, and three signature
  blocks (Requested By, Finance Check, Final Approval) filled with name,
  position, and date from the electronic approvals.
- Not-yet-approved PRs print with a "DRAFT" / "PENDING" watermark; cancelled
  ones with "CANCELLED".
- Arabic and English print versions.

### US8 — Lists, search, notifications, and budget status (P2)

- PR list with filters: status, office, grant, requester, date range, amount;
  search by number or item description.
- "My tasks" view: PRs waiting for my action.
- In-app notifications when a PR needs my action, or when my PR is approved,
  rejected, or returned.
- PR detail shows a history timeline (Principle I).
- Budget status report per grant: each budget line with Budget, Committed,
  Actual, Available, and % used; drill down to the PRs committing it.
  Exportable to PDF and Excel.

## Business Rules (testable)

1. A PR can only be charged to Active grants whose dates cover the PR date.
2. Every PR line has exactly one budget line, belonging to the PR's grant.
3. Submission and every approval step require PR lines total per budget line
   (in grant currency) ≤ that line's Available amount.
4. Commitment is recorded only at final approval and released on cancellation.
5. The creator of a PR cannot perform any approval step on it.
6. A user cannot sign more than one step of the same PR.
7. Approved PRs cannot be edited.
8. PRs leaving Draft can never be deleted.
9. PR numbers are unique per organization, sequential per office and year, and
   never reused (including after cancellation).
10. All dates display as DD/MM/YYYY in both languages.
11. Every currency conversion stores rate, rate date, and source.
12. Totals and amounts in words are calculated, never typed.

## Edge Cases

- Exchange rate missing for the PR currency on the PR date → submission
  blocked with a message to Finance.
- Two PRs submitted at the same time compete for the last available budget →
  only the one fitting the budget succeeds; the other gets a clear error.
- A user's role or position changes after signing → old signatures keep the
  name and position at signing time.
- A budget line is reduced below its committed amount → the change is blocked.
- Approver is unavailable → admin can reassign the pending step to another user
  holding the required role (logged).
- A PR with zero lines or zero total cannot be submitted.

## Success Criteria

- A requester can create and submit a 10-line PR in under 5 minutes.
- 100% of approved PRs have complete signature data and history.
- 0 PRs can be approved that exceed Available budget (verified by tests).
- Budget status for any grant loads in under 2 seconds with 5,000 PRs.
- The full RTHA sample (PR 0010, 9 lines, budget line 10202, ADRA, Madani,
  total 870,710 SDG) can be entered, approved, and printed matching the paper
  form.

## Clarifications Needed

1. Should budget be reserved (soft commitment) already at submission, or only
   at final approval? [NEEDS CLARIFICATION: current assumption is final approval]
2. Should Finance Check be skippable for low-value PRs below a threshold?
   [NEEDS CLARIFICATION: current assumption is never skippable]
3. Can one PR be charged to more than one grant? [NEEDS CLARIFICATION:
   current assumption is one grant per PR, multiple budget lines allowed]

## Out of Scope

RFQ, quotation analysis, tenders and committees, purchase orders, GRN,
payments, accounting vouchers and chart of accounts, supplier registry, item
catalog, payroll, offline mode, subscriptions/billing, mobile app.