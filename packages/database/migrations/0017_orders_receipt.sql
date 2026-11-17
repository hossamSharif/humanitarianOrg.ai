-- 0017 — purchase orders, contracts, amendments and receipt (002 data-model §5, research D2,
-- R23, R24; US6–US8, US10). POs and contracts share one table (`purchase_order.kind`), so the
-- contract, amendment and completion-certificate parts are created here too.
--
-- * purchase_order (⟨doc⟩ ⟨doa⟩, numbering PO / CON) created from an approved analysis, one per
--   awarded supplier: supplier, grant, office and currency are inherited and never change;
--   po_line copies its award line, sourcing line, PR line and the PR line's dimensions (BR-1,
--   BR-2), checked by trigger (INHERITED_FIELD_MISMATCH); the header total is Σ lines;
-- * purchase_order_version (insert-only snapshots), contract_milestone, performance_guarantee;
-- * po_amendment (⟨doc⟩ ⟨doa⟩, DoA type AMD) and amendment_budget_delta;
-- * grn / grn_line (numbered on creation, completed by two signatures) and
--   completion_certificate (numbered on creation; certified + confirmed);
-- * the supplier_rating → purchase_order FK, the view purchase_order_flags, rates in use.
--
-- Office-scoped headers use `tenant_id = … and app.has_office_access(office_id)`; children use
-- the tenant check plus `exists` on the parent (contracts/rls-and-permissions.md §1).

-- =============================================================================================
-- purchase_order (⟨doc⟩ ⟨doa⟩; numbering PO / CON)
-- =============================================================================================

create table public.purchase_order (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  kind text not null check (kind in ('po', 'contract')),
  -- the registry code of the row, for the audit trail and doc_* tables
  doc_type text generated always as (case kind when 'po' then 'PO' else 'CON' end) stored,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'acknowledged', 'partially_received',
    'fully_received', 'closed', 'returned', 'rejected', 'cancelled'
  )),
  -- inherited from the approved analysis and its event (trigger), never changed
  office_id uuid not null references public.office (id) on delete restrict,
  bid_analysis_id uuid references public.bid_analysis (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  currency char(3) not null references public.currency (code) on delete restrict,
  -- terms (editable before submission)
  po_date date,
  delivery_address text,
  delivery_schedule text,
  delivery_terms text,
  payment_terms_text text,
  special_conditions text,
  advance_pct numeric(5, 2) not null default 0 check (advance_pct between 0 and 100),
  retention_pct numeric(5, 2) not null default 0 check (retention_pct between 0 and 100),
  retention_release_date date,
  is_service boolean not null default false,
  -- Σ lines of version 1 / of the current version (trigger)
  total numeric(18, 2) not null default 0 check (total >= 0),
  total_with_amendments numeric(18, 2) not null default 0 check (total_with_amendments >= 0),
  po_version smallint not null default 1 check (po_version >= 1),
  -- rate of the PO currency, locked at approval for the commitment conversion (research D2)
  commit_rate_to_base numeric(18, 6) check (commit_rate_to_base > 0),
  commit_rate_date date,
  commit_rate_source text,
  commit_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  grant_rate_to_base numeric(18, 6) check (grant_rate_to_base > 0),
  -- supplier acknowledgement (FR-036); the date the supplier signed
  acknowledged_at date,
  acknowledged_by_name text,
  acknowledgement_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  close_reason text,
  closed_at timestamptz,
  -- opening data import (R32; the FK to import_batch is added by 0019)
  is_imported boolean not null default false,
  import_batch_id uuid,
  -- contract fields (US8)
  scope_text text,
  tor_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  start_date date,
  end_date date,
  -- ⟨doc⟩
  submission_cycle smallint not null default 0,
  current_step_order smallint,
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  reject_reason text,
  return_reason text,
  print_snapshot jsonb,
  -- ⟨doa⟩
  doa_currency char(3) references public.currency (code) on delete restrict,
  doa_amount numeric(18, 2),
  doa_rate_to_base numeric(18, 6),
  doa_rate_date date,
  doa_rate_source text,
  doa_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number),
  constraint purchase_order_contract_dates
    check (end_date is null or start_date is null or end_date >= start_date),
  constraint purchase_order_source
    check (is_imported or bid_analysis_id is not null),
  constraint purchase_order_close_reason
    check (status <> 'closed' or closed_at is not null),
  constraint purchase_order_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> '')),
  constraint purchase_order_acknowledged
    check (status <> 'acknowledged' or acknowledged_at is not null)
);

