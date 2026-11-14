# Print Contract — Purchase Requisition PDF

**Feature**: `001-grants-pr-foundation` | Spec: US7, FR-045 | Research: R13–R15

Rendered with @react-pdf/renderer in `apps/web/src/features/pr/print/` from
`GET /api/v1/prs/:id/print`. Two templates share one data shape: `ar` (RTL) and `en` (LTR).
The layout mirrors the RTHA paper PR form (sheet "PR" in `RTHA Procurement Forms _091811.xlsx`);
field order below is the acceptance checklist for SC-005.

## Data shape (`PrPrintData`, Zod schema in `packages/shared`)

```text
organization: { nameAr, nameEn, logoUrl, address, phone, email }
document:     { number, status, watermark: null|'DRAFT'|'PENDING'|'REJECTED'|'CANCELLED',
                printedAt (instant), locale }
header:       { prDate, requiredByDate, requestingOffice{code,name}, grant{code,name},
                donor{name, shortName}, deliverTo{name}, deliveryAddress, contactName,
                contactPhone, activity{code,name}|null, prType, purpose }
lines[]:      { lineNo, description, specifications, quantity, unit{code,name}, unitCost,
                lineTotal, currency, donorShortName, budgetLocation{code,name},
                budgetLineCode }
totals[]:     { currency, amount, amountInWordsAr, amountInWordsEn }   // one per line currency
grantTotal:   { currency, amount, rates: [{ currency, rateToBase, rateDate, source }] } | null
signatures:   { requestedBy, financeCheck, finalApproval }
              each: { name, position, signedAt } | null
```

Label source: non-draft PRs build `organization`, `header` and `lines[]` labels (names, codes,
logo) from `purchase_requisition.print_snapshot`; drafts use live data. Config edits after
submission therefore never change an approved PR's printout (Principle VI).

## Layout (A4 portrait, 15 mm margins)

| Zone | Content |
|---|---|
| Header band | logo (start side), organization name ar + en, form title "طلب شراء / Purchase Requisition", PR number, status watermark (diagonal, 40% grey) when `watermark` ≠ null |
| Info grid | PR date, required-by date, requesting office, project/grant (code — name), donor, deliver to, delivery address, contact name & phone, activity, type, purpose |
| Item table | No · Description (+ specifications in smaller text) · Qty · Unit · Unit cost · Total · Donor · Budget location · Donor budget line. Repeats header row on page break |
| Totals | total per currency, total in words (locale language; the other language beneath in smaller text), grant-currency equivalent with rate/date/source when currencies differ |
| Signature blocks | three boxes: Requested By · Finance Check · Final Approval — name, position at signing, date; empty boxes show lines for wet signature |
| Footer | PR number · printed DD/MM/YYYY HH:mm · page x / y |

## Rules

- All dates via the shared formatter → `DD/MM/YYYY`; Latin digits in both templates.
- Amounts: thousands separator `,`, 2 decimals, currency code after amount.
- Amount in words comes only from `packages/shared` `amountInWords()`; never from user input.
- Arabic template: `direction: rtl`, table column order mirrored, numbers and codes
  (`PR-MAD-2026-0010`, `10202`) kept LTR inside RTL runs.
- Fonts: IBM Plex Sans Arabic (ar), IBM Plex Sans (en), embedded.
- Watermark mapping: `draft`, `returned` → DRAFT; `pending_*` → PENDING; `rejected` → REJECTED;
  `cancelled` → CANCELLED; `approved` → none.
