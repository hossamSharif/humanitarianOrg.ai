# Security Contract — RLS Helpers and Permissions

**Feature**: `001-grants-pr-foundation` | Research: [../research.md](../research.md) R2–R4

## 1. SQL helpers (defined once, first migration)

| Function | Returns | Contract |
|---|---|---|
| `app.current_tenant_id()` | `uuid` or `NULL` | `auth.jwt()->'app_metadata'->>'tenant_id'` if an `active` `membership` exists for `(auth.uid(), tenant)`; else `NULL`. `STABLE SECURITY DEFINER`, `search_path = ''`. Never reads `user_metadata`. |
| `app.current_membership_id()` | `uuid` or `NULL` | active membership of `auth.uid()` in `app.current_tenant_id()`. |
| `app.has_office_access(office_id uuid)` | `boolean` | true if the current membership has `org_wide_access` or a `user_office` row for the office. |
| `app.has_permission(code text)` | `boolean` | true if any role of the current membership grants `code`. Used only where RLS must check a permission (e.g. `audit:read`); the API is the primary enforcer. |

### Policy templates (the only allowed shapes)

```sql
-- Tenant-scoped table
create policy tenant_select on <t> for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy tenant_write on <t> for all to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));

-- Office-scoped document (purchase_requisition; children join to parent)
using (tenant_id = (select app.current_tenant_id())
       and (app.has_office_access(requesting_office_id) or requester_id = auth.uid()))
```

Append-only tables (`audit_history`, `approval_action`): `select` + `insert` policies only;
`update`/`delete` revoked from `authenticated` and blocked by trigger.

A migration test (`packages/database/tests/rls-lint.test.ts`) queries `pg_policies` and fails if
any table in `public` lacks RLS, lacks a policy, or has a policy whose expression does not call
`app.current_tenant_id()`.

## 2. Transaction context (API → Postgres)

`withTenantTx(ctx, fn)` in `apps/api/src/db/tx.ts` opens a transaction and runs, before `fn`:

```sql
set local role authenticated;
select set_config('request.jwt.claims', $verified_claims_json, true);
select set_config('app.request_id', $request_id, true);
-- per action, before writes:
select set_config('app.audit_comment', $reason_or_comment, true);
```

Claims are the already-verified JWT payload from the auth middleware. The service-role key is
used only for Auth admin calls (invite, set `app_metadata`) and never for business data.

## 3. Permission catalogue (`packages/shared/src/permissions.ts`)

| Code | Meaning |
|---|---|
| `settings:manage` | organization profile, offices, units, numbering, approval rules |
| `users:manage` | invite users, assign offices/roles, suspend |
| `roles:manage` | edit roles and permission sets |
| `grants:manage` | donors, grants, grant status, budget lines, import, activities |
| `rates:manage` | exchange rates |
| `budget:read` | budget status report and drill-down |
| `pr:read` | view PRs (within office scope) |
| `pr:create` | create, edit own drafts, submit, cancel own PRs |
| `pr:finance_check` | eligible for `finance_check` steps (role on the step still required) |
| `pr:approve` | eligible for `approval` / `final_approval` steps (role on the step still required) |
| `pr:cancel_approved` | cancel approved PRs |
| `pr:reassign` | reassign pending approval steps |
| `audit:read` | read history of configuration records |

Step eligibility = holds the step's `required_role_id` **and** that role grants the step kind's
permission **and** office access **and** not the creator **and** has not signed another step of
this PR.

## 4. Seeded roles

| Role (key) | Permissions |
|---|---|
| Organization Admin (`org_admin`) | all except `pr:finance_check`, `pr:approve` |
| Requester (`requester`) | `pr:read`, `pr:create` |
| Finance Checker (`finance_checker`) | `pr:read`, `pr:finance_check`, `budget:read`, `rates:manage` |
| Approver (`approver`) | `pr:read`, `pr:approve`, `budget:read` |
| Viewer / Auditor (`viewer`) | `pr:read`, `budget:read`, `audit:read` |

## 5. API middleware order

`requestId → helmet/cors → rateLimit → auth (verify JWT) → tenant (membership + permissions +
offices loaded once per request) → idempotency → validate (Zod) → requirePermission(code) →
route → service → repository → errorHandler`.
