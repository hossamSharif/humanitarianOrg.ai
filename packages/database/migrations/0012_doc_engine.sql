-- 0012 — generic document engine (002 data-model §1, research D1, D7, R30, R31).
--
-- One approval/signature store keyed by (doc_type, doc_id) replaces the PR-only tables. PR rows
-- are copied with their ids, the old tables are dropped and auto-updatable compatibility views
-- keep the 001 names and columns, so 001 SQL (`insert into approval_action (…, pr_id, …)`) and
-- supabase-js `.from('pr_approval_step')` keep working unchanged. Numbering, approval rules,
-- notifications and the audit trail are widened to every registered document type.
--
-- Also here: the generic attachment table and bucket, the "delete only before submission"
-- trigger function every document-creating migration attaches, and the tenant seed hooks.
-- Seed hooks run lazily (app.ensure_tenant_seeds) and as a backfill in the migration that
-- registers them, never inside POST /tenants, so a new organization keeps the 001 seed shape.

-- =============================================================================================
-- Registry (global reference, changes only through migrations)
-- =============================================================================================

-- DoA route types: the values approval_rule.doc_type may take. Voucher kinds share routes
-- (PV = BPV, CPV, TRF; RV = BRV, CRV).
create table app.doa_type (
  code text primary key
);

insert into app.doa_type (code) values
  ('PR'), ('AWARD'), ('PO'), ('CON'), ('AMD'), ('WAIVER'), ('PAY'), ('DPR'), ('PV'), ('RV'),
  ('JV'), ('ADV'), ('STL');

-- One row per document type. `table_name` and `office_column` are filled by the migration that
-- creates the parent table (null until then: such a type cannot carry steps or attachments yet).
-- `numbered_on_creation`: GRN, SCC and INV get their number when created (no DoA route).
create table app.doc_type_registry (
  code text primary key,
  table_name regclass,
  office_column text,
  approval_doc_type text references app.doa_type (code),
  numbered_on_creation boolean not null default false,
  constraint doc_type_registry_parent_complete
    check ((table_name is null) = (office_column is null))
);

insert into app.doc_type_registry
  (code, table_name, office_column, approval_doc_type, numbered_on_creation)
values
  ('PR', 'public.purchase_requisition', 'requesting_office_id', 'PR', false),
  ('RFQ', null, null, null, false),
  ('TND', null, null, null, false),
  ('QA', null, null, 'AWARD', false),
  ('WVR', null, null, 'WAIVER', false),
  ('PO', null, null, 'PO', false),
  ('CON', null, null, 'CON', false),
  ('AMD', null, null, 'AMD', false),
  ('GRN', null, null, null, true),
  ('SCC', null, null, null, true),
  ('INV', null, null, null, true),
  ('PAY', null, null, 'PAY', false),
  ('DPR', null, null, 'DPR', false),
  ('ADV', null, null, 'ADV', false),
  ('STL', null, null, 'STL', false),
  ('BPV', null, null, 'PV', false),
  ('CPV', null, null, 'PV', false),
  ('BRV', null, null, 'RV', false),
  ('CRV', null, null, 'RV', false),
  ('JV', null, null, 'JV', false),
  ('TRF', null, null, 'PV', false);

revoke all on app.doa_type, app.doc_type_registry from public, anon;
grant select on app.doa_type, app.doc_type_registry to authenticated, service_role;

-- =============================================================================================
-- Helpers
-- =============================================================================================

