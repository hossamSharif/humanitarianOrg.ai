# Feature 002: Sourcing, Purchase Orders, Receipt, Payments, Accounting, and Reports

> Input for `/speckit.specify`. Paste this whole file as the argument.
> It describes WHAT and WHY. Technology belongs in `/speckit.plan` (see `docs/plan002.md`).
> Suggested branch: `002-procurement-to-payment`.

## Context

Feature 001 (`001-grants-pr-foundation`) delivered the foundation: organization, offices,
units, numbering, users, roles, Delegation of Authority (DoA) approval rules, donors, grants,
budget lines (Budget / Reserved / Committed / Actual / Available), activities, exchange rates,
and the Purchase Requisition (PR) with budget reservation, Finance Check, Final Approval,
electronic signatures, commitment, cancellation, printing, lists, notifications, and the budget
status report.

This feature completes the cycle that every donor-funded purchase follows after the PR is
approved, and the accounting that records the money:

`Approved PR → RFQ or Tender → Quotation / Bid Analysis → Award → Purchase Order or Contract →
Goods Received Note or Service Completion Certificate → Supplier Invoice → Payment Request →
Payment Voucher → Actual on the budget line`

It also adds payments that do not come from procurement (salaries, rent, per diems), cash
advances to staff and their settlement, receipts from donors, journals, and the reports donors
and auditors ask for.

Real samples from one NGO (RTHA) guide the design: an Excel workbook with the RFQ Short Form,
Quotation Analysis, Purchase Order, GRN, and Payment Request forms, and a printed Bank Payment
Voucher (BPV-35). Problems found in those samples are exactly what this feature must prevent:
a GRN pointing to a different supplier and document number than its PO; payment amounts that
differ from the PO total; an amount in words that does not match the figure; a voucher line
labelled USD with an exchange rate of 1.0000 on an SDG amount; award reasons that do not match
the published criteria; and one person requesting, evaluating, and requesting payment for the
same purchase.

Everything in 001 stays valid: the same tenants, offices, roles model, DoA engine, numbering,
exchange-rate rules, audit history, DD/MM/YYYY dates, decimal money, bilingual UI and prints.

## Roles in this feature

New default roles (editable permission sets, like 001):

| Role | What they do |
|---|---|
| Procurement Officer (often the Logistics Officer) | Maintains suppliers, issues RFQs and tenders, records quotations, prepares POs and contracts |
| Committee Member | Declares conflict of interest, scores quotations and bids, signs evaluation reports |
| Storekeeper / Receiver | Records goods received (GRN), quantities accepted and rejected |
| Technical Inspector | Confirms quality of goods or completion of services (often the requester or a program person) |
| Accountant | Registers supplier invoices, prepares payment requests and vouchers |
| Finance Manager | Checks payment requests and vouchers, manages chart of accounts, periods, bank accounts |
| Cashier | Records cash payments and receipts, holds cash boxes |
| Country Director / Authorized Signatory | Approves awards, POs, and payments above configured limits |

Roles from 001 (Organization Admin, Requester, Finance Checker, Approver, Viewer/Auditor) remain.

## User Stories

Each story is independently testable. Priorities: P1 = needed for one purchase to go from
approved PR to posted payment; P2 = needed for real operations; P3 = valuable later.

### US1 — Procurement configuration (P1)

An Organization Admin configures how the organization buys.

- **Procurement methods by value** (in the DoA reference currency, default USD): Direct Purchase
  (minimum 1 quotation), Request for Quotation (minimum 3 quotations), Open Tender. Value bands
  are configurable, e.g. ≤ 1,000 direct; 1,000–25,000 RFQ; > 25,000 tender.
- **Donor-specific rules per grant**: a grant may set stricter bands or a higher minimum number
  of quotations. When organization and grant rules differ, the stricter one applies.
- **Approval rules (DoA) for the new document types**, using the same engine as PRs (ordered
  steps, roles, amount bands, office-specific or organization-wide): Quotation/Bid Analysis award,
  Purchase Order, Contract, PO/Contract Amendment, Waiver, Payment Request, Payment Voucher,
  Receipt Voucher, Journal Voucher, Cash Advance, Advance Settlement.
- **Numbering** for each new document type, per office and calendar year, using the 001
  numbering configuration (e.g. `RFQ-MAD-2026-0004`, `PO-MAD-2026-0010`, `BPV-KST-2026-0035`).
