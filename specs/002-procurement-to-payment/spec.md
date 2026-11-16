# Feature Specification: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

**Feature Branch**: `002-procurement-to-payment`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Feature 002 — Sourcing, Purchase Orders, Receipt, Payments,
Accounting, and Reports (see `docs/specify002.md`): everything a donor-funded purchase goes
through after the PR is approved (RFQ or tender, quotation/bid analysis, award, PO or contract,
GRN or service completion, supplier invoice, payment request, payment voucher, Actual on the
budget line), plus non-procurement payments, cash advances, receipts, journals, the chart of
accounts, and donor and audit reports."

## Context

Feature 001 (`001-grants-pr-foundation`) delivered the organization, offices, units, numbering,
users, roles, Delegation of Authority (DoA) approval rules, donors, grants, budget lines (Budget /
Reserved / Committed / Actual / Available), activities, exchange rates, and the Purchase
Requisition (PR) with budget reservation, Finance Check, Final Approval, electronic signatures,
commitment, cancellation, printing, lists, notifications, and the budget status report.

This feature completes the cycle every donor-funded purchase follows after the PR is approved,
and the accounting that records the money:

`Approved PR → RFQ or Tender → Quotation / Bid Analysis → Award → Purchase Order or Contract →
Goods Received Note or Service Completion Certificate → Supplier Invoice → Payment Request →
Payment Voucher → Actual on the budget line`

It also adds payments that do not come from procurement (salaries, rent, per diems), cash
advances to staff and their settlement, receipts from donors, journals, transfers, and the
reports donors and auditors ask for.

Real samples from one NGO (RTHA) guide the design: an Excel workbook with the RFQ Short Form,
Quotation Analysis, Purchase Order, GRN, and Payment Request forms, and a printed Bank Payment
Voucher (BPV-35). The problems found in those samples are exactly what this feature must prevent:

- a GRN pointing to a different supplier and document number than its PO;
- payment amounts that differ from the PO total;
- an amount in words that does not match the figure;
- a voucher line labelled USD with an exchange rate of 1.0000 on an SDG amount;
- award reasons that do not match the published criteria;
- one person requesting, evaluating, and requesting payment for the same purchase.

Everything in 001 stays valid: the same tenants, offices, roles model, DoA engine, numbering,
exchange-rate rules, audit history, DD/MM/YYYY dates, exact decimal money, bilingual screens and
printouts.

### Roles in this feature

New default roles (editable permission sets, as in 001):

| Role | What they do |
|------|--------------|
| Procurement Officer (often the Logistics Officer) | Maintains suppliers, issues RFQs and tenders, records quotations, prepares POs and contracts |
| Committee Member | Declares conflict of interest, scores quotations and bids, signs evaluation reports |
| Storekeeper / Receiver | Records goods received (GRN), quantities accepted and rejected |
| Technical Inspector | Confirms quality of goods or completion of services (often the requester or a program person) |
| Accountant | Registers supplier invoices, prepares payment requests and vouchers |
| Finance Manager | Checks payment requests and vouchers; manages chart of accounts, periods, bank accounts |
| Cashier | Records cash payments and receipts, holds cash boxes |
| Country Director / Authorized Signatory | Approves awards, POs, and payments above configured limits |

Roles from 001 (Organization Admin, Requester, Finance Checker, Approver, Viewer/Auditor) remain.
A user can hold several roles; segregation rules (Business Rule 8) apply per document regardless
of the roles a user holds.

## Clarifications

### Session 2026-11-16

- Q: What is the lowest allowed value for the configurable committee minimum size? → A: Default 3, configurable, never below 2.
- Q: Which exchange rate converts a posted payment to grant currency for Actual? → A: The latest rate on or before the voucher date (001 rate rules), locked at posting.
- Q: Do PO/contract-based payment requests reserve or commit budget again? → A: No; the PO/contract already holds the commitment. Only direct payment requests and cash advances reserve on submission and commit on approval.
- Q: Who can close and reopen accounting periods? → A: Only users with `periods:manage` (Finance Manager by default); reopening also requires a reason.
- Q: Do bid securities create accounting entries? → A: Only when received as a cash deposit (receipt voucher on receipt, payment voucher on return); otherwise they are tracked only.
- Q: Before an RFQ deadline, can quotation prices be entered, or only the receipt logged? → A: Receipt only (supplier, date/time, received by); prices and the scanned quotation are entered or uploaded only during or after the recorded opening, as for tenders.

## User Scenarios & Testing *(mandatory)*

Priorities: **P1** = needed for one purchase to go from approved PR to posted payment;
**P2** = needed for real operations; **P3** = valuable later.

### User Story 1 - Procurement configuration (Priority: P1)

An Organization Admin configures how the organization buys:

- **Procurement methods by value** (in the DoA reference currency, default USD): Direct Purchase
  (minimum 1 quotation), Request for Quotation (minimum 3 quotations), Open Tender. Value bands
  are configurable, e.g. ≤ 1,000 Direct; > 1,000 to 25,000 RFQ; > 25,000 Tender.
- **Donor-specific rules per grant**: a grant may set stricter bands or a higher minimum number of
  quotations. When organization and grant rules differ, the stricter applies.
- **Approval rules (DoA) for the new document types**, using the same engine as PRs (ordered steps,
  roles, amount bands, office-specific or organization-wide): Award (Quotation/Bid Analysis),
  Purchase Order, Contract, PO/Contract Amendment, Waiver, Payment Request, Payment Voucher,
  Receipt Voucher, Journal Voucher, Cash Advance, Advance Settlement, Direct Payment Request.
- **Numbering** for each new document type, per office and calendar year, using the 001 numbering
  configuration (e.g. `RFQ-MAD-2026-0004`, `PO-MAD-2026-0010`, `BPV-KST-2026-0035`).
- **Tolerances**: allowed difference between invoice and PO price/quantity (default 0%), and
  allowed over-delivery on a GRN (default 0%).
- **Deductions**: configurable deductions applied on payments (e.g. withholding tax %, separately
  for goods and services), each mapped to a payable account.

**Why this priority**: Every downstream document depends on the method, approval route, number
format, tolerance, and deduction rules being defined.

**Independent Test**: Create a new organization, confirm the defaults are seeded, edit bands and a
grant-specific rule, and confirm the required method for a sample PR value reflects the stricter
rule.

**Acceptance Scenarios**:

1. **Given** an RFQ band of 1,000–25,000 USD and a grant whose donor requires RFQ from 500 USD,
   **When** an approved PR of 800 USD-equivalent on that grant is sourced, **Then** the system
   requires an RFQ.
2. **Given** bands that overlap or leave a gap, **When** the admin saves them, **Then** saving is
   blocked and the overlap or gap is identified.
3. **Given** a new organization, **When** it is created, **Then** default methods, bands, approval
   rules, numbering, tolerances, and deduction types are seeded and editable.
4. **Given** a configuration change to bands or tolerances, **When** it is saved, **Then** it is
   recorded in history and does not change documents already submitted or approved.

---

### User Story 2 - Supplier registry and vetting (Priority: P1)

A Procurement Officer maintains one supplier list for the organization:

- Supplier: legal name (Arabic/English), trade name, type (company, individual, government, NGO),
  registration number, tax number, address, city, phone, email, contact person, bank details (bank,
  branch, account name, account number), categories supplied (e.g. stationery, food,
  construction, transport), notes.
- Documents with expiry dates: registration certificate, tax certificate, others. Expired required
  documents are flagged.
- **Status**: Pending Vetting → Approved → Suspended / Blacklisted (reason required). Only Approved
  suppliers can be invited, awarded, or paid.
- **Vetting record**: sanctions/terrorism list check (date, by whom, lists checked, result,
  evidence attachment), required before first approval and repeated every N months (configurable,
  default 12). Automatic screening against external lists is out of scope.
- **Performance**: rating per completed order (on time, quality, documentation; 1–5 each), shown
  as an average on the supplier.
- **Duplicate prevention**: warning on the same registration number, tax number, phone, or bank
  account as another supplier or a staff member's recorded account.
- Supplier history: invitations, quotations, awards, POs, deliveries, payments.

**Why this priority**: No RFQ, award, or payment can name a supplier until vetted suppliers exist;
donors require sanctions checks on every payee.

**Independent Test**: Register a supplier with documents and a vetting record, approve it, let a
document expire, blacklist another, and confirm selection, warning, and blocking behaviour across
RFQ invitation and award.

**Acceptance Scenarios**:

1. **Given** a supplier with an expired registration certificate, **When** it is invited to an RFQ,
   **Then** a warning shows; **When** it is awarded, **Then** the award is blocked until the
   document is renewed or a waiver is approved.
2. **Given** a Blacklisted supplier, **Then** it cannot be selected anywhere, and its existing open
   POs show a warning.
