# Quickstart & Validation Guide

**Feature**: `001-grants-pr-foundation` | Plan: [plan.md](./plan.md)

How to run the feature locally and prove it works end to end. Endpoint details live in
[contracts/rest-api.md](./contracts/rest-api.md); tables in [data-model.md](./data-model.md).

## Prerequisites

- Node 20 LTS, pnpm 8.15 (`corepack enable`), Docker Desktop (for local Supabase).
- Supabase CLI ≥ 1.200 (`npx supabase --version`).
- **Before `/speckit-implement`**: confirm Supabase MCP (migrations, type generation) and Ref MCP
  are configured, and Chrome DevTools MCP connects (it timed out during planning). Until Supabase
  MCP is available, the Supabase CLI is the fallback for applying migrations (research R20).
- **Tooling gate (T013, re-checked 2026-11-15 — passed)**:

  | Need | Preferred | Fallback | Status |
  |---|---|---|---|
  | Apply migrations, generate types | Supabase MCP | Supabase CLI + `pnpm --filter @ngo/database migrate` (applies `packages/database/migrations/*.sql` via the `postgres` driver and records them in `supabase_migrations.schema_migrations`) | **Supabase MCP (chosen)** against the cloud dev project `humanitairianOrg` (ref `wahbjvvdzqkncbdggpfb`, Postgres 17). Migrations 0001–0008 applied with `apply_migration` (recorded as timestamp versions named `0001_helpers_rls`…; `migrate.ts` treats either form as applied); types from `generate_typescript_types`. The project signs tokens with **ES256** (JWKS), so the API leaves `SUPABASE_JWT_SECRET` empty and verifies via `/auth/v1/.well-known/jwks.json` |
  | UI verification, screenshots | Chrome DevTools MCP | Playwright (`@playwright/test` screenshots) | **Chrome DevTools MCP (chosen)**: connects; page snapshots and DOM checks work, screenshots are slow (some time out) — Playwright remains the fallback |

  Machine notes: Node 26 is installed (the plan targets Node 20; `.nvmrc` pins 20). pnpm is not
  installed globally and Node 26 ships without corepack; run `npx pnpm@8.15.9 <cmd>` or
  `npm i -g pnpm@8.15.9`. The Supabase CLI is not a workspace dependency (its binary download is large); scripts call it with `npx -y supabase@2`.
- Copy `.env.example` → `.env.local` in `apps/api` and `apps/web`; fill values printed by
  `supabase start`. No secrets are committed.

| Variable | Used by |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | api, web (`NEXT_PUBLIC_*` in web) |
| `SUPABASE_SERVICE_ROLE_KEY` | api only (Auth admin calls) |
| `DATABASE_URL` | api (`postgres` driver, `prepare: false`); cloud: **session pooler** `aws-1-eu-west-1.pooler.supabase.com:5432`, user `postgres.<ref>` — the transaction pooler (6543) hung on pipelined queries and the direct `db.<ref>` host is IPv6-only |
| `SUPABASE_JWT_SECRET` | api (token verification) |
| `API_BASE_URL` | web |

## Setup

```bash
pnpm install
npx supabase start                      # local Postgres, Auth, Storage
pnpm --filter @ngo/database migrate     # applies packages/database/migrations/*.sql
pnpm --filter @ngo/database gen:types   # regenerates DB types
pnpm --filter @ngo/database seed:demo   # demo tenant "RTHA" (see below)
pnpm dev                                # web :3000, api :4000
```

`seed:demo` creates: tenant RTHA (base SDG, DoA reference USD); offices MAD (Madani), KST
(Kosti), GDF (Gadaref), PSD (Port Sudan); donor ADRA; grant in USD operating in MAD with budget
line `10202`; an SDG↔USD rate dated before the sample PR date; users `requester@`, `finance@`,
`approver@`, `kosti-viewer@`, `admin@` (password printed by the script); PR sequence for
MAD/2026 set to 9 so the next PR is `PR-MAD-2026-0010`.

## Automated checks