-- one live PO / contract per (analysis, supplier) (FR-032)
create unique index purchase_order_one_per_supplier
  on public.purchase_order (bid_analysis_id, supplier_id)
  where status <> 'cancelled' and bid_analysis_id is not null;
create index purchase_order_tenant_status_idx on public.purchase_order (tenant_id, status);
create index purchase_order_office_idx on public.purchase_order (office_id);
create index purchase_order_supplier_idx on public.purchase_order (supplier_id);
create index purchase_order_grant_idx on public.purchase_order (grant_id);
create index purchase_order_commit_rate_idx on public.purchase_order (commit_exchange_rate_id);
create index purchase_order_doa_rate_idx on public.purchase_order (doa_exchange_rate_id);
create index purchase_order_ack_attachment_idx
  on public.purchase_order (acknowledgement_attachment_id);
create index purchase_order_tor_attachment_idx on public.purchase_order (tor_attachment_id);
create index purchase_order_created_by_idx on public.purchase_order (created_by);

select app.setup_office_doc_table('public.purchase_order', 'office_id');

create trigger bump_version before update on public.purchase_order
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.purchase_order
  for each row execute function app.block_delete_after_draft();

-- A PO comes from an approved analysis: office and grant are the event's, the supplier is an
-- awarded one; none of the inherited columns changes afterwards (BR-1, SC-002).
create or replace function app.purchase_order_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source record;
begin
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind or new.supplier_id <> old.supplier_id
      or new.grant_id <> old.grant_id or new.office_id <> old.office_id
      or new.currency <> old.currency
      or new.bid_analysis_id is distinct from old.bid_analysis_id then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A purchase order keeps its analysis, supplier, grant, office and currency.';
    end if;
    return new;
  end if;

  if new.is_imported then
    return new;
  end if;

  select b.status, e.office_id, e.grant_id into v_source
  from public.bid_analysis b
  join public.sourcing_event e on e.id = b.sourcing_event_id
  where b.id = new.bid_analysis_id and b.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Analysis not found.';
  end if;
  if v_source.status <> 'approved' then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'Purchase orders are created from an approved award only.';
  end if;
  if not exists (
    select 1 from public.award_line a
    where a.bid_analysis_id = new.bid_analysis_id and a.supplier_id = new.supplier_id
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'The supplier was not awarded by this analysis.';
  end if;

  new.office_id := v_source.office_id;
  new.grant_id := v_source.grant_id;
  return new;
end;
$$;

create trigger purchase_order_inherit
  before insert or update on public.purchase_order
  for each row execute function app.purchase_order_inherit();

-- =============================================================================================
-- po_line: inherited from the award line, its sourcing line and PR line
-- =============================================================================================

create table public.po_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  po_id uuid not null references public.purchase_order (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  award_line_id uuid references public.award_line (id) on delete restrict,
  sourcing_line_id uuid references public.sourcing_line (id) on delete restrict,
  pr_line_id uuid references public.pr_line (id) on delete restrict,
  description text,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_id uuid references public.unit_of_measure (id) on delete restrict,
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  line_total numeric(18, 2) generated always as (round(quantity * unit_price, 2)) stored,
  -- ⟨dims⟩ (the grant is the header's)
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  -- line total in the grant currency at the commit rate (set at approval)
  amount_grant numeric(18, 2),
  -- maintained: Σ accepted on completed GRNs, invoiced, Σ posted matched payments
  accepted_qty numeric(18, 3) not null default 0 check (accepted_qty >= 0),
  invoiced_qty numeric(18, 3) not null default 0 check (invoiced_qty >= 0),
  paid_amount numeric(18, 2) not null default 0 check (paid_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (po_id, line_no) deferrable initially deferred
);

create unique index po_line_one_per_award_line
  on public.po_line (po_id, award_line_id) where award_line_id is not null;
create index po_line_tenant_idx on public.po_line (tenant_id);
create index po_line_award_line_idx on public.po_line (award_line_id);
create index po_line_sourcing_line_idx on public.po_line (sourcing_line_id);
create index po_line_pr_line_idx on public.po_line (pr_line_id);
create index po_line_unit_idx on public.po_line (unit_id);
create index po_line_budget_line_idx on public.po_line (budget_line_id);
create index po_line_location_idx on public.po_line (location_office_id);
create index po_line_activity_idx on public.po_line (activity_id);

select app.setup_doc_child_table('public.po_line', 'public.purchase_order', 'po_id');

-- Links and dimensions equal the award line's, its sourcing line's and the PR line's; quantity
-- and price are the award's until an approved amendment changes them (app.amendment_command).
create or replace function app.po_line_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
  v_src record;
begin
  if tg_op = 'UPDATE' then
    if new.po_id <> old.po_id
      or new.award_line_id is distinct from old.award_line_id
      or new.sourcing_line_id is distinct from old.sourcing_line_id
      or new.pr_line_id is distinct from old.pr_line_id
      or new.budget_line_id <> old.budget_line_id
      or new.location_office_id is distinct from old.location_office_id
      or new.activity_id is distinct from old.activity_id
      or new.unit_id is distinct from old.unit_id then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A PO line keeps its award, PR line, unit and dimensions.';
    end if;
    if (new.quantity <> old.quantity or new.unit_price <> old.unit_price)
      and coalesce(current_setting('app.amendment_command', true), '') <> 'on' then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'Quantity and price change only through an approved amendment.';
    end if;
    return new;
  end if;

  select p.supplier_id, p.bid_analysis_id, p.is_imported into v_po
  from public.purchase_order p where p.id = new.po_id and p.tenant_id = new.tenant_id;
  if v_po.is_imported then
    return new;
  end if;

  select a.bid_analysis_id, a.supplier_id, a.sourcing_line_id, a.quantity, a.unit_price,
         s.pr_line_id, l.budget_line_id, l.location_office_id, l.activity_id, l.unit_id
    into v_src
  from public.award_line a
  join public.sourcing_line s on s.id = a.sourcing_line_id
  join public.pr_line l on l.id = s.pr_line_id
  where a.id = new.award_line_id and a.tenant_id = new.tenant_id;

  if not found
    or v_src.bid_analysis_id is distinct from v_po.bid_analysis_id
    or v_src.supplier_id is distinct from v_po.supplier_id
    or v_src.sourcing_line_id is distinct from new.sourcing_line_id
    or v_src.pr_line_id is distinct from new.pr_line_id
    or v_src.budget_line_id is distinct from new.budget_line_id
    or v_src.location_office_id is distinct from new.location_office_id
    or v_src.activity_id is distinct from new.activity_id
    or v_src.quantity <> new.quantity
    or v_src.unit_price <> new.unit_price then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'A PO line carries its award line''s supplier, quantity, price and PR dimensions.';
  end if;
  new.unit_id := v_src.unit_id;
  return new;
end;
$$;

create trigger po_line_inherit
  before insert or update on public.po_line
  for each row execute function app.po_line_inherit();

-- total = Σ lines while the PO is at version 1; total_with_amendments always the current Σ
create or replace function app.purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid := coalesce(new.po_id, old.po_id);
  v_sum numeric(18, 2);
begin
  select coalesce(sum(l.line_total), 0) into v_sum from public.po_line l where l.po_id = v_po;
  update public.purchase_order p
  set total_with_amendments = v_sum,
      total = case when p.po_version = 1 then v_sum else p.total end
  where p.id = v_po
    and (p.total_with_amendments <> v_sum or (p.po_version = 1 and p.total <> v_sum));
  return null;
end;
$$;

create trigger purchase_order_total
  after insert or update of quantity, unit_price or delete on public.po_line
  for each row execute function app.purchase_order_total();

-- =============================================================================================
-- Versions, milestones, guarantees
-- =============================================================================================

create table public.purchase_order_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  version smallint not null check (version >= 1),
  snapshot jsonb not null,
  created_by_amendment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (po_id, version)
);

create index purchase_order_version_tenant_idx on public.purchase_order_version (tenant_id);
create index purchase_order_version_amendment_idx
  on public.purchase_order_version (created_by_amendment_id);

select app.setup_doc_child_table(
  'public.purchase_order_version', 'public.purchase_order', 'po_id');

create trigger purchase_order_version_insert_only
  before update or delete on public.purchase_order_version
  for each row execute function app.block_modification();

create table public.contract_milestone (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  po_id uuid not null references public.purchase_order (id) on delete cascade,
  seq smallint not null check (seq >= 1),
  deliverable text not null check (btrim(deliverable) <> ''),
  pct numeric(5, 2) check (pct > 0 and pct <= 100),
  amount numeric(18, 2) not null check (amount >= 0),
  due_date date,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  -- maintained: the latest completed certificate's cumulative %
  certified_pct numeric(5, 2) not null default 0 check (certified_pct between 0 and 100),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (po_id, seq) deferrable initially deferred
);

create index contract_milestone_tenant_idx on public.contract_milestone (tenant_id);
create index contract_milestone_budget_line_idx on public.contract_milestone (budget_line_id);
create index contract_milestone_location_idx on public.contract_milestone (location_office_id);
create index contract_milestone_activity_idx on public.contract_milestone (activity_id);

select app.setup_doc_child_table('public.contract_milestone', 'public.purchase_order', 'po_id');

create trigger bump_version before update on public.contract_milestone
  for each row execute function app.bump_version();

-- A milestone is charged to a budget line of one of the contract's lines (from the award).
create or replace function app.contract_milestone_dims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.po_line l
    where l.po_id = new.po_id and l.budget_line_id = new.budget_line_id
      and l.location_office_id is not distinct from new.location_office_id
      and l.activity_id is not distinct from new.activity_id
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'A milestone carries the budget line, location and activity of a contract line.';
  end if;
  return new;
end;
$$;

create trigger contract_milestone_dims
  before insert or update of budget_line_id, location_office_id, activity_id
  on public.contract_milestone
  for each row execute function app.contract_milestone_dims();

create table public.performance_guarantee (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  type text not null check (type in ('bank_guarantee', 'cheque', 'cash_deposit', 'insurance')),
  amount numeric(18, 2) not null check (amount > 0),
  currency char(3) not null references public.currency (code) on delete restrict,
  issuer text,
  expiry_date date,
  attachment_id uuid references public.doc_attachment (id) on delete restrict,
  status text not null default 'held' check (status in ('held', 'released', 'called')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index performance_guarantee_po_idx on public.performance_guarantee (po_id);
create index performance_guarantee_tenant_idx on public.performance_guarantee (tenant_id);
create index performance_guarantee_attachment_idx on public.performance_guarantee (attachment_id);
create index performance_guarantee_expiry_idx
  on public.performance_guarantee (tenant_id, expiry_date) where status = 'held';

select app.setup_doc_child_table(
  'public.performance_guarantee', 'public.purchase_order', 'po_id');

create trigger bump_version before update on public.performance_guarantee
  for each row execute function app.bump_version();

-- =============================================================================================
-- po_amendment (⟨doc⟩ ⟨doa⟩; numbering AMD; DoA type AMD)
-- =============================================================================================

create table public.po_amendment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'returned', 'rejected', 'cancelled'
  )),
  -- copied from the PO (trigger)
  office_id uuid not null references public.office (id) on delete restrict,
  target_version smallint not null check (target_version >= 2),
  reason text not null check (btrim(reason) <> ''),
  before jsonb not null,
  after jsonb not null,
  old_total numeric(18, 2) not null check (old_total >= 0),
  new_total numeric(18, 2) not null check (new_total >= 0),
  -- ⟨doc⟩
  submission_cycle smallint not null default 0,
  current_step_order smallint,
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  reject_reason text,
  return_reason text,
  print_snapshot jsonb,
  -- ⟨doa⟩
  doa_currency char(3) references public.currency (code) on delete restrict,
  doa_amount numeric(18, 2),
  doa_rate_to_base numeric(18, 6),
  doa_rate_date date,
  doa_rate_source text,
  doa_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number)
);