3. **Given** a supplier whose bank account equals another supplier's or a staff member's recorded
   account, **Then** a duplicate warning shows to Finance.
4. **Given** a supplier whose last vetting is older than the configured re-vetting period,
   **Then** it is flagged as vetting overdue and cannot be awarded or paid until re-vetted.
5. **Given** a supplier is set to Suspended or Blacklisted without a reason, **Then** saving is
   blocked.

---

### User Story 3 - Request for Quotation from approved PRs (Priority: P1)

A Procurement Officer sources approved PR lines:

- An RFQ is created from one or more **approved PRs of the same grant**; the officer selects which
  PR lines to include. Lines copy description, specifications, quantity, and unit; the officer may
  group or reword descriptions for suppliers, but the link to each PR line is kept.
- The system proposes the procurement method from the total estimated value (US1). Using a lower
  method than required needs an approved **Waiver** (US10).
- RFQ fields: issue date, submission deadline (date and time), delivery place and time, quotation
  currency, payment terms, required offer validity, whether split award by line is allowed,
  essential criteria (pass/fail, e.g. meets specifications, valid registration certificate,
  technical check), and weighted award criteria that must total 100% (e.g. price 50%, quality 25%,
  validity 25%).
- Invited suppliers: at least the method's minimum, all Approved. Invitation date and channel
  (email, WhatsApp, in person, newspaper) are recorded. The RFQ prints as a PDF to send.
- RFQ statuses: Draft → Issued → Closed (deadline passed) → Opened → Evaluated → Awarded; or
  Cancelled / Re-issued.
- A PR line can be in only one open sourcing event at a time. PR lines show their sourcing status
  (Not sourced, In RFQ/Tender, Ordered, Cancelled).

**Why this priority**: Sourcing is the first step after PR approval and the first control donors
test (competition).

**Independent Test**: From the approved RTHA PR 0010, create, configure, and issue an RFQ, and
confirm line links, method proposal, criteria validation, and exclusivity of PR lines.

**Acceptance Scenarios**:

1. **Given** an approved PR of 9 lines, **When** an RFQ is created from it, **Then** all 9 lines
   are linked to their PR lines and the RFQ proposes RFQ as the method based on 870,710 SDG
   converted to USD.
2. **Given** award criteria totalling 90%, **When** the RFQ is issued, **Then** issuing is blocked.
3. **Given** a PR line already in an open RFQ, **When** another RFQ tries to include it, **Then**
   it is not selectable.
4. **Given** fewer invited Approved suppliers than the method minimum, **When** the RFQ is issued,
   **Then** issuing is blocked unless an approved waiver is linked.
5. **Given** PRs of two different grants, **When** the officer tries to combine them in one RFQ,
   **Then** it is not allowed.

---

### User Story 4 - Record quotations and open them (Priority: P1)

- **Receipt log before the deadline**: the officer logs each quotation received with supplier,
  date/time received, and received by only. No prices, terms, or scanned quotation can be entered
  before the opening; the paper or emailed quotation stays sealed outside the system.
- **Opening**: after the deadline, an opening is recorded (date, time, at least two people
  present). During or after the opening, the officer enters each logged quotation's per-line unit
  price (and quantity if different), currency, delivery time, offer validity, payment terms,
  compliance per essential criterion, and uploads the scanned quotation.
- Quotations received after the deadline are marked Late and excluded unless the opening record
  explicitly accepts them with a reason.
- A supplier can submit one quotation per RFQ; a corrected quotation received before the deadline
  replaces the previous one in the receipt log (only the latest is entered at opening), and both
  receipts remain in history.

**Why this priority**: Prices sealed until a witnessed opening is the core anti-fraud control of
competitive sourcing.

**Independent Test**: Log three quotations before the deadline, verify no price or attachment can
be entered or seen by any user by any means, record the opening, enter the prices, and verify late
quotations are excluded.

**Acceptance Scenarios**:

1. **Given** an RFQ before its opening is recorded, **When** any user, including the officer who
   logged it and administrators, tries to enter a price or upload the scanned quotation, **Then**
   it is blocked, and no price appears on any screen, list, export, print, or search result.
2. **Given** fewer valid quotations than the minimum after opening, **Then** evaluation requires
   either an approved waiver (US10) or re-issuing the RFQ.
3. **Given** the deadline has not passed, **When** a user tries to record the opening, **Then** it
   is blocked.
4. **Given** a quotation received after the deadline, **Then** it is marked Late and excluded
   from evaluation unless the opening record accepts it with a reason.

---

### User Story 5 - Quotation analysis, committee, and award (Priority: P1)

- The system builds the comparison table automatically: per supplier and per line, unit price,
  line total, quotation total, currency, converted totals in the RFQ currency, delivery time,
  validity, and essential-criteria compliance.
- **Committee**: at least 3 members (configurable, never below 2), normally Logistics/Procurement, Finance, and
  Program/Technical. Before seeing quotations, each member signs a **conflict-of-interest
  declaration**; a member who declares a conflict with a bidder is excluded.
- **Scoring**: suppliers failing an essential criterion are disqualified with the reason. Price
  score is calculated, never typed: the lowest valid price gets the full price weight; others get
  weight × lowest ÷ their price. Other criteria are scored 1–5 by each member and averaged.
  Weighted total per supplier is calculated.
- **Recommendation**: the highest-scoring valid supplier is recommended by default. Recommending
  another supplier requires a written justification **that refers to the published criteria**.
- **Split award** by line is allowed when the RFQ allows it; each line goes to one supplier.
- Members sign the analysis; then the award goes through DoA approval (by awarded amount).
- After approval: winning suppliers become awardees; unsuccessful suppliers are recorded as
  notified (date, channel).

**Why this priority**: The award is the decision auditors review most; it must be proven fair,
calculated, and approved by someone other than the requester.

**Independent Test**: With three opened quotations, seat a committee, record declarations and
scores, sign, approve the award, and verify calculated scores, segregation, and justification
rules.

**Acceptance Scenarios**:

1. **Given** 3 valid quotations with prices 870,710 / 910,000 / 1,020,000 and price weight 50%,
   **Then** price scores are 50.00 / 47.84 / 42.68 (2 decimals) and cannot be edited.
2. **Given** a committee member who created the PR, **Then** they may sit on the committee but
   cannot approve the award.
3. **Given** the recommended supplier is not the highest score and the justification is empty,
   **Then** the analysis cannot be signed.
4. **Given** a member declares a conflict and the remaining committee falls below the minimum
   size, **Then** scoring cannot proceed until another member is added.
5. **Given** a member who has not signed a conflict-of-interest declaration, **Then** they cannot
   see quotation prices or score.

---

### User Story 6 - Purchase Order from the award (Priority: P1)

- A PO is created from an approved award: supplier, lines with awarded prices, linked RFQ and PR
  lines, grant, budget lines, locations, and activities are inherited, not retyped. A split award
  produces one PO per awarded supplier.
- PO fields: PO date, delivery address and schedule, delivery terms, payment terms (including
  advance % and retention % if any), currency, total and total in words, special conditions.
- **Budget**: on PO approval, the PR's commitment for the ordered lines is replaced by the PO's
  commitment at the PO amount (converted to grant currency with the rate locked at PO approval).
  If the PO amount is higher than the PR's committed amount, the difference must fit in
  Available, otherwise approval is blocked with the shortfall. If lower, the difference returns to
  Available.
- DoA approval by amount; the creator cannot approve.
- **Supplier acknowledgement**: the PO signed by the supplier is uploaded with the date. Delivery
  can be recorded only after acknowledgement (configurable).
- PO statuses: Draft → Pending Approval → Approved → Acknowledged → Partially Received → Fully
  Received → Closed; or Cancelled. A PO closes when fully received and fully paid, or manually with
  a reason, which releases any remaining commitment.
- A PR closes automatically when all its lines are ordered or cancelled; unsourced lines can be
  cancelled with a reason, releasing their commitment.

**Why this priority**: The PO is the legal obligation to the supplier and the point where the
budget commitment becomes the supplier's.

**Independent Test**: From the approved RTHA award, create and approve a PO, upload the
acknowledgement, and verify inherited fields and the budget line's Committed/Available figures.

**Acceptance Scenarios**:

1. **Given** the RTHA award of 870,710 SDG on budget line 10202, **When** the PO is approved,
   **Then** line 10202 shows the PR commitment replaced by the PO commitment, and Available is
   unchanged if the amounts are equal.
2. **Given** a PO whose supplier differs from the award, **Then** it cannot be created (supplier is
   inherited, not editable).
3. **Given** a PO amount higher than the PR's committed amount by more than Available, **When**
   it is approved, **Then** approval is blocked and the shortfall shown.