- **Tolerances**: allowed difference between invoice and PO price/quantity (default 0%), and
  allowed over-delivery on GRN (default 0%).
- **Deductions**: configurable deductions applied on payments (e.g. withholding tax %, by goods
  or services), each mapped to a payable account.

**Acceptance**
1. Given RFQ band 1,000–25,000 USD and a grant whose donor requires RFQ from 500 USD, when an
   approved PR of 800 USD-equivalent on that grant is sourced, then the system requires an RFQ.
2. Given bands that overlap or leave a gap, when the admin saves them, then saving is blocked.
3. Given a new organization, then default methods, bands, approval rules, numbering, and
   deduction types are seeded and editable.

### US2 — Supplier registry and vetting (P1)

A Procurement Officer maintains one supplier list for the organization.

- Supplier: legal name (Arabic/English), trade name, type (company, individual, government,
  NGO), registration number, tax number, address, city, phone, email, contact person, bank
  details (bank, branch, account name, account number), categories supplied (e.g. stationery,
  food, construction, transport), notes.
- Documents with expiry dates: registration certificate, tax certificate, others. Expired
  required documents are flagged.
- **Status**: Pending Vetting → Approved → Suspended / Blacklisted (reason required). Only
  Approved suppliers can be invited, awarded, or paid.
- **Vetting record**: sanctions/terrorism list check done (date, by whom, lists checked, result,
  evidence attachment), required before first approval and repeated every N months (configurable,
  default 12). Automatic screening against external lists is out of scope.
- **Performance**: rating per completed order (on time, quality, documentation, 1–5), shown as
  an average on the supplier.
- **Duplicate prevention**: warn on same registration number, tax number, phone, or bank account.
- Supplier history: invitations, quotations, awards, POs, deliveries, payments.

**Acceptance**
1. Given a supplier with an expired registration certificate, when it is invited to an RFQ,
   then a warning shows; when it is awarded, then the award is blocked until the document is
   renewed or a waiver is approved.
2. Given a Blacklisted supplier, then it cannot be selected anywhere, and existing open POs show
   a warning.
3. Given a supplier whose bank account equals another supplier's or a staff member's recorded
   account, then a duplicate warning shows to Finance.

### US3 — Request for Quotation from approved PRs (P1)

A Procurement Officer sources approved PR lines.

- An RFQ is created from one or more **approved PRs of the same grant**; the officer selects
  which PR lines to include. Lines copy description, specifications, quantity, and unit; the
  officer may group or reword the description for suppliers but the link to each PR line is kept.
- The system proposes the procurement method from the total estimated value (US1). Using a lower
  method than required needs an approved **Waiver** (US10).
- RFQ fields: issue date, submission deadline (date and time), delivery place and time,
  quotation currency, payment terms, offer validity required, essential criteria (pass/fail, e.g.
  meets specifications, valid registration certificate, technical check), and weighted award
  criteria that must total 100% (e.g. price 50%, quality 25%, validity 25%).
- Invited suppliers: at least the method's minimum, all Approved. Invitation date and channel
  (email, WhatsApp, in person, newspaper) are recorded. The RFQ prints as a PDF to send.
- RFQ statuses: Draft → Issued → Closed (deadline passed) → Opened → Evaluated → Awarded /
  Cancelled / Re-issued.
- A PR line can be in only one open sourcing event at a time. PR lines show their sourcing
  status (Not sourced, In RFQ/Tender, Ordered, Cancelled).

**Acceptance**
1. Given an approved PR of 9 lines, when an RFQ is created from it, then all 9 lines are linked
   to their PR lines and the RFQ proposes RFQ as method based on 870,710 SDG converted to USD.
2. Given award criteria totalling 90%, when the RFQ is issued, then issuing is blocked.
3. Given a PR line already in an open RFQ, when another RFQ tries to include it, then it is not
   selectable.

### US4 — Record quotations and open them (P1)

- The officer records each quotation received: supplier, date/time received, per-line unit
  price (and quantity if different), currency, delivery time, offer validity, payment terms,
  compliance per essential criterion, and the scanned quotation as an attachment.
- **Sealed until opening**: before the deadline, quotations can be logged as received, but
  their prices are hidden from all users. After the deadline, an **opening** is recorded (date,
  time, at least two people present). Only then are prices visible.