-- one open amendment per PO
create unique index po_amendment_one_open
  on public.po_amendment (po_id)
  where status in ('draft', 'pending_approval', 'returned');
create index po_amendment_tenant_status_idx on public.po_amendment (tenant_id, status);
create index po_amendment_office_idx on public.po_amendment (office_id);
create index po_amendment_doa_rate_idx on public.po_amendment (doa_exchange_rate_id);
create index po_amendment_created_by_idx on public.po_amendment (created_by);

select app.setup_office_doc_table('public.po_amendment', 'office_id');

create trigger bump_version before update on public.po_amendment
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.po_amendment
  for each row execute function app.block_delete_after_draft();

alter table public.purchase_order_version
  add constraint purchase_order_version_amendment_fk
  foreign key (created_by_amendment_id) references public.po_amendment (id) on delete restrict;

create table public.amendment_budget_delta (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  amendment_id uuid not null references public.po_amendment (id) on delete cascade,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  delta_grant numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (amendment_id, budget_line_id)
);

create index amendment_budget_delta_tenant_idx on public.amendment_budget_delta (tenant_id);
create index amendment_budget_delta_line_idx on public.amendment_budget_delta (budget_line_id);

select app.setup_doc_child_table(
  'public.amendment_budget_delta', 'public.po_amendment', 'amendment_id');