4. **Given** acknowledgement is required, **When** a GRN is attempted on an unacknowledged PO,
   **Then** it is blocked.
5. **Given** a PR whose 9 lines are all ordered, **Then** the PR status becomes Closed.

---

### User Story 7 - Goods Received Note (Priority: P1)

- A GRN is created from an approved (and, when required, acknowledged) PO: received date, supplier
  delivery note number, supplier invoice number (optional), shipment type (Partial / Final), and
  per line: quantity delivered, accepted, rejected with reason, and condition remarks.
- Accepted quantity cannot exceed ordered minus already accepted (plus the over-delivery
  tolerance). Supplier and PO number are inherited and cannot be changed.
- Signatures: Received By (storekeeper/receiver) and Inspected By (technical inspector or
  requester). The receiver and inspector must be different people.
- **Returns to supplier**: rejected quantities are recorded as returned with date; the supplier may
  redeliver on a later GRN.
- The supplier rating (US2) is captured when the PO is fully received.
- Stock receipt and asset tagging are out of scope, but each GRN line can be flagged **Asset** for
  the future register.

**Why this priority**: Payment for goods is allowed only against proven receipt; the RTHA GRN that
pointed to another supplier must be impossible.

**Independent Test**: Receive a PO in two partial GRNs and verify quantity limits, inherited
fields, two-person signing, and PO status changes.

**Acceptance Scenarios**:

1. **Given** a PO for 100 pieces, **When** a GRN accepts 60 and a second GRN accepts 50, **Then**
   the second is blocked (only 40 remain, tolerance 0%).
2. **Given** a GRN, **Then** it always shows the PO's supplier and number; no field allows another.
3. **Given** the same user is entered as Received By and Inspected By, **Then** the GRN cannot be
   completed.
4. **Given** all PO lines are fully accepted, **Then** the PO becomes Fully Received and the
   supplier rating is requested.

---

### User Story 8 - Service contracts, milestones, and completion certificates (Priority: P2)

- For services (construction, consultants, transport, catering), the award produces a **Contract**
  instead of a PO: scope / Terms of Reference attachment, start and end date, milestones
  (deliverable, amount or % of total, due date), advance %, retention %, performance guarantee
  (type, amount, expiry).
- Each milestone is confirmed by a **Service Completion Certificate** signed by the requester or
  program focal person and a second, different confirmer; partial completion is recorded as a
  percentage.
- Contracts follow the same budget, approval, and closing rules as POs (US6).
- Small one-off services (e.g. meals for a training: 80 persons × 16,775 SDG) may use a PO with unit
  "Person" and a single completion certificate.
- Guarantees nearing expiry (configurable, default 30 days) appear in notifications.

**Why this priority**: Many NGO purchases are services, but the first end-to-end chain can be
proven with goods.

**Independent Test**: Create and approve a contract with three milestones, certify one fully and
one partially, and verify the amounts payable and guarantee expiry notification.

**Acceptance Scenarios**:

1. **Given** a contract whose milestone percentages total other than 100% (or whose amounts total
   other than the contract total), **When** it is submitted, **Then** submission is blocked.
2. **Given** a milestone certified at 60%, **Then** at most 60% of that milestone amount can be
   requested for payment.
3. **Given** a certificate where both signers are the same person, **Then** it cannot be
   completed.
4. **Given** a performance guarantee expiring in 30 days, **Then** the procurement officer and
   Finance Manager are notified.
5. **Given** the RTHA catering service of 80 persons × 16,775 SDG on a PO, **When** a completion
   certificate is signed, **Then** 1,342,000.00 SDG becomes payable.

---

### User Story 9 - Open tenders (Priority: P2)

For purchases above the tender band:

- **Tender file**: tender number, title, lots (each lot = group of PR lines), publication date,
  publication channels (newspaper, website, notice board) with evidence attachment, tender
  documents, clarification deadline, submission deadline, opening date/place, bid security
  requirement (amount or %, type, validity).
- **Clarifications**: bidders' questions and answers, shared with all bidders (log with dates).
- **Bid receipt log** before the deadline: bidder, date/time, received by, bid security received.
  No prices are recorded before opening.
- **Bid opening session** after the deadline: opening committee (≥ 3 present), each bid's price(s)
  read out and recorded, bid security checked, opening record signed by all present.
- **Evaluation** in two stages: administrative/technical (pass/fail and scores), then financial
  only for technically compliant bids; combined score with configured weights; recommendation per
  lot; committee signatures; conflict-of-interest declarations as in US5; DoA approval.
- **Bid securities**: returned to unsuccessful bidders (date) and to the winner after contract
  signature; or forfeited with reason. Only cash-deposit securities create accounting entries
  (receipt voucher on receipt, payment voucher on return).
- **Failure paths**: no bids or no compliant bids → cancel or re-tender (new number, link kept).

**Why this priority**: Tenders are less frequent than RFQs but mandatory above the band.

**Independent Test**: Publish a two-lot tender, log bids, hold the opening, evaluate in two stages,
award per lot, and return bid securities.

**Acceptance Scenarios**:

1. **Given** a tender before its deadline, **Then** no user can enter or see prices.
2. **Given** a bid received after the deadline, **Then** it is logged as Late and cannot be opened.
3. **Given** a bid that fails the technical stage, **Then** its financial offer is not scored.
4. **Given** fewer than 3 people recorded present at opening, **Then** the opening record cannot be
   signed.
5. **Given** no compliant bids, **When** the officer re-tenders, **Then** a new tender number is
   issued and linked to the original, and the PR lines move to the new tender.

---

### User Story 10 - Waivers, amendments, and cancellations (Priority: P2)

- **Waiver**: deviation from the required method or minimum quotations (single source, emergency,
  fewer quotations received, expired supplier document, overdue advance). Fields: reason category,
  written justification, attachments. Approved through its own DoA (normally one level higher).
  The waiver is linked to the document it covers and shown on all its printouts and reports.
- **PO/Contract amendment**: change quantity, price, delivery date, or milestones after approval.
  Creates a numbered amendment with version, reason, and before/after values; goes through DoA
  approval by the new total; budget is rechecked for any increase. The approved PO is never edited
  in place.
- **Cancellation** of RFQ, tender, PO, or contract with reason and permission; releases
  commitments; history kept.
- **Anti-splitting warning**: when several PRs from the same office and grant for similar items
  (same category) within 30 days together exceed the next method band, the procurement officer
  sees a warning that must be acknowledged with a comment (not a block).

**Why this priority**: Real operations constantly hit exceptions; without these, users would work
around controls.

**Independent Test**: Approve a single-source waiver on an RFQ, amend an approved PO upward and
downward, cancel a PO, and trigger the splitting warning with two PRs.

**Acceptance Scenarios**:

1. **Given** an RFQ with 2 valid quotations and an approved "fewer quotations" waiver, **Then**
   evaluation proceeds and the waiver number appears on the analysis, PO, and payment printouts.
2. **Given** an amendment increasing a PO by more than Available, **When** it is approved, **Then**
   approval is blocked with the shortfall.
3. **Given** an approved amendment, **Then** the PO shows version 2 with before/after values and
   the original version remains viewable unchanged.
4. **Given** a cancelled PO with nothing received, **Then** its full commitment is released and
   its PR lines become available for sourcing again.
5. **Given** two PRs of 600 USD each, same office, grant, and category within 30 days, with a Direct
   band of ≤ 1,000 USD, **When** the second is sourced as Direct Purchase, **Then** a splitting
   warning shows and must be acknowledged with a comment.

---

### User Story 11 - Supplier invoices and payment requests (Priority: P1)

- **Supplier invoice**: registered against a PO or contract: invoice number, date, amount,
  currency, lines (quantity × price), attachment. A duplicate invoice number for the same supplier
  is blocked.
- **Payment Request** is created from the PO/contract with the invoice and the matching GRN(s) or
  completion certificate(s). It inherits payee, bank details, budget lines, grant, donor,
  locations, and activities.
- **Three-way match**: for each line, invoiced quantity ≤ accepted quantity (GRN) and invoiced
  price ≤ PO price, within tolerance (US1). Mismatches block submission unless a user with
  `payment:override_match` approves an override with a reason.
- **Advance payment** against a PO/contract is allowed up to its advance %; later payments deduct
  the advance proportionally.
- **Retention** is withheld per contract terms and released by a separate payment request after the
  retention period.
- **Deductions** (US1) are calculated automatically (e.g. withholding tax) and shown on the request.
- Fields: payment method (bank transfer, cheque, bank draft, cash), payment currency (may differ
  from PO currency, converted with the 001 rate rules), gross, deductions, net, amount in words, and
  a "charge as follows" table (budget line, grant/project, location, activity, donor, amount) —
  calculated, never typed.