-- The parent row exists in the caller's tenant and the caller has access to its office (the
-- registry's office column). PRs keep the 001 rule: office access, or the caller's own PR.
create or replace function app.can_read_doc(p_doc_type text, p_doc_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table regclass;
  v_office_column text;
  v_tenant uuid;
  v_office uuid;
begin
  if p_doc_id is null then
    return false;
  end if;

  if p_doc_type = 'PR' then
    return exists (
      select 1 from public.purchase_requisition p
      where p.id = p_doc_id
        and p.tenant_id = app.current_tenant_id()
        and (app.has_office_access(p.requesting_office_id) or p.requester_id = auth.uid())
    );
  end if;

  select r.table_name, r.office_column into v_table, v_office_column
  from app.doc_type_registry r
  where r.code = p_doc_type;
  if v_table is null then
    return false;
  end if;

  execute format('select t.tenant_id, t.%I from %s t where t.id = $1', v_office_column, v_table)
    into v_tenant, v_office
    using p_doc_id;

  return v_tenant is not null
    and v_tenant = app.current_tenant_id()
    and app.has_office_access(v_office);
end;
$$;

-- Storage paths carry the doc id as text; a malformed segment simply matches nothing.
create or replace function app.can_read_doc_path(p_doc_type text, p_doc_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_doc_id is null
    or p_doc_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.can_read_doc(p_doc_type, p_doc_id::uuid);
end;
$$;

-- BEFORE INSERT on rows keyed by (doc_type, doc_id): the parent exists in the row's tenant.
-- doc_id cannot carry a foreign key to many parents, so this trigger stands in for one.
create or replace function app.doc_ref_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table regclass;
  v_found boolean;
begin
  select r.table_name into v_table
  from app.doc_type_registry r
  where r.code = new.doc_type;

  if v_table is not null then
    execute format('select exists (select 1 from %s t where t.id = $1 and t.tenant_id = $2)',
                   v_table)
      into v_found
      using new.doc_id, new.tenant_id;
  end if;

  if not coalesce(v_found, false) then
    raise exception 'NOT_FOUND'
      using errcode = 'foreign_key_violation',
            detail = format('No %s document %s in this organization.', new.doc_type, new.doc_id);
  end if;
  return new;
end;
$$;

-- BEFORE DELETE on document headers (FR-093, Principle I): only a draft can be deleted.
-- Without arguments the draft must also be unnumbered (types numbered at first submission,
-- like 001's pr_delete_only_unsubmitted_draft). With the argument 'status_only' a draft may be
-- deleted although numbered (GRN, SCC and INV are numbered on creation).
create or replace function app.block_delete_after_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(old);
  v_status_only boolean := tg_nargs > 0 and tg_argv[0] = 'status_only';
begin
  if v_row ->> 'status' is distinct from 'draft'
    or (not v_status_only and v_row ->> 'number' is not null) then
    raise exception 'INVALID_STATE'
      using errcode = 'restrict_violation',
            detail = 'Only a draft that was never submitted can be deleted.';
  end if;
  return old;
end;
$$;

revoke execute on function
  app.can_read_doc(text, uuid),
  app.can_read_doc_path(text, text),
  app.doc_ref_check(),
  app.block_delete_after_draft()
from public, anon;

grant execute on function app.can_read_doc(text, uuid), app.can_read_doc_path(text, text)
  to authenticated, service_role;

-- =============================================================================================
-- doc_approval_step (replaces table pr_approval_step)
-- =============================================================================================

create table public.doc_approval_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null references app.doc_type_registry (code) on delete restrict,
  doc_id uuid not null,
  cycle smallint not null check (cycle >= 1),
  step_order smallint not null check (step_order >= 1),
  kind text not null check (kind in ('finance_check', 'check', 'approval', 'final_approval')),
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
  unique (doc_type, doc_id, cycle, step_order)
);

create index doc_approval_step_tenant_status_idx on public.doc_approval_step (tenant_id, status);
create index doc_approval_step_doc_idx on public.doc_approval_step (doc_type, doc_id);
create index doc_approval_step_role_idx on public.doc_approval_step (required_role_id);
create index doc_approval_step_rule_step_idx on public.doc_approval_step (rule_step_id);
create index doc_approval_step_assigned_idx on public.doc_approval_step (assigned_user_id);

-- =============================================================================================
-- doc_signature (replaces table approval_action) — append-only
-- =============================================================================================

create table public.doc_signature (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null references app.doc_type_registry (code) on delete restrict,
  doc_id uuid not null,
  step_id uuid references public.doc_approval_step (id) on delete restrict,
  cycle smallint not null check (cycle >= 1),
  step_order smallint,
  action text not null check (action in (
    'submit', 'approve', 'reject', 'return', 'cancel', 'reassign', 'change_budget_line',
    'committee_sign', 'declare_coi', 'attend', 'received', 'inspected', 'certified', 'confirmed',
    'acknowledge_warning', 'override_match', 'post', 'reverse', 'imported'
  )),
  user_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  user_name text not null,
  user_position text,
  comment text,
  payload jsonb,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint approval_action_reason_required check (
    action not in ('reject', 'return', 'cancel', 'reassign', 'override_match', 'reverse')
    or (comment is not null and btrim(comment) <> '')
  )
);

-- one signature per user per submission cycle (FR-032 backstop)
create unique index doc_signature_one_approval_per_cycle
  on public.doc_signature (doc_type, doc_id, cycle, user_id) where action = 'approve';
-- one receipt / certificate / committee / opening signature per user and role (BR-8 backstop)
create unique index doc_signature_one_role_per_user
  on public.doc_signature (doc_type, doc_id, user_id, action)
  where action in (
    'received', 'inspected', 'certified', 'confirmed', 'committee_sign', 'declare_coi', 'attend'
  );
create index doc_signature_doc_idx on public.doc_signature (doc_type, doc_id, acted_at);
create index doc_signature_tenant_id_idx on public.doc_signature (tenant_id);
create index doc_signature_step_idx on public.doc_signature (step_id);
create index doc_signature_user_idx on public.doc_signature (user_id);

-- =============================================================================================
-- Copy the PR rows (ids preserved), drop the old tables, attach the guards
-- =============================================================================================

insert into public.doc_approval_step (
  id, tenant_id, doc_type, doc_id, cycle, step_order, kind, required_role_id, rule_step_id,
  assigned_user_id, status, acted_at, created_at, updated_at, created_by
)
select
  id, tenant_id, 'PR', pr_id, cycle, step_order, kind, required_role_id, rule_step_id,
  assigned_user_id, status, acted_at, created_at, updated_at, created_by
from public.pr_approval_step;

insert into public.doc_signature (
  id, tenant_id, doc_type, doc_id, step_id, cycle, step_order, action, user_id, user_name,
  user_position, comment, payload, acted_at, created_at
)
select
  id, tenant_id, 'PR', pr_id, step_id, cycle, step_order, action, user_id, user_name,
  user_position, comment, payload, acted_at, created_at
from public.approval_action;

drop table public.approval_action;
drop table public.pr_approval_step;

create trigger doc_ref_check before insert on public.doc_approval_step
  for each row execute function app.doc_ref_check();
create trigger doc_ref_check before insert on public.doc_signature
  for each row execute function app.doc_ref_check();

create trigger doc_signature_append_only
  before update or delete on public.doc_signature
  for each row execute function app.block_modification();

create trigger touch_updated_at before update on public.doc_approval_step
  for each row execute function app.touch_updated_at();

-- RLS: the tenant check plus the parent document's read rule (office scope via the registry).
alter table public.doc_approval_step enable row level security;
create policy tenant_select on public.doc_approval_step for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
create policy tenant_insert on public.doc_approval_step for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
create policy tenant_update on public.doc_approval_step for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  )
  with check (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
revoke delete, truncate on public.doc_approval_step from anon, authenticated;

alter table public.doc_signature enable row level security;
create policy tenant_select on public.doc_signature for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
create policy tenant_insert on public.doc_signature for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and user_id = (select auth.uid())
    and app.can_read_doc(doc_type, doc_id)
  );
revoke update, delete, truncate on public.doc_signature from anon, authenticated;

-- =============================================================================================
-- Compatibility views with the 001 names (auto-updatable; inserts default doc_type to 'PR')
-- =============================================================================================

create view public.pr_approval_step
with (security_invoker = true)
as
select
  id, tenant_id, doc_id as pr_id, cycle, step_order, kind, required_role_id, rule_step_id,
  assigned_user_id, status, acted_at, created_at, updated_at, created_by, doc_type
from public.doc_approval_step
where doc_type = 'PR'
with cascaded check option;

alter view public.pr_approval_step alter column doc_type set default 'PR';

create view public.approval_action
with (security_invoker = true)
as
select
  id, tenant_id, doc_id as pr_id, step_id, cycle, step_order, action, user_id, user_name,
  user_position, comment, payload, acted_at, created_at, doc_type
from public.doc_signature
where doc_type = 'PR'
with cascaded check option;

alter view public.approval_action alter column doc_type set default 'PR';

revoke update, delete, truncate on public.approval_action from anon, authenticated;
revoke delete, truncate on public.pr_approval_step from anon, authenticated;

-- =============================================================================================
-- Approval rules for every DoA type (research D1, D8)
-- =============================================================================================

alter table public.approval_rule drop constraint approval_rule_doc_type_check;
alter table public.approval_rule
  add constraint approval_rule_doc_type_fkey
    foreign key (doc_type) references app.doa_type (code) on delete restrict;

alter table public.approval_rule_step drop constraint approval_rule_step_kind_check;
alter table public.approval_rule_step
  add constraint approval_rule_step_kind_check
    check (kind in ('finance_check', 'check', 'approval', 'final_approval'));

alter table public.approval_rule_step drop constraint approval_rule_step_finance_check_unbanded;
alter table public.approval_rule_step
  add constraint approval_rule_step_finance_check_unbanded
    check (kind not in ('finance_check', 'check') or (min_amount is null and max_amount is null));

-- The 0011 guard, per DoA type: PR starts with its only finance check (unchanged); PV, RV and
-- JV start with their only `check`; PAY and DPR may start with one finance check; no other
-- type uses either kind. Every type: orders 1..n, the highest is the only final approval and
-- its bands are contiguous from 0 and open-ended.
create or replace function app.approval_rule_check(p_rule_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc_type text;
  v_required_first text;
  v_highest smallint;
  v_orders smallint;
  v_problem text;
  v_prev_max numeric(18, 2);
  v_first boolean := true;
  v_band record;
begin
  -- rule deleted in the same transaction (steps cascade): nothing to check
  select r.doc_type into v_doc_type from public.approval_rule r where r.id = p_rule_id;
  if not found then
    return;
  end if;

  v_required_first := case
    when v_doc_type = 'PR' then 'finance_check'
    when v_doc_type in ('PV', 'RV', 'JV') then 'check'
  end;

  select max(s.step_order), count(distinct s.step_order)
  into v_highest, v_orders
  from public.approval_rule_step s
  where s.rule_id = p_rule_id;

  if v_highest is null then
    v_problem := 'no_steps';
  elsif v_orders <> v_highest then
    v_problem := 'step_order_gap';
  elsif v_required_first is not null and exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.step_order = 1 and s.kind <> v_required_first
  ) then
    v_problem := case when v_required_first = 'finance_check'
                      then 'first_step_not_finance_check' else 'first_step_not_check' end;
  elsif v_required_first is not null and (
    select count(*) from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.kind = v_required_first
  ) <> 1 then
    v_problem := 'multiple_finance_check';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id
      and (
        (s.kind = 'finance_check' and v_doc_type not in ('PR', 'PAY', 'DPR'))
        or (s.kind = 'check' and v_doc_type not in ('PV', 'RV', 'JV'))
        or (s.kind in ('finance_check', 'check') and s.step_order <> 1)
      )
  ) then
    v_problem := 'kind_not_allowed';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id
      and ((s.step_order = v_highest) <> (s.kind = 'final_approval'))
  ) then
    v_problem := 'final_not_highest';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.step_order < v_highest
    group by s.step_order
    having count(*) > 1
        or bool_or(s.min_amount is not null or s.max_amount is not null)
  ) then
    v_problem := 'non_final_multiple_rows';
  else
    -- final bands: start at 0, each starts where the previous ended, the last is open
    for v_band in
      select coalesce(s.min_amount, 0) as lo, s.max_amount as hi
      from public.approval_rule_step s
      where s.rule_id = p_rule_id and s.step_order = v_highest
      order by coalesce(s.min_amount, 0), s.max_amount nulls last
    loop
      if v_first then
        if v_band.lo <> 0 then
          v_problem := 'band_not_from_zero';
          exit;
        end if;
        v_first := false;
      elsif v_prev_max is null or v_band.lo <> v_prev_max then
        v_problem := case when v_prev_max is null or v_band.lo < v_prev_max
                          then 'band_overlap' else 'band_gap' end;
        exit;
      end if;
      v_prev_max := v_band.hi;
    end loop;

    if v_problem is null and v_prev_max is not null then
      v_problem := 'band_not_open_ended';
    end if;
  end if;

  if v_problem is not null then
    raise exception 'APPROVAL_RULE_INVALID'
      using errcode = 'check_violation',
            detail = format('rule_id=%s reason=%s', p_rule_id, v_problem);
  end if;