- Quotations received after the deadline are marked Late and excluded unless the opening record
  explicitly accepts them with a reason.
- A supplier can submit one quotation per RFQ; a corrected quotation before the deadline replaces
  the previous one, and both remain in history.

**Acceptance**
1. Given an RFQ before its deadline, when any user opens a received quotation, then prices are
   not shown and the API does not return them.
2. Given fewer valid quotations than the minimum after opening, then evaluation requires either
   a waiver (US10) or re-issuing the RFQ.

### US5 — Quotation analysis, committee, and award (P1)

- The system builds the comparison table automatically: per supplier and per line, unit price,
  line total, quotation total, currency, converted totals in the RFQ currency, delivery time,
  validity, and essential-criteria compliance.
- **Committee**: at least 3 members (configurable), normally Logistics/Procurement, Finance, and
  Program/Technical. Before seeing quotations, each member signs a **conflict-of-interest
  declaration**; a member who declares a conflict with a bidder is excluded.
- **Scoring**: suppliers failing an essential criterion are disqualified with the reason.
  Price score is calculated, never typed: lowest valid price gets the full price weight, others
  get weight × lowest ÷ their price. Other criteria are scored 1–5 by each member and averaged.
  Weighted total per supplier is calculated.
- **Recommendation**: the highest-scoring valid supplier is recommended by default. Recommending
  another supplier requires a written justification **that refers to the published criteria**.
- **Split award** by line is allowed when the RFQ allows it; each line goes to one supplier.
- Members sign the analysis; then the award goes through DoA approval (by awarded amount).
- After approval: winning suppliers become awardees; unsuccessful suppliers are recorded as
  notified (date, channel).

**Acceptance**
1. Given 3 valid quotations with prices 870,710 / 910,000 / 1,020,000 and price weight 50%,
   then price scores are 50.00 / 47.84 / 42.68 (2 decimals) and cannot be edited.
2. Given a committee member who created the PR, then they may sit on the committee but cannot
   approve the award (segregation).
3. Given the recommended supplier is not the highest score and the justification is empty, then
   the analysis cannot be signed.

### US6 — Purchase Order from the award (P1)

- A PO is created from an approved award: supplier, lines with awarded prices, linked RFQ lines
  and PR lines, grant, budget lines, locations, activities (inherited, not retyped).
- PO fields: PO date, delivery address and schedule, delivery terms, payment terms (including
  advance % and retention % if any), currency, total and total in words, special conditions.
- **Budget**: on PO approval, the PR's commitment for the ordered lines is replaced by the PO's
  commitment at the PO amount (converted to grant currency with the rate locked at PO approval).
  If the PO amount is higher than the PR's committed amount, the difference must fit in Available,
  otherwise approval is blocked with the shortfall. If lower, the difference returns to Available.
- DoA approval by amount; the creator cannot approve.
- **Supplier acknowledgement**: the signed PO from the supplier is uploaded with the date.
  Delivery can be recorded only after acknowledgement (configurable).
- PO statuses: Draft → Pending Approval → Approved → Acknowledged → Partially Received → Fully
  Received → Closed; or Cancelled. A PO closes when fully received and fully paid, or manually
  with a reason, which releases any remaining commitment.
- A PR closes automatically when all its lines are ordered or cancelled; unsourced lines can be
  cancelled with a reason, releasing their commitment.

**Acceptance**
1. Given the RTHA award of 870,710 SDG on budget line 10202, when the PO is approved, then line
   10202 shows the PR commitment replaced by the PO commitment, and Available is unchanged if the
   amounts are equal.
2. Given a PO whose supplier differs from the award, then it cannot be created (supplier is
   inherited, not editable).

### US7 — Goods Received Note (P1)

- A GRN is created from an approved (and acknowledged) PO: received date, supplier delivery note
  number, supplier invoice number (optional), shipment type (Partial / Final), and per line:
  quantity delivered, accepted, rejected with reason, and condition remarks.
- Accepted quantity cannot exceed ordered minus already accepted (plus the over-delivery
  tolerance). Supplier and PO number are inherited and cannot be changed.
- Signatures: Received By (storekeeper/receiver) and Inspected By (technical inspector or
  requester). The receiver and inspector must be different people.