- DoA approval by net amount; whoever received or inspected the goods cannot approve the payment;
  the preparer cannot approve it.
- The total paid on a PO can never exceed the PO total (plus approved amendments).

**Why this priority**: Without a matched, approved payment request no money can leave; this is
where RTHA's amount mismatches occurred.

**Independent Test**: Register the RTHA invoice, create a payment request against the fully
received PO, and verify inherited data, calculated amounts and words, the match, and approval
segregation.

**Acceptance Scenarios**:

1. **Given** the RTHA PO of 870,710 SDG fully received, **When** a payment request is created,
   **Then** gross is 870,710.00 SDG, the words read "Eight Hundred Seventy Thousand Seven Hundred
   Ten Sudanese Pounds" (and the Arabic equivalent), and no field allows typing a different amount.
2. **Given** an invoice of 900,000 for a PO of 870,710 with 0% tolerance, **Then** submission is
   blocked unless an override is approved.
3. **Given** the storekeeper who signed the GRN, **When** they try to approve the payment request,
   **Then** it is blocked.
4. **Given** a PO with 30% advance already paid, **When** the final payment is requested, **Then**
   the advance is deducted and total payments do not exceed the PO total.
5. **Given** an invoice number already registered for the same supplier, **Then** registration is
   blocked.

---

### User Story 12 - Chart of accounts, bank and cash accounts, periods (Priority: P1)

- **Chart of accounts**: hierarchical (groups and posting accounts), code, bilingual name, type
  (asset, liability, fund balance, income, expense), active flag. A default NGO chart is seeded and
  editable; accounts used in posted vouchers cannot be deleted (only deactivated).
- **Budget lines mapped to accounts**: each budget line has an expense account (default by
  category, overridable per line). Organizations that use donor line codes as account codes (e.g.
  RTHA `10102` Field Supervision Officer) can create matching accounts.
- **Bank accounts and cash boxes**: name, bank, branch, account number, currency, office, linked
  ledger account, custodian (for cash), opening balance and date.
- **Control accounts**: staff advances, supplier advances, retention payable, withholding tax
  payable, grant funds received (per grant), exchange gain/loss — configurable.
- **Accounting periods**: monthly, Open / Closed. No posting into a closed period; reopening needs
  `periods:manage` and a reason.
- **Opening data import**: opening balances per account and per budget line (committed and actual
  to date), open POs, and the previous year's posted transactions, from a spreadsheet import
  template with a preview that reports invalid rows (same pattern as the 001 budget-line import).
  Imported transactions are marked as imported and must balance like any voucher.

**Why this priority**: Vouchers cannot be posted without accounts, bank/cash accounts, and an open
period; organizations cannot go live without their opening position.

**Independent Test**: Seed a new organization's chart, map RTHA budget lines, create the Blue Nile
Mashreq Bank account and a cash box, open November 2026, import opening balances, and close and
reopen a period.

**Acceptance Scenarios**:

1. **Given** an account used in a posted voucher, **When** the admin tries to delete it, **Then**
   it is blocked; deactivation is allowed.
2. **Given** a budget line with no expense account mapped, **When** a voucher charging it is
   generated, **Then** generation is blocked and the unmapped line is named.
3. **Given** an opening-balance import whose debits and credits do not balance, **Then** the
   preview reports it and nothing is imported.
4. **Given** a closed period, **When** a user without `periods:manage` tries to reopen it, **Then**
   it is blocked; with the permission, a reason is required and recorded.

---

### User Story 13 - Payment vouchers and posting (Priority: P1)

- A **Payment Voucher** is generated from an approved payment request: **BPV** (bank: transfer or
  cheque; cheque number required) or **CPV** (cash box). Lines are generated and balanced: debit
  expense (per budget line, with grant, donor, budget line, location, activity, contract/category
  dimensions), debit supplier advance or clear it, credit bank/cash for the net, credit deductions
  and retention payable.
- Each line shows account code and name, currency, donor, contract/category, description, debit,
  credit, exchange rate, and base-currency debit/credit, like the RTHA BPV form. The voucher must
  balance in base currency. A line's currency label must match its amount: a non-base-currency line
  requires its own rate, so "USD with rate 1.0000 on an SDG amount" is impossible.
- Statuses: Draft → Checked → Approved → Posted. Entered by, Checked by, and Approved by must be
  three different people. Posting requires an open period.
- **Posting** makes the voucher immutable, records **Actual** on each budget line (in grant
  currency with the rate locked at posting), reduces the PO/contract commitment by the matched
  amount, and marks the payment request Paid with the payment date (the "PAID" stamp always has a
  date).
- **Received By**: payee name and date captured; signed copy upload for cash and cheques.
- Corrections only by **reversal**: a reversing voucher linked to the original, then a new voucher.

**Why this priority**: Posting is the moment money is recorded as spent on the donor's budget line;
it closes the chain.

**Independent Test**: Generate the BPV from the RTHA payment request, check, approve, and post it,
and verify the budget line figures, immutability, and reversal.

**Acceptance Scenarios**:

1. **Given** the posted RTHA payment of 870,710 SDG on budget line 10202, **Then** the budget status
   shows Actual increased by the grant-currency amount and Committed decreased by the same matched
   amount.
2. **Given** a voucher whose debits and credits differ by 0.01 in base currency, **Then** it cannot
   be checked.
3. **Given** a posted voucher, **Then** no field can be edited; only a reversal is possible.
4. **Given** a BPV line labelled USD on an SDG amount with rate 1.0000, **Then** the voucher cannot
   be saved.
5. **Given** the user who entered a voucher, **When** they try to check or approve it, **Then** it is
   blocked.
6. **Given** a reversal of a posted voucher, **Then** Actual on each budget line decreases by the
   original amount and the commitment is restored, using the original voucher's rates.

---

### User Story 14 - Receipts, journals, transfers, and exchange (Priority: P2)

- **Receipt vouchers**: BRV (bank) and CRV (cash): donor tranche received (linked to a grant;
  credits grant funds received), refunds from suppliers, staff returns of unused advances, other
  income.
- **Journal voucher (JV)**: adjustments and reclassifications between budget lines or grants, with
  mandatory reason; affected budget lines are rechecked for Available.
- **Bank/cash transfers** between accounts, including currency conversion (e.g. USD account to SDG
  account) with the rate used and an automatic exchange gain/loss line.
- **Grant funding summary**: budget, tranches received, expenses (actual), fund balance (received −
  spent).

**Why this priority**: Needed to record donor funding and fix errors, but not needed to make the
first payment.

**Independent Test**: Record a donor tranche, reclassify a posted expense between two budget lines
with a JV, transfer USD to an SDG account, and verify the grant funding summary.

**Acceptance Scenarios**:

1. **Given** a BRV for a 50,000 USD tranche on a grant, **When** posted, **Then** the grant funding
   summary shows it as received and the fund balance increases.
2. **Given** a JV moving 100,000 SDG of Actual to a budget line with 80,000 SDG Available, **Then**
   it cannot be approved.
3. **Given** a transfer of 1,000 USD converted at a rate different from the source account's
   carrying rate, **Then** the exchange difference is posted automatically to the exchange
   gain/loss account and the transfer balances.
4. **Given** a JV without a reason, **Then** it cannot be submitted.

---

### User Story 15 - Direct payment requests without PO (Priority: P2)

For payments that are not purchases: salaries and allowances, rent, utilities, per diems, transport
refunds, tax remittances.

- Payee (supplier, staff member, or other), category, period (e.g. salary September), lines with
  budget line, location, activity, description, amount, attachments (contract, timesheet,
  invoice).
- Budget: Reserved on submission, Committed on approval, Actual on posting — the same lifecycle as
  PRs.
- DoA approval; creates a BPV/CPV as in US13.
- Payroll calculation is out of scope; the salary amount is entered per person.

**Why this priority**: Staff and running costs are a large share of grant spending but follow a
simpler path than procurement.

**Independent Test**: Reproduce BPV-35 from a direct payment request and compare the printout with
the paper sample.

**Acceptance Scenarios**:

1. **Given** a direct payment request for the September salary of the Field Supervision Officer,
   3,040,800.00 SDG, account 10102, donor ADRA, cheque 35, Blue Nile Mashreq Bank – White Nile,
   **When** approved and the BPV posted, **Then** the voucher shows amount in words "Three Million
   Forty Thousand Eight Hundred Sudanese Pounds" (and the Arabic equivalent), and Actual on the
   budget line increases accordingly.
2. **Given** a direct payment request exceeding Available on its budget line, **When** submitted,
   **Then** submission is blocked with the shortfall.
3. **Given** a direct payment request for goods that should go through procurement (category
   flagged as procurement-only), **Then** it cannot be submitted.

---