```bash
pnpm lint && pnpm type-check
pnpm --filter @ngo/shared test          # money, conversion, amount-in-words, date formatter
pnpm --filter @ngo/api test:unit        # business rules 1–12 + clarified rules
pnpm --filter @ngo/api test:integration # needs `supabase start`; state machine, RLS, concurrency
pnpm --filter @ngo/database test        # RLS lint: every table uses app.current_tenant_id()
pnpm --filter @ngo/web e2e              # Playwright, RTHA PR 0010 in ar and en
```

Expected: all green. Key integration suites and what they prove:

| Suite | Proves |
|---|---|
| `pr-state-machine.int.test.ts` | every transition in data-model §6 via HTTP, including invalid ones → `409 INVALID_STATE` |
| `budget-concurrency.int.test.ts` | 10 parallel submits for the last available budget → exactly one `200`, others `422 BUDGET_EXCEEDED`; `available` never < 0 (SC-003) |
| `numbering.int.test.ts` | parallel submits get distinct consecutive numbers; cancelled numbers not reused; deleted drafts leave no gaps (SC-007) |
| `rls-isolation.int.test.ts` | tenant A cannot read/write tenant B rows; Kosti-only user sees only Kosti PRs (FR-006, FR-018) |
| `segregation.int.test.ts` | creator cannot approve; finance signer cannot sign final step (FR-032) |
| `frozen-grant.int.test.ts` | suspended grant blocks approve, allows return/reject/cancel, keeps reservation (FR-022) |
| `locked-rates.int.test.ts` | rate edited after submission does not change amounts; resubmission refreshes (FR-028) |
| `budget-report.perf.test.ts` | 5,000 seeded PRs → report < 2 s (SC-004) |

## Manual acceptance — RTHA PR 0010 (SC-005)

Transcribe the 9 lines of the sample from sheet "PR" of `RTHA Procurement Forms _091811.xlsx`
into `apps/web/e2e/fixtures/rtha-pr-0010.json` (the e2e test uses the same fixture). Total must
be **870,710 SDG**, all lines on budget line `10202`, donor ADRA, office Madani.

1. Sign in as `requester@` (Arabic UI, RTL). New PR → office MAD, grant (ADRA), enter the 9 lines.
   Close the tab mid-entry and reopen: the draft is restored (autosave).
2. Submit → status **Pending Finance Check**, number **PR-MAD-2026-0010**; budget line 10202
   shows Reserved = PR total in USD and Available reduced by the same amount.
3. Sign in as `finance@` → *My tasks* shows the PR and a notification → Approve.
4. Try to approve as `requester@` (if given the approver role): actions are absent; API returns
   `403 SEGREGATION_OF_DUTIES`.
5. Sign in as `approver@` → Approve → status **Approved**; Reserved → Committed, Available
   unchanged; requester receives a notification.
6. Print in Arabic and English: every field matches the paper form ([contracts/print-layout.md](./contracts/print-layout.md));
   three signature blocks show name, position, DD/MM/YYYY date; total in words reads the exact
   amount in both languages; no watermark.
7. Budget status report for the grant: line 10202 Committed = this PR; drill-down lists it;
   export to Excel and PDF.
8. Switch the UI to English (LTR) and repeat steps 6–7; capture screenshots in both locales with
   Chrome DevTools MCP.

## Negative checks (spot)

- Submit with a line currency that has no rate → `EXCHANGE_RATE_MISSING`, message to contact Finance.
- Reduce budget line 10202 below Reserved + Committed → blocked with the minimum allowed.
- Change office code MAD after the PR exists → blocked (`OFFICE_CODE_IN_USE`).
- Suspend the grant with a PR pending → warning with pending count; approve blocked; return works
  and releases the reservation.
- Import a budget spreadsheet with one bad category row → preview lists the row and reason;
  commit creates only valid rows; codes like `2.2.31` and `010` stay exactly as typed.
- Submit a PR dated tomorrow, or 31 days ago → `PR_DATE_OUT_OF_RANGE`.
- Edit the SDG→USD rate used by the submitted sample PR → `EXCHANGE_RATE_IN_USE`; enter a
  corrected rate for the same date instead → later submissions use it.