- **Returns to supplier**: rejected quantities are recorded as returned with date; the supplier
  may redeliver on a later GRN.
- Supplier rating (US2) is captured when the PO is fully received.
- Receiving goods into stock and asset tagging are out of scope (inventory/asset add-on), but each
  GRN line can be flagged **Asset** for the future register.

**Acceptance**
1. Given a PO for 100 pieces, when a GRN accepts 60 and a second GRN accepts 50, then the second
   is blocked (only 40 remain, tolerance 0%).
2. Given a GRN, then it always shows the PO's supplier and number; no field allows another.

### US8 — Service contracts, milestones, and completion certificates (P2)

- For services (construction, consultants, transport, catering), the award produces a
  **Contract** instead of a PO: scope / Terms of Reference attachment, start and end date,
  milestones (deliverable, amount or % of total, due date), advance %, retention %, performance
  guarantee (type, amount, expiry).
- Each milestone is confirmed by a **Service Completion Certificate** signed by the requester or
  program focal person and a second confirmer; partial completion is recorded as a percentage.
- Contracts follow the same budget rule as POs (US6).
- Small one-off services (e.g. meals for a training: 80 persons × 16,775 SDG) may use a PO with
  unit "Person" and a single completion certificate.
- Guarantees nearing expiry (configurable, default 30 days) appear in notifications.

### US9 — Open tenders (P2)

For purchases above the tender band.

- **Tender file**: tender number, title, lots (each lot = group of PR lines), publication date,
  publication channels (newspaper, website, notice board) with evidence attachment, tender
  documents, clarification deadline, submission deadline, opening date/place, bid security
  requirement (amount or %, type, validity).
- **Clarifications**: questions from bidders and answers, shared with all bidders (log with dates).
- **Bid receipt log** before the deadline: bidder, date/time, received by, bid security
  received. No prices are recorded before opening.
- **Bid opening session** after the deadline: opening committee (≥ 3 present), each bid's
  price(s) read out and recorded, bid security checked, opening record signed by all present.
- **Evaluation** in two stages: administrative/technical (pass/fail and scores) then financial
  only for technically compliant bids; combined score with configured weights; recommendation per
  lot; committee signatures; conflict-of-interest declarations as in US5; DoA approval.
- **Bid securities**: returned to unsuccessful bidders (date) and to the winner after contract
  signature; forfeited with reason.
- **Failure paths**: no bids or no compliant bids → cancel or re-tender (new number, link kept).

**Acceptance**
1. Given a tender before its deadline, then no user can enter or see prices.
2. Given a bid received after the deadline, then it is logged as Late and cannot be opened.

### US10 — Waivers, amendments, and cancellations (P2)

- **Waiver**: deviation from the required method or minimum quotations (single source,
  emergency, fewer quotations received, expired supplier document). Fields: reason category,
  written justification, attachments. Approved through its own DoA (normally one level higher).
  The waiver is linked to the sourcing event and shown on all printouts and reports.
- **PO/Contract amendment**: change quantity, price, delivery date, or milestones after approval.
  Creates a numbered amendment with version, reason, and before/after values; goes through DoA
  approval by the new total; budget is rechecked for any increase. The approved PO is never edited
  in place.
- **Cancellation** of RFQ, tender, PO, or contract with reason and permission; releases
  commitments; history kept.
- **Anti-splitting warning**: when several PRs from the same office and grant for similar items
  (same category) within 30 days together exceed the next method band, the procurement officer
  sees a warning that must be acknowledged with a comment (not a block).

### US11 — Supplier invoices and payment requests (P1)

- **Supplier invoice**: registered against a PO or contract: invoice number, date, amount,
  currency, lines (quantity × price), attachment. Duplicate invoice number per supplier is blocked.
- **Payment Request** is created from the PO/contract with the invoice and the matching GRN(s) or
  completion certificate(s). It inherits payee, bank details, budget lines, grant, donor,
  locations, and activities.
- **Three-way match**: for each line, invoiced quantity ≤ accepted quantity (GRN) and invoiced
  price ≤ PO price, within tolerance (US1). Mismatches block submission unless a user with
  `payment:override_match` approves an override with a reason.
- **Advance payment** against a PO/contract allowed up to its advance %; later payments deduct the
  advance proportionally.
- **Retention** withheld per contract terms; released by a separate payment request after the
  retention period.