### User Story 16 - Cash advances and settlement (Priority: P2)

- **Advance request** by a staff member for field expenses: purpose, office, expected settlement
  date, planned lines (budget line, amount). Approved through DoA; Reserved/Committed on the budget
  lines like a PR; paid through CPV/BPV to the staff advance account (not an expense).
- **Settlement**: the staff member submits receipts per budget line (attachments); the unused
  amount is returned (CRV) or an additional amount is paid. On posting, expenses become Actual and
  the advance balance clears.
- A staff member cannot receive a new advance while one is overdue beyond the configured days
  (default 30) unless a waiver is approved.
- Outstanding advances report by person, age, and amount.

**Why this priority**: Field operations depend on advances, and unsettled advances are a frequent
audit finding.

**Independent Test**: Request, approve, and pay an advance, settle it with receipts and a partial
return, and verify the advance balance and budget figures.

**Acceptance Scenarios**:

1. **Given** an advance of 500,000 SDG paid, **When** settled with receipts of 420,000 and a CRV of
   80,000, **Then** Actual increases by 420,000, the remaining commitment of 80,000 is released, and
   the staff advance balance is 0.
2. **Given** a staff member with an advance overdue 31 days, **When** a new advance is requested,
   **Then** it is blocked unless an approved waiver is linked.
3. **Given** an advance payment is posted, **Then** Actual on the budget lines is unchanged and the
   amount appears in the staff advance account.

---

### User Story 17 - Shared cost allocation (Priority: P3)

- Allocation templates for shared costs (rent, utilities, shared staff): percentage per grant /
  budget line, effective dates, total 100%.
- Applying a template to a posted expense creates a JV that moves the cost to the grants' budget
  lines, rechecking Available on each.

**Why this priority**: Useful for multi-grant offices, but separate documents per grant work
meanwhile.

**Independent Test**: Allocate a posted rent payment 60/40 between two grants and verify the JV and
budget figures.

**Acceptance Scenarios**:

1. **Given** a template totalling 95%, **Then** it cannot be saved.
2. **Given** a 1,000,000 SDG rent expense and a 60/40 template, **When** applied, **Then** a JV moves
   600,000 and 400,000 to the target budget lines, blocked if either lacks Available.

---

### User Story 18 - Bank reconciliation (Priority: P3)

- Enter or import (CSV/Excel) bank statement lines per bank account and month; match them to posted
  voucher lines; mark cleared; show unreconciled items and the reconciled balance; sign off the
  month.

**Why this priority**: Valuable control, but done manually today and not blocking payments.

**Independent Test**: Import a month's statement, match lines, and sign off.

**Acceptance Scenarios**:

1. **Given** imported statement lines and posted voucher lines, **When** matched, **Then** the
   reconciled balance equals the statement closing balance, otherwise sign-off is blocked and the
   difference is shown.
2. **Given** a signed-off month, **Then** its matches cannot be changed without reopening with a
   reason.

---

### User Story 19 - Reports (Priority: P1 for the first three, P2 for the rest)

All reports are exportable to PDF and Excel, filterable by grant, donor, office, period, and dates,
in Arabic and English, with DD/MM/YYYY dates.

1. **Budget vs. Actual per grant** (P1): per budget line in donor codes: budget, reserved,
   committed, actual (period and cumulative), available, % used, burn rate.
2. **Donor financial report export** (P1): per grant and reporting period: budget line code,
   description, budget, actual previous periods, actual this period, cumulative, balance, % — in
   grant currency, listing the exchange rates used. Donor-specific custom layouts are out of scope.
3. **Procurement register** (P1): every sourcing event with PR, method, waiver, RFQ/tender, number
   of quotations, awarded supplier, PO/contract, amounts, GRN, invoice, payment, dates, and cycle
   time — the list auditors request first.
4. Open commitments (PRs, POs, contracts not fully paid).
5. Supplier history and payments per supplier.
6. General ledger, account statement, trial balance.
7. Bank book and cash book per account with running balance.
8. Outstanding advances and ageing.
9. Grant funding summary (received vs. spent vs. budget).
10. **Document trail**: from any document (payment, voucher, GRN, PO, award, RFQ, PR) open the full
    chain in both directions with all attachments and signatures.

**Why this priority**: Donor reports and the procurement register are what the organization is
judged on; the rest supports daily finance work.

**Independent Test**: After running the RTHA chain, produce each P1 report for the ADRA grant and
reconcile its figures with the posted vouchers.

**Acceptance Scenarios**:

1. **Given** the posted RTHA payment, **Then** Budget vs. Actual for the ADRA grant shows the
   grant-currency equivalent of 870,710 SDG as Actual on line 10202, equal to the sum of posted
   voucher lines.
2. **Given** a donor report for a period, **Then** actual previous periods + actual this period =
   cumulative, and every exchange rate used is listed.
3. **Given** the trial balance for any period, **Then** total debits equal total credits.
4. **Given** the RTHA payment voucher, **When** the auditor opens its document trail, **Then** PR,
   RFQ, analysis, award, PO, GRN, and invoice are each reachable with signatures and attachments.

---

### User Story 20 - Printing (Priority: P2)

Every approvable document prints as a PDF matching the organization's form, in Arabic and English,
with logo, number, dates, status watermark, amount in words, and signature blocks filled from the
electronic approvals: RFQ (to suppliers), Quotation/Bid Analysis, Bid Opening Record, PO, Contract
summary, Amendment, GRN, Service Completion Certificate, Waiver, Payment Request, Payment Voucher
(BPV/CPV layout as in the RTHA sample, with "PAID" and payment date when posted), Receipt Voucher,
Journal Voucher, Advance, and Settlement.

**Why this priority**: Field offices and donors still file signed paper, but electronic signatures
already prove approvals.

**Independent Test**: Print each document type in both languages from the RTHA chain and BPV-35 and
compare with the samples.

**Acceptance Scenarios**:

1. **Given** the posted BPV-35, **Then** its printout reproduces every field of the paper sample and
   shows "PAID" with the payment date.
2. **Given** an RFQ printout sent to suppliers, **Then** it shows no other supplier names and no
   prices.
3. **Given** a document not yet approved or cancelled, **Then** its printout carries a "DRAFT" or
   "CANCELLED" watermark.

---

### User Story 21 - Lists, My tasks, notifications, history (Priority: P2)

Extend the 001 patterns to every new document type: lists with filters and search, "My tasks"
across all documents awaiting the user's action, in-app notifications (action required, approved,
rejected, returned, deadline reached, guarantee or document expiring, advance overdue, vetting due),
and the history timeline on every document.

**Why this priority**: Required for daily use at volume, but each document is usable without it.

**Independent Test**: Assign tasks of several document types to one user and verify "My tasks",
notifications, and timelines.

**Acceptance Scenarios**:

1. **Given** a payment request awaiting a user's approval and an award awaiting their signature,
   **Then** both appear in their "My tasks".
2. **Given** an RFQ deadline passes, **Then** the procurement officer is notified that the opening
   can be recorded.
3. **Given** any document, **Then** its timeline shows every state change, signature, and edit
   with who and when.

---

### Edge Cases

- Fewer valid quotations than required → waiver or re-issue; the waiver appears on every printout
  of the chain.
- All quotations exceed the PR budget → award blocked by budget check unless the budget line has
  enough Available or Finance approves a budget-line change.
- Quotations in different currencies → compared in the RFQ currency at the opening-date rate, with
  the rates used shown.
- Supplier blacklisted after PO approval → open PO flagged; payments require Finance Manager
  approval with reason.
- Partial delivery, then PO closed short → remaining commitment released.
- Invoice in USD for an SDG PO → payment request converts with the rate rules; differences against
  the PO beyond tolerance need an override.
- Payment currency different from the bank account currency → blocked; a transfer (US14) is
  needed first.
- Voucher posted to the wrong budget line → reversal + new voucher, or JV reclassification with
  reason.
- Closing a period with unposted approved vouchers → warning listing them before closing.
- Advance settled with receipts on a budget line without enough Available → settlement blocked until
  Finance moves the expense to another line.
- Grant Suspended or Closed → the 001 freeze applies to all new documents on that grant: no approval
  steps can be signed; payments for already-received goods require a Finance Manager override.
- Tender cancelled after opening → bid securities returned; reason recorded.
- Two payment requests submitted at the same time against the same PO → only those that keep total
  paid ≤ PO total succeed.
- Exchange rate changes between PO approval and payment posting → the commitment is released at
  the PO's locked rate and Actual is recorded at the posting rate; any difference is shown on the
  budget line, and Available is rechecked.
- Supplier corrects a quotation before the deadline → the latest receipt replaces the earlier;
  only the latest is entered at opening; both receipts kept in history.
