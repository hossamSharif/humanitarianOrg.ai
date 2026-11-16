# Prepared Answers for `/speckit.clarify` — Feature 002

Use these when `/speckit.clarify` asks. Answers marked **(confirm with NGO)** are sensible
defaults that are configurable anyway; confirm the real values with the organization's
procurement manual and finance team when you can.

| Likely question | Answer |
|---|---|
| Can one RFQ combine lines from several approved PRs? | Yes, if all PRs use the same grant. Each RFQ line keeps its PR line link. |
| Can one PO cover several grants? | No. One grant per sourcing event, PO, contract, and payment request, like PRs. |
| Default procurement bands? **(confirm with NGO)** | Direct ≤ 1,000 USD-equivalent (1 quotation); RFQ > 1,000 to 25,000 (3 quotations); Tender > 25,000. Configurable per organization and per grant; stricter applies. |
| Minimum committee size? | 3 members, configurable (minimum 2). |
| Can the PR requester sit on the evaluation committee? | Yes (often the technical member), but cannot approve the award. |
| How is the price score calculated? | Lowest valid price gets the full price weight; others get weight × lowest ÷ their price; 2 decimals. |
| How are non-price criteria scored? | 1–5 per member per criterion, averaged across members, scaled to the criterion weight. |
| Are split awards (different suppliers per line) allowed? | Yes, when the RFQ or tender allows it; each line to one supplier; one PO per supplier. |
| When does the commitment move from PR to PO? | At PO approval, at the PO amount with the rate locked at that moment. |
| Invoice/PO price and GRN over-delivery tolerance? **(confirm with NGO)** | 0% default for both, configurable; mismatches need an override with `payment:override_match`. |
| Is supplier acknowledgement required before receiving? | Yes by default, configurable per organization. |
| Accounting basis? | Cash basis by default: expense at voucher posting; supplier and staff advances are assets until cleared. |
| Which rate is used for Actual in grant currency? | Latest rate on or before the voucher date, locked at posting (001 rate rules). |
| Do approved payment requests reserve budget again? | No for PO-based payments (the PO already holds the commitment). Direct payments and advances reserve on submission, commit on approval. |
| Withholding tax rates? **(confirm with NGO and accountant)** | Configurable deduction types with a percentage per goods/services; default list empty except one example "Withholding tax" at 0% until configured. |
| Retention release? | A separate payment request after the contract's retention period, approved by DoA. |
| Advance overdue days? **(confirm with NGO)** | 30 days, configurable; new advances blocked while overdue unless a waiver is approved. |
| Vetting renewal period? | 12 months, configurable. |
| Who can close an accounting period? | Users with `periods:manage` (Finance Manager); reopening requires a reason. |
| Can a voucher pay from a bank account in a different currency than the payment? | No; transfer/convert between accounts first (TRF voucher with exchange gain/loss). |
| Are suppliers notified by email from the system? | No; RFQs and notices are printed or downloaded and sent outside the system; the invitation date and channel are recorded. |
| Bid security handling? | Tracked (amount, type, expiry, returned, forfeited); no accounting entry unless it is a cash deposit, then BRV/CPV. |
| Donor report format? | One generic donor report (budget line code, budget, previous, this period, cumulative, balance, %); donor-specific layouts are paid customizations. |
| Can old (pre-system) transactions be imported? | Yes: opening balances per budget line (committed and actual to date) and the previous year's posted transactions via an import template, as committed in the proposal. |
| What happens to 001's PR status after approval? | New statuses `in_procurement` (at least one line in an open sourcing event or PO) and `closed` (all lines ordered or cancelled). |