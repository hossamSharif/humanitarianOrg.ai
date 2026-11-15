-- 0005 — purchase requisitions and cross-cutting tables (data-model §4–5), their guard triggers,
-- the balance views and list/search indexes.
--
-- Drafts are saved incomplete (POST /prs takes an optional header and optional lines), so header
-- and line fields that the submit check requires are nullable while status = 'draft'. The
-- `purchase_requisition_submitted_complete` check enforces the header once a PR leaves draft;
-- line completeness is a submit rule in the PR service.

-- ---------------------------------------------------------------------------------------------
-- purchase_requisition
-- ---------------------------------------------------------------------------------------------

create table public.purchase_requisition (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_finance_check', 'pending_approval', 'approved', 'returned', 'rejected',
    'cancelled'
  )),
  version integer not null default 1,

  pr_date date,
  requesting_office_id uuid references public.office (id) on delete restrict,
  grant_id uuid references public."grant" (id) on delete restrict,
  deliver_to_office_id uuid references public.office (id) on delete restrict,
  delivery_address text,
  contact_name text,
  contact_phone text,
  required_by_date date,
  activity_id uuid references public.activity (id) on delete restrict,
  purpose text,
  pr_type text check (pr_type in ('goods', 'services', 'mixed')),

  requester_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  requester_name text,
  requester_position text,
  print_snapshot jsonb,

  submission_cycle smallint not null default 0 check (submission_cycle >= 0),
  current_step_order smallint,

  -- locked at submission (FR-028)
  doa_currency char(3) references public.currency (code) on delete restrict,
  doa_amount numeric(18, 2),
  doa_rate_to_base numeric(18, 6),
  doa_rate_date date,
  doa_rate_source text,
  doa_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  grant_rate_to_base numeric(18, 6),
  grant_rate_date date,
  grant_rate_source text,
  grant_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  total_grant_currency numeric(18, 2),

  submitted_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  reject_reason text,
  return_reason text,
  cancelled_by uuid references auth.users (id) on delete restrict,
  rejected_by uuid references auth.users (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),

  unique (tenant_id, number),
  constraint purchase_requisition_number_after_draft check (status = 'draft' or number is not null),
  constraint purchase_requisition_submitted_complete check (
    status = 'draft' or (
      pr_date is not null
      and requesting_office_id is not null
      and grant_id is not null
      and deliver_to_office_id is not null
      and pr_type is not null
    )
  )
);

create index purchase_requisition_tenant_status_idx
  on public.purchase_requisition (tenant_id, status);
create index purchase_requisition_tenant_office_idx
  on public.purchase_requisition (tenant_id, requesting_office_id);
create index purchase_requisition_tenant_grant_idx
  on public.purchase_requisition (tenant_id, grant_id);
create index purchase_requisition_tenant_date_idx
  on public.purchase_requisition (tenant_id, pr_date);
create index purchase_requisition_requester_idx on public.purchase_requisition (requester_id);
create index purchase_requisition_requesting_office_idx
  on public.purchase_requisition (requesting_office_id);
create index purchase_requisition_deliver_to_idx
  on public.purchase_requisition (deliver_to_office_id);
create index purchase_requisition_grant_idx on public.purchase_requisition (grant_id);
create index purchase_requisition_activity_idx on public.purchase_requisition (activity_id);
create index purchase_requisition_doa_rate_idx
  on public.purchase_requisition (doa_exchange_rate_id);
create index purchase_requisition_grant_rate_idx
  on public.purchase_requisition (grant_exchange_rate_id);
create index purchase_requisition_number_trgm_idx
  on public.purchase_requisition using gin (number extensions.gin_trgm_ops);

-- Office-scoped document (contracts/rls-and-permissions.md §1): office access, or own PRs.
alter table public.purchase_requisition enable row level security;

create policy tenant_select on public.purchase_requisition for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (app.has_office_access(requesting_office_id) or requester_id = (select auth.uid()))
  );
create policy tenant_insert on public.purchase_requisition for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and (app.has_office_access(requesting_office_id) or requester_id = (select auth.uid()))
  );
create policy tenant_update on public.purchase_requisition for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (app.has_office_access(requesting_office_id) or requester_id = (select auth.uid()))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (app.has_office_access(requesting_office_id) or requester_id = (select auth.uid()))
  );