- A committee member leaves the organization before signing → they are replaced, and the
  replacement signs a conflict-of-interest declaration before scoring.
- Voucher date in a closed period → posting blocked; the user must choose a date in an open period
  or have the period reopened.

## Requirements *(mandatory)*

### Functional Requirements

**Procurement configuration**

- **FR-001**: System MUST let admins configure procurement methods (Direct Purchase, RFQ, Open
  Tender) with value bands in the DoA reference currency and a minimum number of quotations per
  method, seeded with defaults (≤ 1,000 Direct, min 1; > 1,000 to 25,000 RFQ, min 3; > 25,000
  Tender).
- **FR-002**: System MUST block saving bands that overlap or leave gaps.
- **FR-003**: System MUST let a grant define stricter bands and/or a higher minimum number of
  quotations, and MUST apply the stricter of organization and grant rules to each sourcing event's
  estimated value.
- **FR-004**: System MUST support DoA approval rules (ordered steps, roles, amount bands, office
  scope) for: Award, Purchase Order, Contract, Amendment, Waiver, Payment Request, Direct Payment
  Request, Payment Voucher, Receipt Voucher, Journal Voucher, Cash Advance, Advance Settlement —
  seeded with defaults.
- **FR-005**: System MUST provide numbering per new document type, per office and calendar year,
  using the 001 numbering configuration.
- **FR-006**: System MUST let admins configure invoice price/quantity tolerance (default 0%), GRN
  over-delivery tolerance (default 0%), committee minimum size (default 3, never below 2), supplier re-vetting
  period (default 12 months), guarantee expiry warning (default 30 days), advance overdue days
  (default 30), and whether PO acknowledgement is required before delivery (default yes).
- **FR-007**: System MUST let admins configure deduction types (name, rate, applies to goods /
  services / both, payable account).

**Suppliers**

- **FR-008**: System MUST let Procurement Officers maintain suppliers with the fields in User Story
  2, including bank details, categories, and dated documents.
- **FR-009**: System MUST flag expired required supplier documents and overdue vetting.
- **FR-010**: Suppliers MUST follow the statuses Pending Vetting → Approved → Suspended /
  Blacklisted; Suspended and Blacklisted require a reason; approval requires a vetting record.
- **FR-011**: Only Approved suppliers MAY be invited; only Approved suppliers with valid required
  documents and current vetting MAY be awarded or paid, unless an approved waiver covers the
  document gap. Blacklisted suppliers MUST NOT be selectable anywhere; their open POs MUST be
  flagged and their payments MUST require Finance Manager approval with a reason.
- **FR-012**: System MUST warn on duplicate registration number, tax number, phone, or bank account
  across suppliers and staff members' recorded accounts.
- **FR-013**: System MUST record a supplier rating (on time, quality, documentation; 1–5) when a PO
  or contract is fully received/completed, and show the average on the supplier.
- **FR-014**: System MUST show each supplier's history of invitations, quotations, awards, POs,
  deliveries, and payments.

**RFQ and quotations**

- **FR-015**: System MUST create RFQs only from approved PR lines of a single grant, copying line
  data and keeping the link to each PR line; descriptions MAY be reworded or grouped.
- **FR-016**: System MUST propose the required procurement method from the estimated value and
  MUST block proceeding with a lower method unless an approved waiver is linked.
- **FR-017**: System MUST require award criteria weights totalling exactly 100% and at least the
  method's minimum number of invited Approved suppliers before an RFQ can be issued, unless a
  waiver covers the shortfall in suppliers.
- **FR-018**: A PR line MUST belong to at most one open sourcing event, and PR lines MUST show their
  sourcing status (Not sourced, In RFQ/Tender, Ordered, Cancelled).
- **FR-019**: System MUST log each quotation's receipt before the deadline (supplier, received
  date/time, received by) and, only during or after the recorded opening, record its per-line
  prices and quantities, currency, delivery time, validity, payment terms, essential-criteria
  compliance, and attachment; one active quotation per supplier per RFQ, with replaced receipts
  kept in history.
- **FR-020**: Quotation and bid prices and scanned offers MUST NOT be enterable before an opening
  is recorded, and therefore not visible through any screen, list, export, print, search, or
  report; an opening MUST be recordable only after the deadline, with date, time, and at least two
  people present (three for tenders).
- **FR-021**: Quotations and bids received after the deadline MUST be marked Late and excluded
  unless (for RFQs only) the opening record accepts them with a reason.
- **FR-022**: When valid quotations after opening are fewer than the minimum, evaluation MUST
  require an approved waiver or re-issue of the RFQ (new link kept to the original).

**Analysis and award**

- **FR-023**: System MUST build the comparison table automatically, converting quotation totals to
  the RFQ currency at the opening-date rate and showing the rates used.
- **FR-024**: Committee members MUST sign a conflict-of-interest declaration before seeing prices or
  scoring; members declaring a conflict MUST be excluded; scoring MUST NOT proceed if the committee
  is below the minimum size.
- **FR-025**: Suppliers failing an essential criterion MUST be disqualified with a recorded reason.
- **FR-026**: Price score MUST be calculated as price weight × lowest valid price ÷ supplier's
  price, rounded to 2 decimals, and MUST NOT be editable; other criteria MUST be scored 1–5 by each
  member, averaged, and converted to weight × average ÷ 5; weighted totals MUST be calculated.
- **FR-027**: The highest-scoring valid supplier MUST be recommended by default; recommending
  another MUST require a justification referencing at least one published criterion before the
  analysis can be signed.
- **FR-028**: System MUST allow split award by line only when the RFQ allows it, each line to one
  supplier.
- **FR-029**: After all committee members sign, the award MUST go through DoA approval by awarded
  amount; the PR creator MUST NOT approve the award.
- **FR-030**: Before award approval, the system MUST check that the awarded amount per budget line
  fits within the PR's commitment plus Available; otherwise approval is blocked with the shortfall.
- **FR-031**: System MUST record notification of unsuccessful suppliers (date, channel).

**Purchase orders and contracts**

- **FR-032**: System MUST create POs (goods) or Contracts (services) only from an approved award,
  inheriting supplier, lines, prices, grant, budget lines, locations, and activities, which MUST NOT
  be editable; one PO/contract per awarded supplier.
- **FR-033**: POs MUST record PO date, delivery address and schedule, delivery terms, payment terms
  (advance %, retention %), currency, total, total in words (generated), and special conditions;
  contracts additionally MUST record scope/ToR, start/end dates, milestones totalling 100% of the
  contract value, and performance guarantee.
- **FR-034**: POs/contracts MUST go through DoA approval by amount; the creator MUST NOT approve.
- **FR-035**: On PO/contract approval, the PR commitment for the ordered lines MUST be replaced by
  the PO/contract commitment in grant currency at the rate locked at approval; increases MUST fit in
  Available, otherwise approval is blocked with the shortfall; decreases MUST return to Available.
- **FR-036**: System MUST record supplier acknowledgement (signed copy, date) and, when configured,
  block receipt until acknowledged.
- **FR-037**: POs MUST follow the statuses in User Story 6; a PO/contract MUST close automatically
  when fully received and fully paid, or manually with a reason, releasing any remaining
  commitment. A contract (or service PO) counts as fully completed when the certified amounts of
  its milestones (or service lines) add up to its total including approved amendments; it closes
  automatically when fully completed and fully paid.
- **FR-038**: A PR MUST close automatically when all its lines are ordered or cancelled; unsourced
  PR lines MAY be cancelled with a reason, releasing their commitment.

**Receipt and completion**

- **FR-039**: System MUST create GRNs only from approved (and, when required, acknowledged) POs,
  inheriting supplier and PO number, which MUST NOT be editable.
- **FR-040**: Accepted quantity per line MUST NOT exceed ordered − already accepted + tolerance;
  rejected quantities MUST carry a reason and MAY be recorded as returned with a date.
- **FR-041**: A GRN MUST be signed by Received By and Inspected By, who MUST be different people.
- **FR-042**: GRN lines MUST support an Asset flag.
- **FR-043**: Each contract milestone (or service PO) MUST be confirmed by a Service Completion
  Certificate with a completion percentage, signed by two different people; payable amount MUST NOT
  exceed the certified percentage of the milestone.
- **FR-044**: System MUST notify when performance guarantees or supplier documents near expiry.

**Tenders**

- **FR-045**: System MUST support tender files with lots, publication (channels, evidence),
  clarification log shared with all bidders, submission deadline, opening date/place, and bid
  security requirements.
- **FR-046**: System MUST log bids before the deadline without prices, and record prices only in an
  opening session after the deadline with ≥ 3 people present, signed by all present.
- **FR-047**: Tender evaluation MUST be two-stage (administrative/technical, then financial only for
  compliant bids) with combined weighted scores and a recommendation per lot, with the same
  declaration, signature, and approval rules as RFQ analysis.