end;
$$;

revoke execute on function app.approval_rule_check(uuid) from public, anon, authenticated;

-- =============================================================================================
-- Numbering for every registered type (research D7)
-- =============================================================================================

alter table public.numbering_config drop constraint numbering_config_doc_type_check;
alter table public.numbering_config
  add constraint numbering_config_doc_type_fkey
    foreign key (doc_type) references app.doc_type_registry (code) on delete restrict;

alter table public.document_sequence drop constraint document_sequence_doc_type_check;
alter table public.document_sequence
  add constraint document_sequence_doc_type_fkey
    foreign key (doc_type) references app.doc_type_registry (code) on delete restrict;

-- =============================================================================================
-- Notifications for any document (data-model §9, R29)
-- =============================================================================================

alter table public.notification alter column pr_id drop not null;
alter table public.notification
  add column doc_type text references app.doc_type_registry (code) on delete restrict,
  add column doc_id uuid,
  add column dedupe_key text,
  add constraint notification_document_ref
    check (pr_id is not null or (doc_type is not null and doc_id is not null));

alter table public.notification drop constraint notification_kind_check;
alter table public.notification
  add constraint notification_kind_check check (kind in (
    'pr_action_required', 'pr_approved', 'pr_rejected', 'pr_returned', 'pr_cancelled',
    'pr_reassigned',
    'doc_action_required', 'doc_approved', 'doc_rejected', 'doc_returned', 'doc_cancelled',
    'doc_reassigned',
    'sourcing_deadline_reached', 'guarantee_expiring', 'supplier_document_expiring',
    'vetting_due', 'advance_overdue', 'retention_release_due', 'supplier_rating_due',
    'declaration_required', 'signature_required'
  ));

