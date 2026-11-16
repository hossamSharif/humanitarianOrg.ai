# Print Contract — 002 documents

**Feature**: `002-procurement-to-payment` | Base: [001 PR print contract](../../001-grants-pr-foundation/contracts/print-layout.md) | Research: D9

## Shared kit

`apps/web/src/features/print-kit/` is extracted from `features/pr/print/` without changing the
PR output. It provides:

- `fonts.ts`: IBM Plex Sans Arabic and IBM Plex Sans;
- `styles.ts`;
- `<DocHeader>`: logo, organization ar/en, title, number, office/region line;
- `<InfoGrid>`;
- `<ItemTable>` with a repeat header on page break, and `row-reverse` in `ar`;
- `<Totals>` with amount in words in the locale language and the other language beneath;
- `<SignatureBlocks>` from `doc_signature`: name, position at signing, DD/MM/YYYY date, and
  wet-signature lines when empty;
- `<Watermark>`;
- `<PaidStamp>`;
- `<WaiverBadge>`;
- `<Footer>`: number, printed DD/MM/YYYY HH:mm, page x/y.

Every Arabic `Text` carries `direction: 'rtl'` (001 R13 result).

Every `/…/:id/print` response shares the envelope:

```text
organization: { nameAr, nameEn, shortName, logoUrl, address, phone, email }
document:     { docType, number, status, watermark: null|'DRAFT'|'PENDING'|'REJECTED'|'CANCELLED'|'REVERSED',
                printedAt, locale, officeName }
waivers:      [{ number, reasonCategory, approvedAt }]   // from the trail (FR-050); [] for RFQ-to-supplier
signatures:   { <blockKey>: { name, position, signedAt } | null }
```

Labels come from the document's `print_snapshot` once it is approved or posted. Drafts use
live data. The watermark mapping follows 001 (draft/returned → DRAFT, pending → PENDING), plus
REVERSED for reversed vouchers.

## Templates and their specific data

| Template | Body data | Signature blocks |
|---|---|---|
| RFQ to supplier (`rfq/print`) | event header (number, issue date, deadline date+time, delivery place/time, currency, validity, payment terms, split allowed), lines (no, description, specs, qty, unit), essential criteria, weighted criteria with %, addressee supplier (one per print). **Schema excludes** offers, other suppliers, prices (US20-2) | issued by |
| Quotation / Bid Analysis | comparison table per supplier × line (unit, total), totals in the event currency with the rates used, compliance, scores (price points computed, criteria averages, weighted totals), recommendation, justification + criteria referenced, waiver | each committee member; approval steps |
| Bid Opening Record | event, date/time/place, attendees, bids read out (supplier, price per lot, security), late bids | each attendee |
| Purchase Order (RTHA sheet "Purchase Order") | PO no, date, deliver to + phone + contact, supplier info, delivery/payment terms, lines (item no, description, qty, unit, unit price, total, donor, budget location, donor budget line), sub-total, total, words, version | Requested By · Finance Check · Authorized By · Supplier Acknowledgement |
| Contract summary | parties, scope, dates, value, milestones table, advance/retention, guarantee | authorized signatories |
| Amendment | PO number, version from → to, reason, before/after table, new total + words | approval steps |
| GRN (RTHA sheet "GRN") | date, supplier name (inherited), delivery note no, invoice no, PR no, PO no, office, donor, activity, shipment type; lines: item, description, unit, qty ordered, delivered, accepted, rejected + reason, remarks, asset flag | Received By · Inspected By (· Delivered By name, external) |
| Service Completion Certificate | contract/PO, milestone, period, completion %, certified amount + words | Certified By · Confirmed By |
| Waiver | category, justification, covered document, value | requested by; approval steps |
| Payment Request (RTHA sheet "Payment Request") | method checkboxes (cash, cheque, bank draft, transfer), currency, amount (net), words, details, payee + bank details, match result/override, gross/deductions/retention/advance/net, **charge as follows** table (account line, project code, location, activity, donor, amount) | Requested By · Verified By (finance check) · Approved By |
| **Payment Voucher BPV/CPV** | see below | Entered By · Checked By · Approved By · Received By |
| Receipt Voucher BRV/CRV | same frame as BPV, "Received From" instead of Payee | Entered · Checked · Approved · Received By (cashier) |
| Journal Voucher | lines table, reason | Entered · Checked · Approved |
| Cash Advance / Settlement | payee, purpose, lines per budget line, expected settlement date; settlement: receipts, return/additional | requester · approvals · cashier |

## BPV/CPV layout (acceptance checklist for SC-008, from the BPV-35 sample)

| Zone | Content |
|---|---|
| Header | logo (start side), organization name (large), rule line |
| Title | "Bank Payment Voucher (BPV)" / "Cash Payment Voucher (CPV)" (ar: "سند صرف بنكي" / "سند صرف نقدي"); office/region line (e.g. "Gazira") |
| Info | Project (grant name), Document No., Document date, Payee, Cheque No. (BPV cheque), Amount (net, 2 dp), Currency, Amount In Char. (generated words) |
| Table | No · A/c No. · Account Name · Cur · Donor · Contract · Description · Debit · Credit · Rate (4 dp display) · Dr (base) · Cr (base); Total row = Σ Dr = Σ Cr base |
| Stamp | when posted: "PAID BY {organization short name}" box **with Date = posting/payment date** (never blank) |
| Signatures | Entered By (name), Checked By, Approved By, Received By (payee name + received date; signed copy reference) |
| Footer | Print date DD/MM/YYYY · page x / y |

Rules: Rate shows the line's own `rate_to_base`. A non-base line can never show 1.0000 because
the DB check forbids it.