create policy tenant_delete on public.purchase_requisition for delete to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (app.has_office_access(requesting_office_id) or requester_id = (select auth.uid()))
  );

create trigger touch_updated_at before update on public.purchase_requisition
  for each row execute function app.touch_updated_at();
create trigger bump_version before update on public.purchase_requisition
  for each row execute function app.bump_version();

-- ---------------------------------------------------------------------------------------------
-- Children of a PR: tenant check plus a join to the parent, whose own RLS applies the office
-- scope.
-- ---------------------------------------------------------------------------------------------

create or replace function app.setup_pr_child_table(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_expr constant text :=
    'tenant_id = (select app.current_tenant_id()) and exists ('
    'select 1 from public.purchase_requisition p where p.id = pr_id)';
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy tenant_select on %s for select to authenticated using (%s)', p_table, v_expr);
  execute format(
    'create policy tenant_insert on %s for insert to authenticated with check (%s)',
    p_table, v_expr);
  execute format(
    'create policy tenant_update on %s for update to authenticated using (%s) with check (%s)',
    p_table, v_expr, v_expr);
  execute format(
    'create policy tenant_delete on %s for delete to authenticated using (%s)', p_table, v_expr);

  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = p_table and attname = 'updated_at' and not attisdropped
  ) then
    execute format(
      'create trigger touch_updated_at before update on %s '
      'for each row execute function app.touch_updated_at()', p_table);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- pr_line
-- ---------------------------------------------------------------------------------------------

create table public.pr_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  pr_id uuid not null references public.purchase_requisition (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  description text,
  specifications text,
  quantity numeric(18, 3) check (quantity > 0),
  unit_id uuid references public.unit_of_measure (id) on delete restrict,
  unit_cost numeric(18, 2) check (unit_cost >= 0),
  line_total numeric(18, 2) generated always as (round(quantity * unit_cost, 2)) stored,
  currency char(3) not null references public.currency (code) on delete restrict,
  budget_line_id uuid references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  -- locked at submission (null while draft; 1 / pr_date / 'base' for the base currency)
  rate_to_base numeric(18, 6),
  rate_date date,
  rate_source text,
  exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  amount_grant numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  -- deferrable so a draft save can renumber lines in one statement
  constraint pr_line_pr_line_no_key unique (pr_id, line_no) deferrable initially immediate
);

create index pr_line_tenant_id_idx on public.pr_line (tenant_id);
create index pr_line_budget_line_idx on public.pr_line (budget_line_id);
create index pr_line_unit_idx on public.pr_line (unit_id);
create index pr_line_location_office_idx on public.pr_line (location_office_id);
create index pr_line_activity_idx on public.pr_line (activity_id);
create index pr_line_exchange_rate_idx on public.pr_line (exchange_rate_id);
create index pr_line_currency_idx on public.pr_line (currency);
create index pr_line_description_trgm_idx
  on public.pr_line using gin (description extensions.gin_trgm_ops);

select app.setup_pr_child_table('public.pr_line');

-- ---------------------------------------------------------------------------------------------
-- pr_attachment (research R11)
-- ---------------------------------------------------------------------------------------------

create table public.pr_attachment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  pr_id uuid not null references public.purchase_requisition (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  uploaded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index pr_attachment_pr_idx on public.pr_attachment (pr_id) where deleted_at is null;
create index pr_attachment_pr_id_idx on public.pr_attachment (pr_id);
create index pr_attachment_tenant_id_idx on public.pr_attachment (tenant_id);
create index pr_attachment_uploaded_by_idx on public.pr_attachment (uploaded_by);

select app.setup_pr_child_table('public.pr_attachment');

-- ---------------------------------------------------------------------------------------------
-- pr_approval_step: the resolved route for one submission cycle
-- ---------------------------------------------------------------------------------------------

create table public.pr_approval_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  pr_id uuid not null references public.purchase_requisition (id) on delete restrict,
  cycle smallint not null check (cycle >= 1),
  step_order smallint not null check (step_order >= 1),
  kind text not null check (kind in ('finance_check', 'approval', 'final_approval')),
  required_role_id uuid not null references public.role (id) on delete restrict,
  -- provenance; rule steps are replaced when a rule is edited, so the link may become null
  rule_step_id uuid references public.approval_rule_step (id) on delete set null,
  assigned_user_id uuid references auth.users (id) on delete restrict,
  status text not null default 'waiting' check (status in (
    'waiting', 'pending', 'approved', 'rejected', 'returned', 'cancelled'
  )),
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (pr_id, cycle, step_order)
);