-- =============================================================================================
-- Receipt: grn / grn_line (numbering GRN on creation), completion_certificate (SCC)
-- =============================================================================================

-- Office and supplier come from the PO; a receipt needs an approved PO (acknowledged when the
-- organization requires it, FR-036/FR-039).
create or replace function app.receipt_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
  v_require_ack boolean;
begin
  if tg_op = 'UPDATE' then
    if new.po_id <> old.po_id or new.office_id <> old.office_id
      or (tg_table_name = 'grn' and to_jsonb(new) ->> 'supplier_id' <> to_jsonb(old) ->> 'supplier_id')
    then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A receipt keeps its purchase order, supplier and office.';
    end if;
    return new;
  end if;

  select p.status, p.office_id, p.supplier_id, p.acknowledged_at into v_po
  from public.purchase_order p where p.id = new.po_id and p.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Purchase order not found.';
  end if;
  if v_po.status not in ('approved', 'acknowledged', 'partially_received') then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'Receipts are recorded against an approved purchase order.';
  end if;
  select s.require_po_acknowledgement into v_require_ack
  from public.procurement_setting s where s.tenant_id = new.tenant_id;
  if coalesce(v_require_ack, true) and v_po.acknowledged_at is null then
    raise exception 'PO_NOT_ACKNOWLEDGED' using errcode = 'check_violation',
      detail = 'The supplier has not acknowledged the purchase order.';
  end if;

  new.office_id := v_po.office_id;
  if tg_table_name = 'grn' then
    new := jsonb_populate_record(new, jsonb_build_object('supplier_id', v_po.supplier_id));
  end if;
  return new;