create index notification_doc_idx on public.notification (doc_type, doc_id);
create unique index notification_dedupe_key
  on public.notification (tenant_id, user_id, dedupe_key) where dedupe_key is not null;

-- PR rows carry both references, whichever the writer set.
create or replace function app.notification_doc_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pr_id is not null then
    new.doc_type := 'PR';
    new.doc_id := new.pr_id;
  elsif new.doc_type = 'PR' then
    new.pr_id := new.doc_id;
  end if;
  return new;
end;
$$;

create trigger notification_doc_ref before insert on public.notification
  for each row execute function app.notification_doc_ref();

-- Existing rows: every 001 notification is a PR one.
update public.notification set doc_type = 'PR', doc_id = pr_id where pr_id is not null;

-- =============================================================================================
-- Audit history per document (R30)
-- =============================================================================================

alter table public.audit_history
  add column doc_type text,
  add column doc_id uuid;

create index audit_history_doc_idx
  on public.audit_history (doc_type, doc_id, occurred_at) where doc_id is not null;

update public.audit_history set doc_type = 'PR', doc_id = pr_id where pr_id is not null;

-- How a child table's row finds its document: either a fixed doc type or a column holding it,
-- and the column holding the document id. Later migrations register their tables. Tables with
-- doc_type/doc_id columns, purchase_requisition and PR children need no entry.
create table app.audit_parent_map (
  table_name text primary key,
  doc_type text references app.doc_type_registry (code),
  doc_type_column text,
  id_column text not null,
  constraint audit_parent_map_one_type_source check ((doc_type is null) <> (doc_type_column is null))
);