create index pr_approval_step_tenant_status_idx
  on public.pr_approval_step (tenant_id, status);
create index pr_approval_step_role_idx on public.pr_approval_step (required_role_id);
create index pr_approval_step_rule_step_idx on public.pr_approval_step (rule_step_id);
create index pr_approval_step_assigned_idx on public.pr_approval_step (assigned_user_id);

select app.setup_pr_child_table('public.pr_approval_step');

-- ---------------------------------------------------------------------------------------------
-- approval_action: electronic signatures and other actions — append-only (FR-031)
-- ---------------------------------------------------------------------------------------------

create table public.approval_action (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  pr_id uuid not null references public.purchase_requisition (id) on delete restrict,
  step_id uuid references public.pr_approval_step (id) on delete restrict,
  cycle smallint not null check (cycle >= 1),
  step_order smallint,
  action text not null check (action in (
    'submit', 'approve', 'reject', 'return', 'cancel', 'reassign', 'change_budget_line'
  )),
  user_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  user_name text not null,
  user_position text,
  comment text,
  payload jsonb,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint approval_action_reason_required check (
    action not in ('reject', 'return', 'cancel', 'reassign')
    or (comment is not null and btrim(comment) <> '')
  )
);

-- one signature per user per submission cycle (FR-032 backstop)
create unique index approval_action_one_signature_per_cycle
  on public.approval_action (pr_id, cycle, user_id) where action = 'approve';
create index approval_action_pr_idx on public.approval_action (pr_id, acted_at);
create index approval_action_tenant_id_idx on public.approval_action (tenant_id);
create index approval_action_step_idx on public.approval_action (step_id);
create index approval_action_user_idx on public.approval_action (user_id);

alter table public.approval_action enable row level security;
create policy tenant_select on public.approval_action for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and exists (select 1 from public.purchase_requisition p where p.id = pr_id)
  );
create policy tenant_insert on public.approval_action for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and user_id = (select auth.uid())
    and exists (select 1 from public.purchase_requisition p where p.id = pr_id)
  );
revoke update, delete, truncate on public.approval_action from anon, authenticated;

create or replace function app.block_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger approval_action_append_only
  before update or delete on public.approval_action
  for each row execute function app.block_modification();

-- ---------------------------------------------------------------------------------------------
-- budget_commitment: reservation → commitment → release, per PR × budget line × cycle (R5)
-- Tenant-scoped (not office-scoped): budget figures are organization-wide.
-- ---------------------------------------------------------------------------------------------

create table public.budget_commitment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  pr_id uuid not null references public.purchase_requisition (id) on delete restrict,
  cycle smallint not null check (cycle >= 1),
  amount numeric(18, 2) not null check (amount > 0),
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  release_reason text check (release_reason in (
    'returned', 'rejected', 'cancelled', 'budget_line_changed'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (pr_id, budget_line_id, cycle),
  constraint budget_commitment_release_reason
    check ((status = 'released') = (release_reason is not null and released_at is not null))
);

create index budget_commitment_open_idx
  on public.budget_commitment (budget_line_id) where status in ('reserved', 'committed');
create index budget_commitment_budget_line_idx on public.budget_commitment (budget_line_id);
create index budget_commitment_tenant_id_idx on public.budget_commitment (tenant_id);

select app.setup_tenant_table('public.budget_commitment');

-- ---------------------------------------------------------------------------------------------
-- notification (R16) — readable only by its recipient; inserted by the acting user's transaction
-- ---------------------------------------------------------------------------------------------

create table public.notification (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'pr_action_required', 'pr_approved', 'pr_rejected', 'pr_returned', 'pr_cancelled',
    'pr_reassigned'
  )),
  pr_id uuid not null references public.purchase_requisition (id) on delete cascade,
  params jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_user_idx on public.notification (user_id, created_at desc);