end;
$$;

create table public.grn (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  -- inherited from the PO (trigger)
  office_id uuid not null references public.office (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  received_date date not null,
  delivery_note_no text,
  supplier_invoice_no text,
  shipment_type text not null check (shipment_type in ('partial', 'final')),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number),
  constraint grn_completed check ((status = 'completed') = (completed_at is not null)),
  constraint grn_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

create index grn_tenant_status_idx on public.grn (tenant_id, status);
create index grn_po_idx on public.grn (po_id);
create index grn_office_idx on public.grn (office_id);
create index grn_supplier_idx on public.grn (supplier_id);
create index grn_created_by_idx on public.grn (created_by);

select app.setup_office_doc_table('public.grn', 'office_id');

create trigger bump_version before update on public.grn
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.grn
  for each row execute function app.block_delete_after_draft('status_only');
create trigger receipt_inherit
  before insert or update on public.grn
  for each row execute function app.receipt_inherit();

create table public.grn_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  grn_id uuid not null references public.grn (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete restrict,
  delivered_qty numeric(18, 3) not null check (delivered_qty >= 0),
  accepted_qty numeric(18, 3) not null check (accepted_qty >= 0),
  rejected_qty numeric(18, 3) not null default 0 check (rejected_qty >= 0),
  reject_reason text,
  returned_on date,
  condition_remarks text,
  is_asset boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (grn_id, po_line_id),
  constraint grn_line_quantities check (accepted_qty + rejected_qty = delivered_qty),
  constraint grn_line_delivered check (delivered_qty > 0),
  constraint grn_line_reject_reason
    check (rejected_qty = 0 or (reject_reason is not null and btrim(reject_reason) <> '')),
  constraint grn_line_return check (returned_on is null or rejected_qty > 0)
);

create index grn_line_tenant_idx on public.grn_line (tenant_id);
create index grn_line_po_line_idx on public.grn_line (po_line_id);

select app.setup_doc_child_table('public.grn_line', 'public.grn', 'grn_id');

-- The PO line belongs to the GRN's PO; quantities are fixed once the GRN is completed (a
-- return date may still be recorded).
create or replace function app.grn_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grn record;
begin
  select g.po_id, g.status into v_grn from public.grn g where g.id = new.grn_id;
  if not exists (
    select 1 from public.po_line l where l.id = new.po_line_id and l.po_id = v_grn.po_id
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'A GRN line belongs to a line of the GRN''s purchase order.';
  end if;
  if tg_op = 'UPDATE' and v_grn.status <> 'draft' and (
    new.delivered_qty <> old.delivered_qty or new.accepted_qty <> old.accepted_qty
    or new.rejected_qty <> old.rejected_qty or new.po_line_id <> old.po_line_id
    or new.is_asset <> old.is_asset
  ) then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'A completed GRN keeps its quantities.';
  end if;
  return new;
end;
$$;

create trigger grn_line_guard
  before insert or update on public.grn_line
  for each row execute function app.grn_line_guard();

create table public.completion_certificate (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  -- copied from the PO (trigger)
  office_id uuid not null references public.office (id) on delete restrict,
  milestone_id uuid references public.contract_milestone (id) on delete restrict,
  po_line_id uuid references public.po_line (id) on delete restrict,
  period_text text,
  -- cumulative
  completion_pct numeric(5, 2) not null check (completion_pct > 0 and completion_pct <= 100),
  certified_amount numeric(18, 2) not null default 0 check (certified_amount >= 0),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number),
  constraint completion_certificate_target check ((milestone_id is null) <> (po_line_id is null)),
  constraint completion_certificate_completed
    check ((status = 'completed') = (completed_at is not null)),
  constraint completion_certificate_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

create index completion_certificate_tenant_status_idx
  on public.completion_certificate (tenant_id, status);
create index completion_certificate_po_idx on public.completion_certificate (po_id);
create index completion_certificate_office_idx on public.completion_certificate (office_id);
create index completion_certificate_milestone_idx on public.completion_certificate (milestone_id);
create index completion_certificate_po_line_idx on public.completion_certificate (po_line_id);
create index completion_certificate_created_by_idx on public.completion_certificate (created_by);

select app.setup_office_doc_table('public.completion_certificate', 'office_id');

create trigger bump_version before update on public.completion_certificate
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.completion_certificate
  for each row execute function app.block_delete_after_draft('status_only');
create trigger receipt_inherit
  before insert or update on public.completion_certificate
  for each row execute function app.receipt_inherit();

-- The target belongs to the PO; the cumulative % never goes down; the certified amount is the
-- cumulative % of the target's amount (FR-043).
create or replace function app.completion_certificate_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(18, 2);
  v_last numeric(5, 2);
begin
  if new.milestone_id is not null then
    select m.amount into v_amount from public.contract_milestone m
    where m.id = new.milestone_id and m.po_id = new.po_id;
  else
    select l.line_total into v_amount from public.po_line l
    where l.id = new.po_line_id and l.po_id = new.po_id;
  end if;
  if v_amount is null then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'The certificate''s milestone or line belongs to its purchase order.';
  end if;

  select max(c.completion_pct) into v_last
  from public.completion_certificate c
  where c.po_id = new.po_id and c.status = 'completed' and c.id <> new.id
    and c.milestone_id is not distinct from new.milestone_id
    and c.po_line_id is not distinct from new.po_line_id;
  if v_last is not null and new.completion_pct < v_last then
    raise exception 'OVER_CERTIFIED' using errcode = 'check_violation',
      detail = format('Completion is cumulative: %s%% was already certified.', v_last);
  end if;

  new.certified_amount := round(v_amount * new.completion_pct / 100, 2);
  return new;
end;
$$;

create trigger completion_certificate_amount
  before insert or update of completion_pct, milestone_id, po_line_id
  on public.completion_certificate
  for each row execute function app.completion_certificate_amount();

-- =============================================================================================
-- Maintained receipt figures: po_line.accepted_qty from completed GRNs, milestone certified %
-- =============================================================================================

create or replace function app.grn_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.po_line l
  set accepted_qty = coalesce((
    select sum(gl.accepted_qty)
    from public.grn_line gl
    join public.grn g on g.id = gl.grn_id
    where gl.po_line_id = l.id and g.status = 'completed'
  ), 0)
  where l.po_id = new.po_id;
  return null;
end;
$$;

create trigger grn_completed
  after update of status on public.grn
  for each row when (new.status is distinct from old.status)
  execute function app.grn_completed();

create or replace function app.certificate_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.milestone_id is not null then
    update public.contract_milestone m
    set certified_pct = coalesce((
      select max(c.completion_pct) from public.completion_certificate c
      where c.milestone_id = m.id and c.status = 'completed'
    ), 0)
    where m.id = new.milestone_id;
  end if;
  return null;
end;
$$;

create trigger certificate_completed
  after update of status on public.completion_certificate
  for each row when (new.status is distinct from old.status)
  execute function app.certificate_completed();

-- =============================================================================================
-- Ratings, flags, registry, audit, rates in use
-- =============================================================================================

alter table public.supplier_rating
  add constraint supplier_rating_po_fk
  foreign key (po_id) references public.purchase_order (id) on delete restrict;

-- A PO whose supplier was blacklisted after approval (edge case): shown with a warning banner.
create or replace view public.purchase_order_flags
with (security_invoker = true) as
select p.id as po_id,
       (s.status = 'blacklisted') as blacklist_flag
from public.purchase_order p
join public.supplier s on s.id = p.supplier_id;

grant select on public.purchase_order_flags to authenticated;

update app.doc_type_registry
set table_name = 'public.purchase_order', office_column = 'office_id'
where code in ('PO', 'CON');
update app.doc_type_registry
set table_name = 'public.po_amendment', office_column = 'office_id'
where code = 'AMD';
update app.doc_type_registry
set table_name = 'public.grn', office_column = 'office_id'
where code = 'GRN';
update app.doc_type_registry
set table_name = 'public.completion_certificate', office_column = 'office_id'
where code = 'SCC';

-- po_line, versions, milestones and guarantees are filed under PO (one table serves PO and CON)
insert into app.audit_parent_map (table_name, doc_type, doc_type_column, id_column) values
  ('purchase_order', null, 'doc_type', 'id'),
  ('po_line', 'PO', null, 'po_id'),
  ('purchase_order_version', 'PO', null, 'po_id'),
  ('contract_milestone', 'CON', null, 'po_id'),
  ('performance_guarantee', 'CON', null, 'po_id'),
  ('po_amendment', 'AMD', null, 'id'),
  ('amendment_budget_delta', 'AMD', null, 'amendment_id'),
  ('grn', 'GRN', null, 'id'),
  ('grn_line', 'GRN', null, 'grn_id'),
  ('completion_certificate', 'SCC', null, 'id'),
  ('supplier_rating', 'PO', null, 'po_id');

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'purchase_order', 'po_line', 'purchase_order_version', 'contract_milestone',
    'performance_guarantee', 'po_amendment', 'amendment_budget_delta', 'grn', 'grn_line',
    'completion_certificate'
  ] loop
    execute format(
      'create trigger audit_log_change after insert or update or delete on public.%I '
      'for each row execute function audit.log_change()', v_table);
  end loop;