insert into app.audit_parent_map (table_name, doc_type, doc_type_column, id_column) values
  ('budget_commitment', null, 'source_doc_type', 'source_doc_id');

revoke all on app.audit_parent_map from public, anon, authenticated;

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_pr_id uuid;
  v_doc_type text;
  v_doc_id uuid;
  v_map record;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'version')
      and n.value is distinct from v_old -> n.key;

    -- nothing but bookkeeping columns changed
    if v_changed is null then
      return null;
    end if;
  end if;

  if tg_table_name = 'purchase_requisition' then
    v_doc_type := 'PR';
    v_doc_id := (v_row ->> 'id')::uuid;
  elsif v_row ? 'doc_type' and v_row ? 'doc_id' then
    v_doc_type := v_row ->> 'doc_type';
    v_doc_id := (v_row ->> 'doc_id')::uuid;
  else
    select m.doc_type, m.doc_type_column, m.id_column into v_map
    from app.audit_parent_map m
    where m.table_name = tg_table_name;
    if found then
      v_doc_type := coalesce(v_map.doc_type, v_row ->> v_map.doc_type_column);
      v_doc_id := (v_row ->> v_map.id_column)::uuid;
    elsif v_row ? 'pr_id' then
      v_doc_type := 'PR';
      v_doc_id := (v_row ->> 'pr_id')::uuid;
    end if;
  end if;
  if v_doc_id is null then
    v_doc_type := null;
  end if;

  v_pr_id := case
    when tg_table_name = 'purchase_requisition' then (v_row ->> 'id')::uuid
    when v_row ? 'pr_id' then (v_row ->> 'pr_id')::uuid
    when v_doc_type = 'PR' then v_doc_id
  end;

  insert into public.audit_history (
    tenant_id, table_name, record_id, pr_id, doc_type, doc_id, action, actor_id,
    from_state, to_state, changed_fields, old_data, new_data, comment, request_id
  ) values (
    case when tg_table_name = 'tenant' then (v_row ->> 'id')::uuid
         else (v_row ->> 'tenant_id')::uuid end,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_pr_id,
    v_doc_type,
    v_doc_id,
    lower(tg_op),
    auth.uid(),
    v_old ->> 'status',
    v_new ->> 'status',
    v_changed,
    v_old,
    v_new,
    nullif(current_setting('app.audit_comment', true), ''),
    nullif(current_setting('app.request_id', true), '')
  );

  return null;