create index notification_unread_idx on public.notification (user_id) where read_at is null;
create index notification_tenant_id_idx on public.notification (tenant_id);
create index notification_pr_idx on public.notification (pr_id);

alter table public.notification enable row level security;
create policy tenant_select on public.notification for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));
create policy tenant_insert on public.notification for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy tenant_update on public.notification for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()))
  with check (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));
revoke delete, truncate on public.notification from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- idempotency_key — stored responses for Idempotency-Key replays (24 h)
-- ---------------------------------------------------------------------------------------------

create table public.idempotency_key (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (length(key) between 1 and 255),
  request_hash text not null,
  status_code smallint not null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, key)
);

create index idempotency_key_created_at_idx on public.idempotency_key (created_at);
create index idempotency_key_user_idx on public.idempotency_key (user_id);

alter table public.idempotency_key enable row level security;
create policy tenant_select on public.idempotency_key for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));
create policy tenant_insert on public.idempotency_key for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));
create policy tenant_delete on public.idempotency_key for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));

-- =============================================================================================
-- Guard triggers (T019)
-- =============================================================================================

-- (a) FR-023: a line's budget line and activity belong to the PR's grant.
create or replace function app.pr_line_same_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pr_grant uuid;
begin
  if new.budget_line_id is null and new.activity_id is null then
    return new;
  end if;

  select p.grant_id into v_pr_grant
  from public.purchase_requisition p
  where p.id = new.pr_id;

  if new.budget_line_id is not null and not exists (
    select 1 from public.budget_line b
    where b.id = new.budget_line_id and b.grant_id is not distinct from v_pr_grant
  ) then
    raise exception 'PR_LINE_GRANT_MISMATCH'
      using errcode = 'check_violation',
            detail = 'The budget line does not belong to the grant of the purchase requisition.';
  end if;

  if new.activity_id is not null and not exists (
    select 1 from public.activity a
    where a.id = new.activity_id and a.grant_id is not distinct from v_pr_grant
  ) then
    raise exception 'PR_LINE_GRANT_MISMATCH'
      using errcode = 'check_violation',
            detail = 'The activity does not belong to the grant of the purchase requisition.';
  end if;

  return new;
end;
$$;

create trigger pr_line_same_grant
  before insert or update of budget_line_id, activity_id, pr_id on public.pr_line
  for each row execute function app.pr_line_same_grant();

-- (a') the same rule seen from the header: changing the PR's grant must not orphan lines, and the
-- header activity belongs to the grant.
create or replace function app.pr_grant_matches_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.pr_line l
    left join public.budget_line b on b.id = l.budget_line_id
    left join public.activity a on a.id = l.activity_id
    where l.pr_id = new.id
      and (
        (l.budget_line_id is not null and b.grant_id is distinct from new.grant_id)
        or (l.activity_id is not null and a.grant_id is distinct from new.grant_id)
      )
  ) or (
    new.activity_id is not null and not exists (
      select 1 from public.activity a
      where a.id = new.activity_id and a.grant_id is not distinct from new.grant_id
    )
  ) then
    raise exception 'PR_LINE_GRANT_MISMATCH'
      using errcode = 'check_violation',
            detail = 'Budget lines and activities must belong to the grant of the purchase requisition.';
  end if;
  return new;
end;
$$;

create trigger pr_grant_matches_lines
  before insert or update of grant_id, activity_id on public.purchase_requisition
  for each row execute function app.pr_grant_matches_lines();

-- (b) FR-043: only never-submitted drafts can be deleted.
create or replace function app.pr_delete_only_unsubmitted_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' or old.number is not null then
    raise exception 'INVALID_STATE'
      using errcode = 'restrict_violation',
            detail = 'Only a draft that was never submitted can be deleted.';
  end if;
  return old;
end;
$$;

create trigger pr_delete_only_unsubmitted_draft
  before delete on public.purchase_requisition
  for each row execute function app.pr_delete_only_unsubmitted_draft();

-- (c) FR-002: an office code is immutable once any PR references the office.
create or replace function app.office_code_immutable_when_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code and (
    exists (
      select 1 from public.purchase_requisition p
      where p.requesting_office_id = old.id or p.deliver_to_office_id = old.id
    )
    or exists (select 1 from public.pr_line l where l.location_office_id = old.id)
  ) then
    raise exception 'OFFICE_CODE_IN_USE'
      using errcode = 'restrict_violation',
            detail = 'The office is referenced by purchase requisitions; its code cannot change.';
  end if;
  return new;