end;
$$;

create or replace view app.exchange_rate_usage as
select l.exchange_rate_id from public.pr_line l where l.exchange_rate_id is not null
union all
select p.doa_exchange_rate_id from public.purchase_requisition p
where p.doa_exchange_rate_id is not null
union all
select p.grant_exchange_rate_id from public.purchase_requisition p
where p.grant_exchange_rate_id is not null
union all
select c.exchange_rate_id from public.budget_commitment c where c.exchange_rate_id is not null
union all
select b.doa_exchange_rate_id from public.bid_analysis b where b.doa_exchange_rate_id is not null
union all
select w.doa_exchange_rate_id from public.waiver w where w.doa_exchange_rate_id is not null
union all
select p.doa_exchange_rate_id from public.purchase_order p where p.doa_exchange_rate_id is not null
union all
select p.commit_exchange_rate_id from public.purchase_order p
where p.commit_exchange_rate_id is not null
union all
select a.doa_exchange_rate_id from public.po_amendment a where a.doa_exchange_rate_id is not null;

revoke all on app.exchange_rate_usage from public, anon, authenticated;

revoke execute on function
  app.purchase_order_inherit(),
  app.po_line_inherit(),
  app.purchase_order_total(),
  app.contract_milestone_dims(),
  app.receipt_inherit(),
  app.grn_line_guard(),
  app.completion_certificate_amount(),
  app.grn_completed(),
  app.certificate_completed()
from public, anon, authenticated;