end;
$$;

drop policy tenant_select on public.audit_history;
create policy tenant_select on public.audit_history for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.has_permission('audit:read'))
      or (
        pr_id is not null
        and exists (select 1 from public.purchase_requisition p where p.id = audit_history.pr_id)
      )
      or (
        pr_id is null and doc_type is not null and app.can_read_doc(doc_type, doc_id)
      )
    )
  );

create trigger audit_log_change after insert or update or delete on public.doc_approval_step
  for each row execute function audit.log_change();
create trigger audit_log_change after insert or update or delete on public.doc_signature
  for each row execute function audit.log_change();

-- =============================================================================================
-- PR changes for sourcing (data-model §1 "Changes to 001 tables")
-- =============================================================================================

alter table public.purchase_requisition drop constraint purchase_requisition_status_check;
alter table public.purchase_requisition
  add constraint purchase_requisition_status_check check (status in (
    'draft', 'pending_finance_check', 'pending_approval', 'approved', 'in_procurement', 'closed',
    'returned', 'rejected', 'cancelled'
  ));

alter table public.pr_line
  add column sourcing_status text not null default 'not_sourced'
    check (sourcing_status in ('not_sourced', 'in_sourcing', 'ordered', 'cancelled')),
  add column cancel_reason text;

create index pr_line_sourcing_status_idx
  on public.pr_line (tenant_id, sourcing_status) where sourcing_status = 'not_sourced';

-- =============================================================================================
-- doc_attachment and its bucket (R31)
-- =============================================================================================

create table public.doc_attachment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null references app.doc_type_registry (code) on delete restrict,
  doc_id uuid not null,
  purpose text not null default 'general' check (purpose in (
    'general', 'offer_scan', 'po_acknowledgement', 'received_by_copy', 'receipt',
    'publication_evidence', 'tor', 'guarantee', 'supplier_document', 'vetting_evidence',
    'statement_import'
  )),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  uploaded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (storage_path)
);