- **FR-048**: System MUST track bid securities (amount, type, expiry, received, returned with
  date, forfeited with reason). Bid securities MUST NOT create accounting entries unless received
  as a cash deposit, in which case receipt is a receipt voucher (BRV/CRV) and return is a payment
  voucher (BPV/CPV).
- **FR-049**: A tender with no bids or no compliant bids MUST be cancellable or re-tenderable under
  a new number linked to the original.

**Waivers, amendments, cancellations**

- **FR-050**: System MUST support waivers (reason category, justification, attachments) with their
  own DoA, linked to the covered document and shown on every printout and report of that chain.
- **FR-051**: Changes to an approved PO/contract MUST be made only by a numbered, versioned
  amendment with reason and before/after values, approved by DoA on the new total, with a budget
  recheck on increases; previous versions MUST remain viewable unchanged.
- **FR-052**: System MUST allow cancellation of RFQs, tenders, POs, and contracts with a reason and
  permission, releasing exactly the commitment each holds and returning unordered PR lines to Not
  sourced.
- **FR-053**: System MUST warn the procurement officer when PRs of the same office, grant, and
  category within 30 days together exceed the next method band; the warning MUST be acknowledged
  with a comment, which is recorded.

**Invoices and payment requests**

- **FR-054**: System MUST register supplier invoices against a PO/contract and MUST block a
  duplicate invoice number for the same supplier.
- **FR-055**: Payment requests MUST be created from a PO/contract with its invoice and matching
  GRNs/certificates, inheriting payee, bank details, grant, donor, budget lines, locations, and
  activities, which MUST NOT be editable. PO/contract-based payment requests MUST NOT reserve or
  commit budget again; they consume the PO/contract commitment when the voucher is posted.
- **FR-056**: System MUST perform a three-way match per line (invoiced quantity ≤ accepted
  quantity; invoiced price ≤ PO price; within tolerance) and MUST block submission on mismatch
  unless an override is approved by a user with `payment:override_match`, with a reason.
- **FR-057**: System MUST support advance payments up to the PO/contract advance %, deduct them
  proportionally from later payments, withhold retention per terms, and release retention by a
  separate payment request.
- **FR-058**: Gross, deductions, net, amount in words (Arabic and English), and the charge-to table
  MUST be calculated, never typed; payment currency conversion MUST follow the 001 rate rules and
  store rate, date, and source.
- **FR-059**: Payment requests MUST go through DoA approval by net amount; the preparer and anyone
  who received or inspected the related goods/services MUST NOT approve.
- **FR-060**: Total paid (including approved and pending payment requests) on a PO/contract MUST NOT
  exceed its total including approved amendments, including under concurrent submissions.
- **FR-061**: Direct payment requests (no PO) MUST support payee (supplier, staff, other), category,
  period, lines (budget line, location, activity, description, amount), and attachments, with
  Reserved on submission, Committed on approval, Actual on posting.

**Accounting setup**

- **FR-062**: System MUST provide a hierarchical, bilingual chart of accounts (groups and posting
  accounts, types, active flag), seeded with a default NGO chart; accounts used in posted vouchers
  MUST NOT be deleted.
- **FR-063**: Every budget line MUST map to an expense account (default by category, overridable);
  voucher generation MUST be blocked for unmapped budget lines.
- **FR-064**: System MUST maintain bank accounts and cash boxes (name, bank, branch, number,
  currency, office, ledger account, custodian, opening balance and date) and configurable control
  accounts (staff advances, supplier advances, retention payable, withholding tax payable, grant
  funds received per grant, exchange gain/loss).
- **FR-065**: System MUST maintain monthly accounting periods (Open/Closed), MUST block posting into
  closed periods, MUST require `periods:manage` to close or reopen a period (plus a reason to
  reopen), and MUST warn with a list of
  unposted approved vouchers before closing.
- **FR-066**: System MUST import opening balances per account and per budget line (committed and
  actual to date), open POs, and prior-year posted transactions from a spreadsheet template with a
  preview reporting invalid rows; imported data MUST be marked as imported and MUST balance.

**Vouchers and posting**

- **FR-067**: System MUST generate BPV (transfer or cheque; cheque number required) or CPV vouchers
  from approved payment requests, with balanced lines as described in User Story 13.
- **FR-068**: Each voucher line MUST carry account, currency, dimensions (grant, donor, budget line,
  location, activity, contract/category), description, debit/credit, exchange rate with date and
  source, and base-currency amounts; a non-base-currency line MUST carry its own rate, and a base
  currency line MUST have rate 1.
- **FR-069**: A voucher MUST balance exactly in base currency before it can be checked.
- **FR-070**: Vouchers MUST follow Draft → Checked → Approved → Posted, with Entered by, Checked by,
  and Approved by being three different people; posting MUST require an open period.
- **FR-071**: Posting MUST make the voucher immutable, record Actual on each budget line in grant
  currency at the latest exchange rate on or before the voucher date (001 rate rules), locked at
  posting, reduce the PO/contract or direct-payment commitment by the
  matched amount, and mark the payment request Paid with the payment date.
- **FR-072**: Available MUST never become negative on any budget line as a result of POs, contracts,
  amendments, payments, advances, settlements, JVs, or allocations, including under concurrent
  actions; only actions that fit succeed.
- **FR-073**: Posted vouchers MUST be correctable only by a linked reversing voucher (which restores
  budget figures using the original rates) followed by a new voucher.
- **FR-074**: System MUST capture Received By (payee name, date) and, for cash and cheque payments,
  require a signed-copy upload.
- **FR-075**: A payment MUST be in the currency of the bank account or cash box it is paid from;
  otherwise it is blocked.

**Receipts, journals, transfers, advances, allocation, reconciliation**

- **FR-076**: System MUST support BRV/CRV receipt vouchers for donor tranches (linked to a grant),
  supplier refunds, staff advance returns, and other income.
- **FR-077**: System MUST support JVs with mandatory reason, rechecking Available on affected budget
  lines.
- **FR-078**: System MUST support bank/cash transfers, including currency conversion with the rate
  used and an automatic exchange gain/loss line.
- **FR-079**: System MUST support cash advance requests (purpose, office, expected settlement date,
  planned lines) with DoA approval, budget reservation/commitment, and payment to the staff advance
  account without recording Actual.
- **FR-080**: System MUST support advance settlement with receipts per budget line, return of unused
  amounts (CRV) or additional payment, recording Actual and clearing the advance on posting; budget
  lines lacking Available MUST block settlement.
- **FR-081**: System MUST block a new advance for a staff member with an advance overdue beyond the
  configured days unless an approved waiver is linked.
- **FR-082**: System MUST support allocation templates (percentages per grant/budget line totalling
  100%, effective dates) and apply them to posted expenses by generating a JV, rechecking
  Available.
- **FR-083**: System MUST support entering or importing bank statement lines per account and month,
  matching them to posted voucher lines, showing unreconciled items and reconciled balance, and
  signing off the month only when balanced.

**Reports, printing, lists, notifications, history**

- **FR-084**: System MUST provide the reports listed in User Story 19, exportable to PDF and Excel,
  filterable by grant, donor, office, period, and dates, in Arabic and English.
- **FR-085**: Report figures MUST equal the sum of the underlying posted and committed documents;
  the trial balance MUST balance.
- **FR-086**: From any document in the chain, users MUST be able to open the linked upstream and
  downstream documents, with attachments and signatures.
- **FR-087**: System MUST produce printable PDFs for every document in User Story 20 in Arabic and
  English with logo, number, dates, status watermark, generated amount in words, signature blocks
  from electronic approvals, and any linked waiver; the BPV layout MUST reproduce the RTHA BPV-35
  sample; RFQ prints to suppliers MUST NOT show other suppliers or prices.
- **FR-088**: System MUST extend lists with filters and search, "My tasks", in-app notifications,
  and history timelines to every new document type, with the notification events listed in User
  Story 21.

**Cross-cutting**

- **FR-089**: Every procurement document line MUST trace to a PR line; every payment line MUST trace
  to a PO/contract line or a direct payment / advance line; links are inherited at creation, never
  typed.
- **FR-090**: Grant, budget line, donor, location, and supplier MUST be inherited downstream and
  MUST NOT be changeable on GRN, invoice, payment request, or voucher.
- **FR-091**: Approved awards, POs, contracts, payment requests, and posted vouchers MUST NOT be
  edited in place; changes are amendments, cancellations, or reversals.
- **FR-092**: Every approval MUST be an electronic signature (user, position at signing, timestamp,
  comment) and MUST NOT change afterward; a user MUST NOT sign two steps of the same document.
- **FR-093**: Documents that have left Draft MUST never be deleted; every state change, signature,
  and edit MUST be recorded in history.
