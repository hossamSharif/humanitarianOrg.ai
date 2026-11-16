# Constitution Amendment for Feature 002 (v1.1.0 → v1.2.0)

> Input for `/speckit.constitution`. Run it BEFORE `/speckit.specify` for feature 002.
> Paste everything below the line as the argument.

---

Amend the existing constitution (do not rewrite unrelated principles). Bump the version to 1.2.0
(minor: new principle and expanded guidance). Add a Sync Impact Report.

## Add Principle XI. Accounting Integrity

- Every voucher balances in the base currency before it can be checked; enforced by a database
  constraint, not only by the UI or API.
- Posted vouchers and their lines are immutable. Corrections are made only by a linked reversal
  voucher followed by a new voucher.
- No posting into a closed accounting period. Reopening a period requires a dedicated permission
  and a reason, and is audited.
- Every voucher line in a currency other than the base currency stores its own exchange rate, rate
  date, and source. A currency label that contradicts its rate is invalid.
- Budget-line Actual is derived only from posted voucher lines. It is never typed or edited.
- Expense recognition follows the organization's configured basis (cash basis by default).

**Rationale**: Donor audits rely on a ledger that cannot be silently changed. The real vouchers
analyzed contained a USD label with a 1.0000 rate on an SDG amount and an amount in words that
did not match the figure.

## Expand existing principles

- **Principle II (Segregation)**: add that segregation rules are defined per document type in one
  place and include: PR creator cannot approve the award; document creator cannot approve it;
  goods receiver and inspector are different people; whoever received, inspected, or prepared a
  payment cannot approve it; voucher entered, checked, and approved by three different people;
  committee members sign a conflict-of-interest declaration before scoring.
- **Principle III (Fund Integrity)**: the Available ≥ 0 guarantee covers every document that holds
  or consumes budget (PRs, POs, contracts, amendments, direct payments, advances, journals), under
  concurrency.
- **Principle VII (Linkage)**: downstream documents inherit supplier, grant, budget line, donor,
  and location from their source; these fields cannot be changed downstream. Quotation and bid
  prices are not readable by anyone before the recorded opening.

## Development Workflow

- Add: refactors of existing tables must keep all earlier features' tests green; a feature's first
  implementation phase ends with a regression gate.