# Plan Input — Feature 001

> Input for `/speckit.plan` (after `/speckit.clarify`). Paste as the argument.

Use the same stack and conventions as the existing GvsErp-AI project
(branch `001-modular-erp-saas`), with the changes listed below.

## Stack (reuse)

- **Monorepo**: pnpm 8 workspaces + Turborepo, Node 20, TypeScript 5 strict.
  Packages: `apps/web`, `apps/api`, `packages/shared`, `packages/database`,
  `packages/ui`.
- **API**: Express 4, Zod, helmet, cors, express-rate-limit, tsup build,
  Vitest tests. Layers: routes → services → repositories. Middleware: request
  id, auth (Supabase JWT), tenant context, permission check, validation,
  idempotency, audit, central error handler. REST under `/api/v1`.
- **Database**: Supabase Postgres + Supabase Auth + Supabase Storage (PR
  attachments). RLS on every tenant table. DB triggers for audit history and
  `updated_at`. Server-side document number sequences.
- **Web**: Next.js 14 App Router with `[locale]` routing (`ar`, `en`),
  next-intl, shadcn/ui (Radix) + Tailwind, lucide-react, TanStack Query,
  TanStack Table (+ Virtual for long lists), React Hook Form + Zod, Zustand
  for UI state and draft autosave, @react-pdf/renderer for PDF prints.
- **Code style**: Prettier (single quotes, semicolons, width 100), ESLint with
  @typescript-eslint, `resource:action` permission constants in
  `packages/shared`.
- **Deploy**: web on Vercel, API on Fly.io via Docker.

## Changes from GvsErp-AI

- **No offline layer** in this feature: no Dexie, outbox, or Serwist service worker.
- **No Stripe** / subscriptions.
- **RLS tenant identity** from `app_metadata.tenant_id` (set only by the server)
  or a `memberships` table, through ONE helper SQL function used by all policies.
  Never `user_metadata`.
- **Money** columns are `numeric(18,2)`; exchange rates `numeric(18,6)`.
- **Dates** rendered with a single shared formatter: `DD/MM/YYYY`.
- **Arabic default locale** (`ar`), English secondary; Arabic font Cairo or
  IBM Plex Sans Arabic.
- **Brand theme**: own primary color instead of default shadcn blue
  (to be decided; keep it as a CSS variable).
- **Amount in words** helper (Arabic + English) in `packages/shared`.
- **Concurrency**: budget availability check and commitment run inside a
  single database transaction (or RPC with row locks on budget lines) to
  prevent two PRs consuming the same budget.

## Key entities (guidance for data-model)

tenant, membership, office, unit_of_measure, numbering_config, donor, grant,
grant_office, budget_line, activity, exchange_rate, role, permission,
user_role, user_office, approval_rule, approval_rule_step,
purchase_requisition, pr_line, pr_attachment, approval_action (signature),
budget_commitment, audit_history, notification.

## Testing

- Service-level unit tests for each business rule in the spec (1–12).
- API integration tests for the PR state machine.
- One end-to-end acceptance test using the RTHA PR 0010 sample, verified in
  Arabic (RTL) and English with Chrome DevTools MCP.