- **FR-094**: Document numbers MUST be unique per organization, sequential per type, office, and
  year, assigned at first submission, and never reused.
- **FR-095**: Every currency conversion MUST store rate, rate date, and source; amounts MUST be
  exact decimals with per-currency rounding; dates MUST display as DD/MM/YYYY.
- **FR-096**: New documents on a Suspended or Closed grant MUST follow the 001 freeze: no approval
  step may be signed; payments for goods already received require a Finance Manager override with
  reason.
- **FR-097**: Every new screen, printout, and report MUST be available in Arabic (right-to-left) and
  English.

### Business Rules (testable)

1. Every procurement document line traces to a PR line; every payment line traces to a PO/contract
   line or a direct payment request line; links are inherited at creation, never typed.
2. Supplier, grant, budget line, donor, and location are inherited downstream and cannot be changed
   on GRN, invoice, payment request, or voucher.
3. The required procurement method is the stricter of the organization and grant rules for the
   sourcing event's estimated value; a lower method needs an approved waiver.
4. Prices and scanned offers in quotations and bids are entered only during or after the recorded
   opening, which can only happen after the deadline; before it, only receipt is logged.
5. Price scores and weighted totals are calculated; award criteria total 100%.
6. Recommending a supplier other than the highest-scoring valid one requires a justification.
7. Committee members must sign a conflict-of-interest declaration before scoring; declared conflicts
   exclude the member; the committee must still meet the minimum size.
8. Segregation: the PR creator cannot approve the award; the PO creator cannot approve the PO; the
   receiver and inspector on a GRN are different people; whoever received, inspected, or prepared a
   payment cannot approve it; a voucher is entered, checked, and approved by three different
   people.
9. Only Approved suppliers with valid required documents can be awarded and paid (unless a waiver
   is approved for documents).
10. On PO/contract approval, the PR commitment for ordered lines is replaced by the PO commitment;
    any increase must fit Available; decreases return to Available.
11. Accepted GRN quantity ≤ ordered − already accepted (+ tolerance).
12. Invoice and payment lines must match PO price and accepted quantity within tolerance, or carry
    an approved override.
13. Total paid on a PO/contract never exceeds its total including approved amendments; advances
    never exceed the advance %.
14. Posting a payment voucher moves the amount from Committed to Actual on each budget line;
    Available never becomes negative (001 guarantee extended to POs, payments, advances, JVs).
15. Vouchers balance in base currency; every non-base-currency line stores its own rate, rate date,
    and source.
16. Posted vouchers are immutable; corrections are reversals.
17. No posting into a closed period.
18. Approved POs, contracts, and payments are never edited in place; changes are amendments,
    cancellations, or reversals.
19. Document numbers are unique per organization, sequential per type, office, and year, never
    reused.
20. Amounts in words are generated in Arabic and English and always equal the figure.
21. Cancelling any document releases exactly the commitment it holds.
22. A PR line can be in only one open sourcing event; a PR closes when all lines are ordered or
    cancelled.

### Key Entities *(include if feature involves data)*

- **Procurement Method / Band**: Method, value range in reference currency, minimum quotations;
  organization default and optional grant-specific override.
- **Tolerance & Deduction Settings**: Invoice and GRN tolerances; deduction types with rate,
  applicability, and payable account.
- **Supplier**: Vendor or payee with bilingual names, identifiers, bank details, categories,
  status, documents, vetting records, ratings, and history.
- **Supplier Document / Vetting Record / Rating**: Dated evidence attached to a supplier.
- **Sourcing Event (RFQ / Tender)**: Competitive process for PR lines of one grant: method,
  deadlines, criteria, invited suppliers or bidders, lots (tender), status; linked to PR lines.
- **Quotation / Bid**: A supplier's offer: receipt log before the deadline, then per-line prices
  (entered only at or after opening), terms,
  compliance, attachment, and version history.
- **Opening Record**: Witnessed record of opening after the deadline, with people present and late
  submissions decision.
- **Committee / Declaration / Score**: Members of an evaluation, their conflict-of-interest
  declarations, and their criterion scores.
- **Analysis & Award**: Comparison, calculated scores, recommendation, justification, signatures,
  approval, and awarded lines per supplier.
- **Waiver**: Approved deviation linked to the document it covers.
- **Purchase Order / Contract**: Obligation to one supplier with inherited lines, terms,
  milestones (contract), guarantee, acknowledgement, status, and versions.
- **Amendment**: Numbered, approved change to a PO/contract with before/after values.
- **Goods Received Note / Service Completion Certificate**: Proof of receipt or completion with
  accepted/rejected quantities or completion %, and two signatures.
- **Supplier Invoice**: Supplier's bill against a PO/contract.
- **Payment Request**: Approved instruction to pay, from a PO/contract (with match result,
  advances, retention, deductions) or direct (no PO).
- **Cash Advance / Settlement**: Money given to staff for field expenses and its justification.
- **Account (Chart of Accounts)**: Hierarchical bilingual ledger account with type.
- **Bank Account / Cash Box**: Where money is held, with currency, custodian, and ledger account.
- **Accounting Period**: Month with Open/Closed status.
- **Voucher (BPV, CPV, BRV, CRV, JV, Transfer)**: Balanced accounting document with lines,
  dimensions, rates, three signatures, status, and reversal link.
- **Voucher Line**: Account, dimensions, currency, amount, rate (date, source), base amounts.
- **Budget Movement**: Change to a budget line's Reserved, Committed, or Actual caused by a
  document, with rate used.
- **Allocation Template**: Percentage split of shared costs across grants/budget lines.
- **Bank Statement Line / Reconciliation**: Statement data matched to voucher lines per month.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The full RTHA chain — PR 0010 → RFQ → three quotations → analysis → award → PO → GRN →
  invoice → payment request → BPV posted — completes with every document linked, the supplier
  identical on all documents, and the final payment equal to 870,710.00 SDG.
- **SC-002**: 0 documents can be created downstream with a supplier, grant, or budget line different
  from their source.
- **SC-003**: 0 vouchers can be posted unbalanced, into a closed period, or with a currency label
  that contradicts its rate.
- **SC-004**: Available is never negative under concurrent POs, payments, advances, and journals
  competing for the same budget line.
- **SC-005**: Budget vs. Actual and the donor report for a grant appear in under 3 seconds for an
  organization with 5,000 PRs, 3,000 POs, and 20,000 voucher lines.
- **SC-006**: From any posted payment, an auditor reaches the PR, RFQ/tender, analysis, award, PO,
  GRN, and invoice with all signatures and attachments in at most 2 clicks per document.
- **SC-007**: 100% of printed amounts in words match the figure in both languages, including the
  BPV-35 sample (3,040,800.00 SDG).
- **SC-008**: The BPV printout reproduces every field of the RTHA BPV-35 sample.
- **SC-009**: 0 quotation or bid prices are visible to any user before the opening is recorded.
- **SC-010**: 0 documents can be approved in violation of the segregation rules (Business Rule 8).
- **SC-011**: The trial balance balances and Budget vs. Actual equals posted voucher totals for
  100% of grants and periods.
- **SC-012**: An accountant can produce a payment request and voucher from a fully received PO in
  under 5 minutes.

## Assumptions

- Builds on 001 without changing its guarantees; 001's PR states gain sourcing statuses (In
  Procurement, Closed) after Approved.
- Accounting is cash basis for donor reporting: expenses are recognized when the payment voucher is
  posted; supplier and staff advances are assets until cleared.
- One grant per sourcing event, PO, contract, and payment request (as for PRs). Multi-grant
  purchases need separate documents; shared costs use allocation (US17).
- Non-price criteria scores (1–5) convert to points as weight × average score ÷ 5.
- The opening-date rate is used to compare quotations in different currencies; the PO-approval rate
  is locked for the commitment; the latest rate on or before the voucher date, locked at
  posting, is used for Actual; any difference between the
  released commitment and the recorded Actual stays visible on the budget line.
- "Opening" for RFQs needs at least two people present; tender openings need at least three.
- Late quotations may be accepted by the opening record for RFQs only; late tender bids are never
  opened.
- Suppliers interact outside the system (email, WhatsApp, paper); there is no supplier portal and no
  automatic email to suppliers.
- Staff members' bank accounts (for duplicate checks and direct payments) are recorded on the user
  or a staff payee record; HR data beyond that is out of scope.
- Notifications remain in-app only, as in 001.
- Users have internet access; offline mode remains out of scope.
- Out of scope: inventory/stock, asset register (beyond the GRN Asset flag), payroll calculation,
  HR, framework agreements (LTAs), budget revisions requiring donor approval, automated sanctions
  screening, electronic bank integration, supplier portal, and donor-specific report layouts.