- **Deductions** (US1) calculated automatically (e.g. withholding tax), shown on the request.
- Fields: payment method (bank transfer, cheque, bank draft, cash), payment currency (may differ
  from PO currency, converted with the rate rules of 001), gross, deductions, net, amount in words,
  "charge as follows" table (budget line, grant/project, location, activity, donor, amount) —
  calculated, never typed.
- DoA approval by net amount; the person who received or inspected the goods cannot approve the
  payment; the preparer cannot approve it.
- The total paid on a PO can never exceed the PO total (plus approved amendments).

**Acceptance**
1. Given the RTHA PO of 870,710 SDG fully received, when a payment request is created, then gross
   is 870,710.00 SDG, the words read "Eight Hundred Seventy Thousand Seven Hundred Ten Sudanese
   Pounds" (and the Arabic equivalent), and no field allows typing a different amount.
2. Given an invoice of 900,000 for a PO of 870,710 with 0% tolerance, then submission is blocked
   unless an override is approved.

### US12 — Chart of accounts, bank and cash accounts, periods (P1)

- **Chart of accounts**: hierarchical (groups and posting accounts), code, bilingual name, type
  (asset, liability, fund balance, income, expense), active flag. A default NGO chart is seeded and
  editable; accounts used in posted vouchers cannot be deleted.
- **Mapping budget lines to accounts**: each budget line has an expense account (default by
  category, overridable per line). Organizations that use donor line codes as account codes (e.g.
  RTHA `10102` Field Supervision Officer) can create matching accounts.
- **Bank accounts and cash boxes**: name, bank, branch, account number, currency, office,
  linked GL account, custodian (for cash), opening balance and date.
- **Control accounts**: staff advances, supplier advances, retention payable, withholding tax
  payable, grant funds received (per grant), exchange gain/loss — configurable.
- **Accounting periods**: monthly, Open / Closed. No posting into a closed period; reopening needs
  `periods:manage` and a reason.
- **Opening data import**: opening balances per account and per budget line (committed and actual
  to date), open POs, and the previous year's posted transactions, from an Excel import template
  with a preview that reports invalid rows (same pattern as 001 budget-line import). Imported
  transactions are marked as imported and balanced like any voucher.

### US13 — Payment vouchers and posting (P1)

- A **Payment Voucher** is generated from an approved payment request: **BPV** (bank: transfer,
  cheque — cheque number required) or **CPV** (cash box). Lines are generated and balanced:
  debit expense (per budget line, with grant, donor, budget line, location, activity, contract/
  category dimensions), debit supplier advance or clear it, credit bank/cash for the net, credit
  deductions and retention payable.
- Each line shows account code and name, currency, donor, contract/category, description, debit,
  credit, exchange rate, and base-currency debit/credit, like the RTHA BPV form. The voucher must
  balance in base currency. A line's currency label must match its amount: a non-base currency
  line requires its own rate, so "USD with rate 1.0000 on an SDG amount" is impossible.
- Statuses: Draft → Checked → Approved → Posted. Entered by, Checked by, Approved by must be three
  different people. Posting requires an open period.
- **Posting** makes the voucher immutable, records **Actual** on each budget line (amount in grant
  currency with the rate locked at posting), reduces the PO/contract commitment by the matched
  amount, and marks the payment request Paid with payment date (the "PAID" stamp now always has a
  date).
- **Received By**: payee name and date captured; signed copy upload for cash and cheques.
- Corrections only by **reversal**: a reversing voucher linked to the original, then a new voucher.

**Acceptance**
1. Given the posted RTHA payment of 870,710 SDG on budget line 10202, then the budget status shows
   Actual increased by the grant-currency amount and Committed decreased by the same matched amount.
2. Given a voucher whose debits and credits differ by 0.01 in base currency, then it cannot be
   checked.
3. Given a posted voucher, then no field can be edited; only a reversal is possible.

### US14 — Receipts, journals, transfers, and exchange (P2)

- **Receipt vouchers**: BRV (bank) and CRV (cash): donor tranche received (linked to a grant;
  credits grant funds received), refunds from suppliers, staff returns of unused advances, other
  income.
- **Journal voucher (JV)**: adjustments and reclassifications between budget lines or grants,
  with mandatory reason; budget lines affected are rechecked for Available.