create index doc_attachment_doc_idx
  on public.doc_attachment (doc_type, doc_id) where deleted_at is null;
create index doc_attachment_tenant_id_idx on public.doc_attachment (tenant_id);
create index doc_attachment_uploaded_by_idx on public.doc_attachment (uploaded_by);

create trigger doc_ref_check before insert on public.doc_attachment
  for each row execute function app.doc_ref_check();
create trigger touch_updated_at before update on public.doc_attachment
  for each row execute function app.touch_updated_at();
create trigger audit_log_change after insert or update or delete on public.doc_attachment
  for each row execute function audit.log_change();

alter table public.doc_attachment enable row level security;
create policy tenant_select on public.doc_attachment for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
create policy tenant_insert on public.doc_attachment for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
create policy tenant_update on public.doc_attachment for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  )
  with check (
    tenant_id = (select app.current_tenant_id()) and app.can_read_doc(doc_type, doc_id)
  );
-- Attachments are soft-deleted (deleted_at); objects are kept for the audit trail.
revoke delete, truncate on public.doc_attachment from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doc-attachments', 'doc-attachments', false, 10485760,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do nothing;

-- Path {tenant}/{doc_type}/{doc_id}/{attachment_id}: tenant folder, and the document must be
-- readable by the caller. Sealed offer scans get an extra condition in 0016.
create policy doc_attachments_select on storage.objects for select to authenticated
  using (
    bucket_id = 'doc-attachments'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
    and app.can_read_doc_path((storage.foldername(name))[2], (storage.foldername(name))[3])
  );
create policy doc_attachments_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'doc-attachments'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
    and app.can_read_doc_path((storage.foldername(name))[2], (storage.foldername(name))[3])
  );

-- =============================================================================================
-- Tenant seed hooks
-- =============================================================================================

-- Each migration that adds tenant defaults registers a function `fn(tenant uuid)`; hooks are
-- idempotent and run in `seq` order. app.run_tenant_seed_hooks applies the ones a tenant has
-- not had yet; the registering migration backfills existing tenants, and later tenants get them
-- the first time a 002 feature asks (app.ensure_tenant_seeds), so POST /tenants is unchanged.
create table app.tenant_seed_hook (
  seq smallint primary key,
  fn regprocedure not null unique
);

create table app.tenant_seed_applied (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  seq smallint not null references app.tenant_seed_hook (seq) on delete cascade,
  applied_at timestamptz not null default now(),
  primary key (tenant_id, seq)
);

revoke all on app.tenant_seed_hook, app.tenant_seed_applied from public, anon, authenticated;

create or replace function app.run_tenant_seed_hooks(p_tenant uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hook record;
  v_count integer := 0;
begin
  -- one runner per tenant at a time; the second waits and then finds nothing pending
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_seed:' || p_tenant::text));

  for v_hook in
    select h.seq, h.fn
    from app.tenant_seed_hook h
    where not exists (
      select 1 from app.tenant_seed_applied a where a.tenant_id = p_tenant and a.seq = h.seq
    )
    order by h.seq
  loop
    execute format('select %s($1)', v_hook.fn::regproc) using p_tenant;
    insert into app.tenant_seed_applied (tenant_id, seq) values (p_tenant, v_hook.seq);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The caller's organization: cheap when nothing is pending.
create or replace function app.ensure_tenant_seeds()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    return 0;
  end if;
  if not exists (
    select 1 from app.tenant_seed_hook h
    where not exists (
      select 1 from app.tenant_seed_applied a where a.tenant_id = v_tenant and a.seq = h.seq
    )
  ) then
    return 0;
  end if;
  return app.run_tenant_seed_hooks(v_tenant);
end;
$$;

revoke execute on function app.run_tenant_seed_hooks(uuid), app.ensure_tenant_seeds()
  from public, anon;
grant execute on function app.ensure_tenant_seeds() to authenticated, service_role;
grant execute on function app.run_tenant_seed_hooks(uuid) to service_role;