end;
$$;

create trigger office_code_immutable_when_used
  before update of code on public.office
  for each row execute function app.office_code_immutable_when_used();

-- (d) FR-037 / SC-003: Available never goes negative. Deferred so a transaction can move a
-- reservation between lines; the PR service checks first under row locks and explains shortfalls.
create or replace function app.budget_commitment_available_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget numeric(18, 2);
  v_used numeric(18, 2);
begin
  select b.budget_amount into v_budget
  from public.budget_line b
  where b.id = new.budget_line_id;

  select coalesce(sum(c.amount), 0) into v_used
  from public.budget_commitment c
  where c.budget_line_id = new.budget_line_id
    and c.status in ('reserved', 'committed');

  if v_used > v_budget then
    raise exception 'BUDGET_EXCEEDED'
      using errcode = 'check_violation',
            detail = format('budget_line_id=%s budget=%s used=%s', new.budget_line_id, v_budget, v_used);
  end if;
  return null;
end;
$$;

create constraint trigger budget_commitment_available_guard
  after insert or update on public.budget_commitment
  deferrable initially deferred
  for each row execute function app.budget_commitment_available_guard();

-- (f2) FR-015: a rate used by any PR is locked; corrections are new rows.
create or replace function app.exchange_rate_locked_when_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pr_line l where l.exchange_rate_id = old.id)
    or exists (
      select 1 from public.purchase_requisition p
      where p.doa_exchange_rate_id = old.id or p.grant_exchange_rate_id = old.id
    )
  then
    raise exception 'EXCHANGE_RATE_IN_USE'
      using errcode = 'restrict_violation',
            detail = 'The rate is used by a purchase requisition; enter a corrected rate instead.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger exchange_rate_locked_when_used
  before update or delete on public.exchange_rate
  for each row execute function app.exchange_rate_locked_when_used();

-- =============================================================================================
-- Views (security_invoker: the caller's RLS applies)
-- =============================================================================================

-- (e) Budget / Reserved / Committed / Actual / Available (research R5; actual = 0 until Payments)
create view public.budget_line_balance
with (security_invoker = true)
as
select
  b.id as budget_line_id,
  b.grant_id,
  b.tenant_id,
  b.budget_amount as budget,
  coalesce(c.reserved, 0)::numeric(18, 2) as reserved,
  coalesce(c.committed, 0)::numeric(18, 2) as committed,
  0::numeric(18, 2) as actual,
  (b.budget_amount - coalesce(c.reserved, 0) - coalesce(c.committed, 0))::numeric(18, 2)
    as available,
  round(
    (coalesce(c.reserved, 0) + coalesce(c.committed, 0)) / nullif(b.budget_amount, 0) * 100, 2
  ) as pct_used
from public.budget_line b
left join lateral (
  select
    sum(bc.amount) filter (where bc.status = 'reserved') as reserved,
    sum(bc.amount) filter (where bc.status = 'committed') as committed
  from public.budget_commitment bc
  where bc.budget_line_id = b.id
    and bc.status in ('reserved', 'committed')
) c on true;

-- (f) Grant totals: budget lines total, difference to the grant amount (FR-013), pending PRs
-- (FR-022).
create view public.grant_summary
with (security_invoker = true)
as
select
  g.id as grant_id,
  g.tenant_id,
  g.total_amount,
  coalesce(bl.total, 0)::numeric(18, 2) as budget_lines_total,
  (g.total_amount - coalesce(bl.total, 0))::numeric(18, 2) as difference,
  coalesce(pr.pending, 0)::integer as pending_pr_count
from public."grant" g
left join lateral (
  select sum(b.budget_amount) as total
  from public.budget_line b
  where b.grant_id = g.id
) bl on true
left join lateral (
  select count(*) as pending
  from public.purchase_requisition p
  where p.grant_id = g.id
    and p.status in ('pending_finance_check', 'pending_approval')
) pr on true;

grant select on public.budget_line_balance, public.grant_summary to authenticated;
revoke all on public.budget_line_balance, public.grant_summary from anon;