- **Bank/cash transfers** between accounts, including currency conversion (e.g. USD account to SDG
  account) with the rate used and automatic exchange gain/loss line.
- Grant funding summary: budget, tranches received, expenses (actual), fund balance (received −
  spent).

### US15 — Direct payment requests (no PO) (P2)

For payments that are not purchases: salaries and allowances, rent, utilities, per diems,
transport refunds, tax remittances.

- Payee (supplier, staff member, or other), category, period (e.g. salary September), lines with
  budget line, location, activity, description, amount, attachments (contract, timesheet,
  invoice).
- Budget: reserved on submission, committed on approval, actual on posting — the same lifecycle as
  PRs.
- DoA approval; creates BPV/CPV like US13. Example to support: BPV-35, salary of the Field
  Supervision Officer for September, 3,040,800.00 SDG, account 10102, donor ADRA, cheque 35, Blue
  Nile Mashreq Bank – White Nile, amount in words "Three Million Forty Thousand Eight Hundred
  Sudanese Pounds".
- Payroll calculation is out of scope; the salary amount is entered per person.

### US16 — Cash advances and settlement (P2)

- **Advance request** by a staff member for field expenses: purpose, office, expected settlement
  date, planned lines (budget line, amount). Approved through DoA; reserved/committed on the budget
  lines like a PR; paid through CPV/BPV to the staff advance account (not an expense).
- **Settlement**: staff submit receipts per budget line (attachments), the unused amount is
  returned (CRV) or an additional amount is paid. On posting, expenses become Actual and the
  advance balance clears.
- A staff member cannot receive a new advance while one is overdue beyond the configured days
  (default 30) unless a waiver is approved.
- Outstanding advances report by person, age, and amount.

### US17 — Shared cost allocation (P3)

- Allocation templates for shared costs (rent, utilities, shared staff): percentage per grant /
  budget line, effective dates, total 100%.
- Applying a template to a posted expense creates a JV that moves the cost to the grants' budget
  lines, rechecking Available on each.

### US18 — Bank reconciliation (P3)

- Enter or import (CSV/Excel) bank statement lines per bank account and month; match them to posted
  voucher lines; mark cleared; show unreconciled items and the reconciled balance; sign off the
  month.

### US19 — Reports (P1 for the first three, P2 for the rest)

All exportable to PDF and Excel, filtered by grant, donor, office, period, and dates, in Arabic
and English, with DD/MM/YYYY dates.

1. **Budget vs. Actual per grant** (P1): per budget line in donor codes: budget, reserved,
   committed, actual (period and cumulative), available, % used, burn rate.
2. **Donor financial report export** (P1): per grant and reporting period: budget line code,
   description, budget, actual previous periods, actual this period, cumulative, balance, % —
   in grant currency, with the exchange rates used listed. Donor-specific custom layouts are
   customizations, out of scope.
3. **Procurement register** (P1): every sourcing event with PR, method, waiver, RFQ/tender, number
   of quotations, awarded supplier, PO/contract, amounts, GRN, invoice, payment, dates, and cycle
   time — the list auditors request first.
4. Open commitments (PRs, POs, contracts not fully paid).
5. Supplier history and payments per supplier.
6. General ledger, account statement, trial balance.
7. Bank book and cash book per account with running balance.
8. Outstanding advances and ageing.
9. Grant funding summary (received vs. spent vs. budget).
10. **Document trail**: from any document (payment, voucher, GRN, PO, award, RFQ, PR) open the
    full chain in both directions with all attachments and signatures.

### US20 — Printing (P2)

Every approvable document prints as a PDF matching the organization's form, in Arabic and English,
with logo, number, dates, status watermark, amount in words, and signature blocks filled from the
electronic approvals: RFQ (to suppliers), Quotation/Bid Analysis, Bid Opening Record, PO, Contract
summary, Amendment, GRN, Service Completion Certificate, Waiver, Payment Request, Payment Voucher
(BPV/CPV layout as in the RTHA sample, with "PAID" and payment date when posted), Receipt Voucher,
Journal Voucher, Advance and Settlement.

### US21 — Lists, My tasks, notifications, history (P2)

Extend the 001 patterns to every new document type: lists with filters and search, "My tasks"
across all documents awaiting the user's action, in-app notifications (action required, approved,
rejected, returned, deadline reached, guarantee or document expiring, advance overdue), and the
history timeline on every document.

## Business Rules (testable)

1. Every procurement document line traces to a PR line; every payment line traces to a PO/contract
   line or a direct payment request line; links are inherited at creation, never typed.
2. Supplier, grant, budget line, donor, and location are inherited downstream and cannot be changed
   on GRN, invoice, payment request, or voucher.
3. The required procurement method is the stricter of the organization and grant rules for the
   sourcing event's estimated value; a lower method needs an approved waiver.
4. Prices in quotations and bids are not visible to anyone before the recorded opening, which can
   only happen after the deadline.
5. Price scores and weighted totals are calculated; award criteria total 100%.
6. Recommending a supplier other than the highest-scoring valid one requires a justification.
7. Committee members must sign a conflict-of-interest declaration before scoring; declared
   conflicts exclude the member; the committee must still meet the minimum size.
8. Segregation: the PR creator cannot approve the award; the PO creator cannot approve the PO; the
   receiver and inspector on a GRN are different people; whoever received, inspected, or prepared a
   payment cannot approve it; voucher entered/checked/approved by three different people.
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

## Edge Cases

- Fewer valid quotations than required → waiver or re-issue; the waiver appears on every printout.
- All quotations exceed the PR budget → award blocked by budget check unless the PR budget line has
  enough Available or a budget-line change is approved by Finance.
- Quotations in different currencies → compared in the RFQ currency with the opening-date rate,
  shown with the rates used.
- Supplier blacklisted after PO approval → open PO flagged; payments require Finance Manager
  approval with reason.
- Partial delivery then PO closed short → remaining commitment released.
- Invoice in USD for an SDG PO → payment request converts with rate rules; differences against the
  PO beyond tolerance need override.
- Payment in a different currency from the bank account currency → blocked; use a transfer (US14)
  first.
- Voucher posted to the wrong budget line → reversal + new voucher, or JV reclassification with
  reason.
- Period closed with unposted approved vouchers → warning listing them before closing.
- Advance settled with receipts on a budget line without enough Available → settlement blocked
  until Finance moves the expense to another line.
- Grant suspended or closed → the 001 freeze applies to all new documents on that grant: no approval
  steps can be signed; payments for already-received goods require Finance Manager override.
- Tender cancelled after opening → bid securities returned; reason recorded.

## Success Criteria

- **SC-001**: The full RTHA chain — PR 0010 → RFQ → three quotations → analysis → award → PO →
  GRN → invoice → payment request → BPV posted — completes with every document linked, the supplier
  identical on all documents, and the final payment equal to 870,710.00 SDG.
- **SC-002**: 0 documents can be created downstream with a supplier, grant, or budget line different
  from their source.
- **SC-003**: 0 vouchers can be posted unbalanced, into a closed period, or with a currency label
  that contradicts its rate.
- **SC-004**: Available is never negative under concurrent POs, payments, advances, and journals
  competing for the same budget line.
- **SC-005**: Budget vs. Actual and the donor report for a grant load in under 3 seconds for an
  organization with 5,000 PRs, 3,000 POs, and 20,000 voucher lines.
- **SC-006**: From any posted payment, an auditor reaches the PR, RFQ/tender, analysis, award, PO,
  GRN, and invoice with all signatures and attachments in at most 2 clicks per document.
- **SC-007**: 100% of printed amounts in words match the figure in both languages, including the
  BPV-35 sample (3,040,800.00 SDG).
- **SC-008**: The BPV printout reproduces every field of the RTHA BPV-35 sample.

## Assumptions

- Builds on 001 without changing its guarantees; 001's PR states gain sourcing statuses
  (In Procurement, Closed) after Approved.
- Accounting is cash basis for donor reporting: expenses are recognized when the payment voucher is
  posted; supplier and staff advances are assets until cleared.
- One grant per sourcing event, PO, and payment request (as for PRs). Multi-grant purchases need
  separate documents; shared costs use allocation (US17).
- Suppliers interact outside the system (email, WhatsApp, paper); there is no supplier portal and no
  automatic email to suppliers in this feature.
- Users have internet access; offline mode remains out of scope.
- Inventory/stock, asset register, payroll calculation, HR, framework agreements (LTAs), budget
  revisions requiring donor approval, automated sanctions screening, electronic bank integration,
  and donor-specific report layouts are out of scope (future add-ons or customizations).