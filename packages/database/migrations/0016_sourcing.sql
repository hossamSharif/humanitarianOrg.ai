-- 0016 — sourcing, offers, analysis, award and waivers (002 data-model §4, research D3, D4,
-- R21, R22; US3–US5, US9, US10). RFQs and tenders share one model (`sourcing_event.kind`), so
-- the tender-only tables are created here too and the sealed-price policies are written once.
--
-- * sourcing_event (⟨doc⟩, numbering RFQ / TND) with lines from approved PR lines, criteria,
--   invitations, tender lots, publications and clarifications;
-- * offer (the receipt log, never sealed) and the SEALED offer_terms / offer_line_price, whose
--   select and insert policies require the event's opening (app.sourcing_opened) and that the
--   caller is not an undeclared or conflicted committee member (app.may_see_offer_prices);
-- * opening_record / opening_attendee, bid_security;
-- * bid_analysis (⟨doc⟩ ⟨doa⟩, DoA type AWARD) with the committee, scores, the computed result
--   snapshot, award lines and unsuccessful-supplier notices;
-- * waiver (⟨doc⟩ ⟨doa⟩, DoA type WAIVER).
--
-- Office-scoped documents use `tenant_id = … and app.has_office_access(office_id)`; their
-- children use the tenant check plus `exists` on the parent, so the parent's RLS applies
-- (contracts/rls-and-permissions.md §1).

-- =============================================================================================
-- Policy helpers for this and later 002 document migrations
-- =============================================================================================

-- Replaces the tenant template of a document header with the office-scoped one.
create or replace function app.setup_office_doc_table(p_table regclass, p_office_column text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_expr text := format(
    'tenant_id = (select app.current_tenant_id()) and app.has_office_access(%I)', p_office_column);
begin
  perform app.setup_tenant_table(p_table);
  execute format('drop policy tenant_select on %s', p_table);
  execute format('drop policy tenant_insert on %s', p_table);
  execute format('drop policy tenant_update on %s', p_table);
  execute format('drop policy tenant_delete on %s', p_table);
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
end;
$$;

-- A child row is visible and writable when its parent row is (the parent's RLS applies).
create or replace function app.setup_doc_child_table(
  p_table regclass,
  p_parent regclass,
  p_fk_column text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_expr text := format(
    'tenant_id = (select app.current_tenant_id()) '
    'and exists (select 1 from %s p where p.id = %I)', p_parent, p_fk_column);
begin
  perform app.setup_tenant_table(p_table);
  execute format('drop policy tenant_select on %s', p_table);
  execute format('drop policy tenant_insert on %s', p_table);
  execute format('drop policy tenant_update on %s', p_table);
  execute format('drop policy tenant_delete on %s', p_table);
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
end;
$$;

revoke execute on function app.setup_office_doc_table(regclass, text),
  app.setup_doc_child_table(regclass, regclass, text) from public, anon, authenticated;

-- =============================================================================================
-- waiver (⟨doc⟩ ⟨doa⟩; numbering WVR; DoA type WAIVER). Created first: events and analyses
-- point at the waiver that covers them.
-- =============================================================================================

create table public.waiver (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'returned', 'rejected', 'cancelled'
  )),
  office_id uuid not null references public.office (id) on delete restrict,
  reason_category text not null check (reason_category in (
    'single_source', 'emergency', 'fewer_quotations', 'lower_method', 'expired_document',
    'overdue_advance', 'other'
  )),
  justification text not null check (btrim(justification) <> ''),
  covered_doc_type text not null references app.doc_type_registry (code) on delete restrict,
  covered_doc_id uuid not null,
  covered_value numeric(18, 2) check (covered_value >= 0),
  covered_currency char(3) references public.currency (code) on delete restrict,
  submission_cycle smallint not null default 0,
  current_step_order smallint,
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  reject_reason text,
  return_reason text,
  print_snapshot jsonb,
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

create index waiver_tenant_status_idx on public.waiver (tenant_id, status);
create index waiver_office_idx on public.waiver (office_id);
create index waiver_covered_idx on public.waiver (covered_doc_type, covered_doc_id);
create index waiver_doa_rate_idx on public.waiver (doa_exchange_rate_id);
create index waiver_created_by_idx on public.waiver (created_by);

select app.setup_office_doc_table('public.waiver', 'office_id');

create trigger bump_version before update on public.waiver
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.waiver
  for each row execute function app.block_delete_after_draft();

-- =============================================================================================
-- sourcing_event (⟨doc⟩; numbering RFQ / TND)
-- =============================================================================================

create table public.sourcing_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  kind text not null check (kind in ('rfq', 'tender')),
  -- the registry code of the row, for the audit trail and doc_* tables
  doc_type text generated always as (case kind when 'rfq' then 'RFQ' else 'TND' end) stored,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'issued', 'closed', 'opened', 'evaluated', 'awarded', 'cancelled'
  )),
  grant_id uuid not null references public."grant" (id) on delete restrict,
  office_id uuid not null references public.office (id) on delete restrict,
  title text not null check (btrim(title) <> ''),
  issue_date date,
  submission_deadline timestamptz,
  delivery_place text,
  delivery_terms text,
  payment_terms text,
  currency char(3) not null references public.currency (code) on delete restrict,
  offer_validity_days smallint check (offer_validity_days >= 1),
  split_award_allowed boolean not null default false,
  required_method text not null check (required_method in ('direct', 'rfq', 'tender')),
  required_min_quotations smallint not null check (required_min_quotations >= 1),
  chosen_method text not null check (chosen_method in ('direct', 'rfq', 'tender')),
  estimated_value_doa numeric(18, 2) not null check (estimated_value_doa >= 0),
  doa_currency char(3) not null references public.currency (code) on delete restrict,
  method_snapshot jsonb not null,
  splitting_warning jsonb,
  waiver_id uuid references public.waiver (id) on delete restrict,
  opened_at timestamptz,
  reissued_from_id uuid references public.sourcing_event (id) on delete restrict,
  -- tender fields (US9)
  clarification_deadline timestamptz,
  opening_place text,
  bid_security_required boolean not null default false,
  bid_security_amount numeric(18, 2) check (bid_security_amount >= 0),
  bid_security_pct numeric(5, 2) check (bid_security_pct between 0 and 100),
  bid_security_type text check (bid_security_type in (
    'bank_guarantee', 'cheque', 'cash_deposit', 'insurance'
  )),
  bid_security_validity_days smallint check (bid_security_validity_days >= 1),
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
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number),
  constraint sourcing_event_deadline_after_issue
    check (submission_deadline is null or issue_date is null
           or submission_deadline > issue_date::timestamp),
  -- once issued, the event carries its number, issue date and deadline
  constraint sourcing_event_issued_complete
    check (status in ('draft', 'cancelled')
           or (number is not null and issue_date is not null and submission_deadline is not null)),
  constraint sourcing_event_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

create index sourcing_event_tenant_status_idx on public.sourcing_event (tenant_id, status);
create index sourcing_event_grant_idx on public.sourcing_event (grant_id);
create index sourcing_event_office_idx on public.sourcing_event (office_id);
create index sourcing_event_reissued_idx on public.sourcing_event (reissued_from_id);
create index sourcing_event_waiver_idx on public.sourcing_event (waiver_id);
create index sourcing_event_created_by_idx on public.sourcing_event (created_by);

select app.setup_office_doc_table('public.sourcing_event', 'office_id');

create trigger bump_version before update on public.sourcing_event
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.sourcing_event
  for each row execute function app.block_delete_after_draft();

-- =============================================================================================
-- Tender lots (lines may belong to one), publications, clarifications (US9)
-- =============================================================================================

create table public.tender_lot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete cascade,
  lot_no smallint not null check (lot_no >= 1),
  title text not null check (btrim(title) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (sourcing_event_id, lot_no)
);

create index tender_lot_tenant_idx on public.tender_lot (tenant_id);

select app.setup_doc_child_table('public.tender_lot', 'public.sourcing_event', 'sourcing_event_id');

create table public.tender_publication (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  channel text not null check (channel in (
    'email', 'whatsapp', 'in_person', 'newspaper', 'website', 'notice_board'
  )),
  published_on date not null,
  reference text,
  evidence_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index tender_publication_event_idx on public.tender_publication (sourcing_event_id);
create index tender_publication_tenant_idx on public.tender_publication (tenant_id);
create index tender_publication_evidence_idx on public.tender_publication (evidence_attachment_id);

select app.setup_doc_child_table(
  'public.tender_publication', 'public.sourcing_event', 'sourcing_event_id');

create table public.tender_clarification (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  question text not null check (btrim(question) <> ''),
  asked_by_supplier_id uuid references public.supplier (id) on delete restrict,
  asked_on date not null,
  answer text,
  answered_on date,
  shared_on date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index tender_clarification_event_idx on public.tender_clarification (sourcing_event_id);
create index tender_clarification_tenant_idx on public.tender_clarification (tenant_id);
create index tender_clarification_supplier_idx on public.tender_clarification (asked_by_supplier_id);

select app.setup_doc_child_table(
  'public.tender_clarification', 'public.sourcing_event', 'sourcing_event_id');

create trigger bump_version before update on public.tender_clarification
  for each row execute function app.bump_version();

-- =============================================================================================
-- sourcing_line: one open event per PR line (BR-22, US3-3)
-- =============================================================================================

create table public.sourcing_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  pr_line_id uuid not null references public.pr_line (id) on delete restrict,
  description text,
  specifications text,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_id uuid references public.unit_of_measure (id) on delete restrict,
  lot_id uuid references public.tender_lot (id) on delete restrict,
  -- maintained from the event status (app.sourcing_line_open)
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (sourcing_event_id, line_no) deferrable initially deferred
);

create unique index sourcing_line_one_open_event on public.sourcing_line (pr_line_id)
  where is_open;
create index sourcing_line_tenant_idx on public.sourcing_line (tenant_id);
create index sourcing_line_unit_idx on public.sourcing_line (unit_id);
create index sourcing_line_lot_idx on public.sourcing_line (lot_id);

select app.setup_doc_child_table('public.sourcing_line', 'public.sourcing_event', 'sourcing_event_id');

-- Lines come from approved PR lines of the event's grant and office (US3-5); quantity and unit
-- are copied from the PR line and stay read-only (FR-015 allows rewording only).
create or replace function app.sourcing_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_pr record;
  v_open_event uuid;
begin
  if tg_op = 'UPDATE' then
    if new.pr_line_id <> old.pr_line_id or new.quantity <> old.quantity
      or new.unit_id is distinct from old.unit_id
      or new.sourcing_event_id <> old.sourcing_event_id then
      raise exception 'VALIDATION_ERROR'
        using errcode = 'check_violation',
              detail = 'A sourcing line keeps its PR line, quantity and unit.';
    end if;
    return new;
  end if;

  select e.grant_id, e.office_id, e.tenant_id into v_event
  from public.sourcing_event e where e.id = new.sourcing_event_id;

  select p.grant_id, p.requesting_office_id, p.status, l.quantity, l.unit_id, l.sourcing_status
    into v_pr
  from public.pr_line l
  join public.purchase_requisition p on p.id = l.pr_id
  where l.id = new.pr_line_id and l.tenant_id = new.tenant_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'PR line not found.';
  end if;
  if v_pr.status not in ('approved', 'in_procurement') then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'Only lines of approved PRs can be sourced.';
  end if;
  if v_pr.grant_id is distinct from v_event.grant_id
    or v_pr.requesting_office_id is distinct from v_event.office_id then
    raise exception 'MIXED_GRANTS' using errcode = 'check_violation',
      detail = 'Every PR line of a sourcing event belongs to its grant and office.';
  end if;

  if new.is_open then
    select s.sourcing_event_id into v_open_event
    from public.sourcing_line s
    where s.pr_line_id = new.pr_line_id and s.is_open
    limit 1;
    if v_open_event is not null then
      raise exception 'PR_LINE_ALREADY_SOURCING' using errcode = 'unique_violation',
        detail = format('PR line %s is in sourcing event %s.', new.pr_line_id, v_open_event);
    end if;
  end if;

  new.quantity := v_pr.quantity;
  new.unit_id := v_pr.unit_id;
  return new;
end;
$$;

create trigger sourcing_line_guard
  before insert or update on public.sourcing_line
  for each row execute function app.sourcing_line_guard();

-- =============================================================================================
-- sourcing_criterion, sourcing_invitation
-- =============================================================================================

create table public.sourcing_criterion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete cascade,
  sort_order smallint not null default 1,
  stage text not null default 'single' check (stage in ('single', 'technical', 'financial')),
  kind text not null check (kind in ('essential', 'weighted')),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name_ar text not null check (btrim(name_ar) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  weight_pct numeric(5, 2) check (weight_pct > 0 and weight_pct <= 100),
  is_price boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint sourcing_criterion_weight check ((kind = 'weighted') = (weight_pct is not null)),
  constraint sourcing_criterion_price_weighted check (not is_price or kind = 'weighted')
);

-- exactly one price criterion per weighted stage that scores price
create unique index sourcing_criterion_one_price
  on public.sourcing_criterion (sourcing_event_id, stage) where is_price;
create index sourcing_criterion_event_idx on public.sourcing_criterion (sourcing_event_id);
create index sourcing_criterion_tenant_idx on public.sourcing_criterion (tenant_id);

select app.setup_doc_child_table(
  'public.sourcing_criterion', 'public.sourcing_event', 'sourcing_event_id');

create table public.sourcing_invitation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete cascade,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  invited_on date not null default current_date,
  channel text not null check (channel in (
    'email', 'whatsapp', 'in_person', 'newspaper', 'website', 'notice_board'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (sourcing_event_id, supplier_id)
);

create index sourcing_invitation_tenant_idx on public.sourcing_invitation (tenant_id);
create index sourcing_invitation_supplier_idx on public.sourcing_invitation (supplier_id);

select app.setup_doc_child_table(
  'public.sourcing_invitation', 'public.sourcing_event', 'sourcing_event_id');

-- Only an approved supplier can be invited (US2-1: overdue vetting and expired documents are
-- warnings at invitation, never blocks; blacklisted and suspended suppliers are refused).
create or replace function app.sourcing_invitation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.supplier s
    where s.id = new.supplier_id and s.tenant_id = new.tenant_id and s.status = 'approved'
  ) then
    raise exception 'SUPPLIER_NOT_ELIGIBLE' using errcode = 'check_violation',
      detail = format('Supplier %s is not approved.', new.supplier_id);
  end if;
  return new;
end;
$$;

create trigger sourcing_invitation_guard
  before insert or update of supplier_id on public.sourcing_invitation
  for each row execute function app.sourcing_invitation_guard();

-- =============================================================================================
-- Event status: issue backstops, opened_at only from the opening command, line exclusivity
-- =============================================================================================

create or replace function app.sourcing_event_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
begin
  -- opened_at is set once, by the opening command (research D3)
  if new.opened_at is distinct from old.opened_at then
    if old.opened_at is not null
      or coalesce(current_setting('app.opening_command', true), '') <> 'on' then
      raise exception 'INVALID_STATE' using errcode = 'check_violation',
        detail = 'The opening time is recorded by the opening command only.';
    end if;
  end if;

  if new.status = 'issued' and old.status = 'draft' then
    -- criteria weights per stage = 100 (FR-017)
    for v_stage in
      select c.stage, sum(c.weight_pct) as total
      from public.sourcing_criterion c
      where c.sourcing_event_id = new.id and c.kind = 'weighted'
      group by c.stage
    loop
      if v_stage.total <> 100 then
        raise exception 'CRITERIA_WEIGHTS_INVALID' using errcode = 'check_violation',
          detail = format('stage=%s total=%s', v_stage.stage, v_stage.total);
      end if;
    end loop;
    if not exists (select 1 from public.sourcing_line l where l.sourcing_event_id = new.id) then
      raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
        detail = 'A sourcing event needs at least one line.';
    end if;
  end if;
  return new;
end;
$$;

create trigger sourcing_event_guard
  before update on public.sourcing_event
  for each row execute function app.sourcing_event_guard();

-- Lines stay open while the event is live; a cancelled event frees them, an awarded one keeps
-- only the awarded lines (to be ordered) open.
create or replace function app.sourcing_line_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' then
    update public.sourcing_line set is_open = false
    where sourcing_event_id = new.id and is_open;
  elsif new.status = 'awarded' then
    update public.sourcing_line l set is_open = false
    where l.sourcing_event_id = new.id and l.is_open
      and not exists (
        select 1 from public.award_line a
        join public.bid_analysis b on b.id = a.bid_analysis_id
        where a.sourcing_line_id = l.id and b.status = 'approved'
      );
  end if;
  return null;
end;
$$;

-- =============================================================================================
-- offer (receipt log; never sealed)
-- =============================================================================================

create table public.offer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  received_at timestamptz not null,
  received_by uuid not null references auth.users (id) on delete restrict,
  status text not null default 'logged' check (status in (
    'logged', 'replaced', 'late', 'late_accepted', 'withdrawn', 'disqualified'
  )),
  replaces_id uuid references public.offer (id) on delete restrict,
  late_acceptance_reason text,
  disqualification_reason text,
  bid_security_received boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint offer_late_accepted_reason
    check (status <> 'late_accepted'
           or (late_acceptance_reason is not null and btrim(late_acceptance_reason) <> '')),
  constraint offer_disqualified_reason
    check (status <> 'disqualified'
           or (disqualification_reason is not null and btrim(disqualification_reason) <> ''))
);

create unique index offer_one_valid_per_supplier
  on public.offer (sourcing_event_id, supplier_id) where status in ('logged', 'late_accepted');
create index offer_event_idx on public.offer (sourcing_event_id);
create index offer_tenant_idx on public.offer (tenant_id);
create index offer_supplier_idx on public.offer (supplier_id);
create index offer_received_by_idx on public.offer (received_by);
create index offer_replaces_idx on public.offer (replaces_id);

select app.setup_doc_child_table('public.offer', 'public.sourcing_event', 'sourcing_event_id');

create trigger bump_version before update on public.offer
  for each row execute function app.bump_version();

revoke delete on public.offer from anon, authenticated;

-- A receipt after the deadline is `late`, from the deadline and never typed (research D3). RFQ
-- receipts come only from invited suppliers; receipts are logged while the event is issued.
create or replace function app.offer_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
begin
  select e.kind, e.status, e.submission_deadline into v_event
  from public.sourcing_event e
  where e.id = new.sourcing_event_id and e.tenant_id = new.tenant_id;

  if v_event.status not in ('issued', 'closed') then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'Receipts are logged while the sourcing event is issued and not yet opened.';
  end if;
  if v_event.kind = 'rfq' and not exists (
    select 1 from public.sourcing_invitation i
    where i.sourcing_event_id = new.sourcing_event_id and i.supplier_id = new.supplier_id
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'Only an invited supplier can submit a quotation.';
  end if;

  new.status := case when new.received_at > v_event.submission_deadline then 'late'
                     else 'logged' end;
  return new;
end;
$$;

create trigger offer_receipt_guard
  before insert on public.offer
  for each row execute function app.offer_receipt_guard();

-- =============================================================================================
-- Opening record and attendees (research D3; ≥ 2 attendees for an RFQ, ≥ 3 for a tender)
-- =============================================================================================

create table public.opening_record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null unique references public.sourcing_event (id) on delete restrict,
  opened_at timestamptz not null,
  place text,
  notes text,
  signed_complete_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index opening_record_tenant_idx on public.opening_record (tenant_id);

select app.setup_doc_child_table(
  'public.opening_record', 'public.sourcing_event', 'sourcing_event_id');

revoke delete on public.opening_record from anon, authenticated;

create table public.opening_attendee (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  opening_record_id uuid not null references public.opening_record (id) on delete restrict,
  user_id uuid references auth.users (id) on delete restrict,
  external_name text,
  function text not null check (btrim(function) <> ''),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint opening_attendee_identity
    check ((user_id is null) <> (external_name is null or btrim(external_name) = ''))
);

create unique index opening_attendee_one_user
  on public.opening_attendee (opening_record_id, user_id) where user_id is not null;
create index opening_attendee_tenant_idx on public.opening_attendee (tenant_id);
create index opening_attendee_user_idx on public.opening_attendee (user_id);

select app.setup_doc_child_table(
  'public.opening_attendee', 'public.opening_record', 'opening_record_id');

revoke update, delete on public.opening_attendee from anon, authenticated;

-- =============================================================================================
-- bid_analysis (⟨doc⟩ ⟨doa⟩; numbering QA; DoA type AWARD) and its children
-- =============================================================================================

create table public.bid_analysis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'scoring', 'signing', 'pending_approval', 'approved', 'returned', 'rejected',
    'cancelled'
  )),
  -- copied from the event (trigger)
  office_id uuid not null references public.office (id) on delete restrict,
  comparison_rates jsonb not null default '[]'::jsonb,
  recommended_offer_id uuid references public.offer (id) on delete restrict,
  highest_offer_id uuid references public.offer (id) on delete restrict,
  justification text,
  justification_criterion_ids uuid[] not null default '{}',
  waiver_id uuid references public.waiver (id) on delete restrict,
  -- in the event currency and in the DoA reference currency
  awarded_amount numeric(18, 2) check (awarded_amount >= 0),
  awarded_amount_doa numeric(18, 2) check (awarded_amount_doa >= 0),
  frozen_at timestamptz,
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

create unique index bid_analysis_one_live_per_event
  on public.bid_analysis (sourcing_event_id) where status <> 'cancelled';
create index bid_analysis_tenant_status_idx on public.bid_analysis (tenant_id, status);
create index bid_analysis_office_idx on public.bid_analysis (office_id);
create index bid_analysis_recommended_idx on public.bid_analysis (recommended_offer_id);
create index bid_analysis_highest_idx on public.bid_analysis (highest_offer_id);
create index bid_analysis_waiver_idx on public.bid_analysis (waiver_id);
create index bid_analysis_doa_rate_idx on public.bid_analysis (doa_exchange_rate_id);
create index bid_analysis_created_by_idx on public.bid_analysis (created_by);

select app.setup_office_doc_table('public.bid_analysis', 'office_id');

create trigger bump_version before update on public.bid_analysis
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.bid_analysis
  for each row execute function app.block_delete_after_draft();

create or replace function app.bid_analysis_office()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.office_id into new.office_id
  from public.sourcing_event e
  where e.id = new.sourcing_event_id and e.tenant_id = new.tenant_id;
  if new.office_id is null then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Sourcing event not found.';
  end if;
  return new;
end;
$$;

create trigger bid_analysis_office
  before insert on public.bid_analysis
  for each row execute function app.bid_analysis_office();

-- frozen_at is set once (the first committee signature) and never cleared
create or replace function app.bid_analysis_freeze_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.frozen_at is not null and new.frozen_at is distinct from old.frozen_at then
    raise exception 'OFFER_FROZEN' using errcode = 'check_violation',
      detail = 'The analysis results are frozen.';
  end if;
  return new;
end;
$$;

create trigger bid_analysis_freeze_once
  before update on public.bid_analysis
  for each row execute function app.bid_analysis_freeze_once();

create table public.committee_member (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  bid_analysis_id uuid not null references public.bid_analysis (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  function text not null check (function in ('procurement', 'finance', 'program', 'other')),
  declared_at timestamptz,
  has_conflict boolean,
  conflict_supplier_ids uuid[] not null default '{}',
  conflict_note text,
  excluded boolean generated always as (coalesce(has_conflict, false)) stored,
  replaced_by_id uuid references public.committee_member (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (bid_analysis_id, user_id),
  constraint committee_member_declaration
    check ((declared_at is null) = (has_conflict is null))
);

create index committee_member_tenant_idx on public.committee_member (tenant_id);
create index committee_member_user_idx on public.committee_member (user_id);
create index committee_member_replaced_idx on public.committee_member (replaced_by_id);

select app.setup_doc_child_table(
  'public.committee_member', 'public.bid_analysis', 'bid_analysis_id');

create trigger bump_version before update on public.committee_member
  for each row execute function app.bump_version();

-- a declaration is made once (it is also signed in doc_signature as declare_coi)
create or replace function app.committee_declaration_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.declared_at is not null and (
    new.declared_at is distinct from old.declared_at
    or new.has_conflict is distinct from old.has_conflict
    or new.conflict_supplier_ids is distinct from old.conflict_supplier_ids
  ) then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'A conflict-of-interest declaration cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger committee_declaration_once
  before update on public.committee_member
  for each row execute function app.committee_declaration_once();

create table public.evaluation_score (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  bid_analysis_id uuid not null references public.bid_analysis (id) on delete restrict,
  member_id uuid not null references public.committee_member (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  criterion_id uuid not null references public.sourcing_criterion (id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (bid_analysis_id, member_id, offer_id, criterion_id)
);

create index evaluation_score_tenant_idx on public.evaluation_score (tenant_id);
create index evaluation_score_member_idx on public.evaluation_score (member_id);
create index evaluation_score_offer_idx on public.evaluation_score (offer_id);
create index evaluation_score_criterion_idx on public.evaluation_score (criterion_id);

select app.setup_doc_child_table(
  'public.evaluation_score', 'public.bid_analysis', 'bid_analysis_id');

-- Scores come from declared, unconflicted, unreplaced members on weighted non-price criteria,
-- until the results are frozen (US5-5; price points are computed, never scored).
create or replace function app.evaluation_score_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.bid_analysis b
    where b.id = coalesce(new.bid_analysis_id, old.bid_analysis_id) and b.frozen_at is not null
  ) then
    raise exception 'OFFER_FROZEN' using errcode = 'check_violation',
      detail = 'The analysis results are frozen.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if not exists (
    select 1 from public.committee_member m
    where m.id = new.member_id and m.bid_analysis_id = new.bid_analysis_id
      and m.declared_at is not null and not m.excluded and m.replaced_by_id is null
  ) then
    raise exception 'DECLARATION_REQUIRED' using errcode = 'check_violation',
      detail = 'Only a declared committee member without a conflict may score.';
  end if;
  if not exists (
    select 1 from public.sourcing_criterion c
    join public.bid_analysis b on b.sourcing_event_id = c.sourcing_event_id
    where c.id = new.criterion_id and b.id = new.bid_analysis_id
      and c.kind = 'weighted' and not c.is_price
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'Scores are given on the weighted non-price criteria of the event.';
  end if;
  return new;
end;
$$;

create trigger evaluation_score_guard
  before insert or update or delete on public.evaluation_score
  for each row execute function app.evaluation_score_guard();

create table public.analysis_result (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  bid_analysis_id uuid not null references public.bid_analysis (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  sourcing_line_id uuid references public.sourcing_line (id) on delete restrict,
  disqualified boolean not null default false,
  disqualification_reason text,
  total_offer_currency numeric(18, 2),
  total_event_currency numeric(18, 2),
  price_points numeric(5, 2),
  criteria_points jsonb not null default '{}'::jsonb,
  technical_pass boolean,
  weighted_total numeric(5, 2),
  rank smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create unique index analysis_result_offer_line
  on public.analysis_result (bid_analysis_id, offer_id, coalesce(sourcing_line_id,
    '00000000-0000-0000-0000-000000000000'::uuid));
create index analysis_result_tenant_idx on public.analysis_result (tenant_id);
create index analysis_result_offer_idx on public.analysis_result (offer_id);
create index analysis_result_line_idx on public.analysis_result (sourcing_line_id);

select app.setup_doc_child_table(
  'public.analysis_result', 'public.bid_analysis', 'bid_analysis_id');

-- The snapshot is rewritten until the first committee signature, then immutable (FR-029).
create or replace function app.analysis_result_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.bid_analysis b
    where b.id = coalesce(new.bid_analysis_id, old.bid_analysis_id) and b.frozen_at is not null
  ) then
    raise exception 'OFFER_FROZEN' using errcode = 'check_violation',
      detail = 'The analysis results are frozen.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger analysis_result_frozen
  before insert or update or delete on public.analysis_result
  for each row execute function app.analysis_result_frozen();

create table public.award_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  bid_analysis_id uuid not null references public.bid_analysis (id) on delete restrict,
  sourcing_line_id uuid not null references public.sourcing_line (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  -- the offer's supplier (trigger)
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  currency char(3) not null references public.currency (code) on delete restrict,
  amount numeric(18, 2) generated always as (round(quantity * unit_price, 2)) stored,
  -- copied from the PR line (BR-1, BR-2)
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (bid_analysis_id, sourcing_line_id)
);

create index award_line_tenant_idx on public.award_line (tenant_id);
create index award_line_line_idx on public.award_line (sourcing_line_id);
create index award_line_offer_idx on public.award_line (offer_id);
create index award_line_supplier_idx on public.award_line (supplier_id);
create index award_line_budget_line_idx on public.award_line (budget_line_id);
create index award_line_location_idx on public.award_line (location_office_id);
create index award_line_activity_idx on public.award_line (activity_id);

select app.setup_doc_child_table('public.award_line', 'public.bid_analysis', 'bid_analysis_id');

create or replace function app.award_line_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pr record;
begin
  select o.supplier_id into new.supplier_id from public.offer o where o.id = new.offer_id;

  select l.budget_line_id, l.location_office_id, l.activity_id into v_pr
  from public.sourcing_line s
  join public.pr_line l on l.id = s.pr_line_id
  where s.id = new.sourcing_line_id;

  if v_pr.budget_line_id is distinct from new.budget_line_id
    or v_pr.location_office_id is distinct from new.location_office_id
    or v_pr.activity_id is distinct from new.activity_id then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'An award line carries its PR line''s budget line, location and activity.';
  end if;
  return new;
end;
$$;

create trigger award_line_inherit
  before insert or update on public.award_line
  for each row execute function app.award_line_inherit();

create table public.unsuccessful_notice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  bid_analysis_id uuid not null references public.bid_analysis (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  notified_on date,
  channel text check (channel in (
    'email', 'whatsapp', 'in_person', 'newspaper', 'website', 'notice_board'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (bid_analysis_id, offer_id)
);

create index unsuccessful_notice_tenant_idx on public.unsuccessful_notice (tenant_id);
create index unsuccessful_notice_offer_idx on public.unsuccessful_notice (offer_id);

select app.setup_doc_child_table(
  'public.unsuccessful_notice', 'public.bid_analysis', 'bid_analysis_id');

-- the line-exclusivity trigger needs award_line, so it is attached now
create trigger sourcing_line_open
  after update of status on public.sourcing_event
  for each row when (new.status is distinct from old.status)
  execute function app.sourcing_line_open();

-- =============================================================================================
-- Sealed prices (research D3, SC-009)
-- =============================================================================================

create or replace function app.sourcing_opened(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sourcing_event e
    where e.id = p_event_id and e.opened_at is not null
  );
$$;

-- False while the caller sits on the event's live analysis committee without a declaration or
-- with a declared conflict (US5-5); true for everyone else.
create or replace function app.may_see_offer_prices(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.committee_member m
    join public.bid_analysis b on b.id = m.bid_analysis_id
    where b.sourcing_event_id = p_event_id
      and b.status <> 'cancelled'
      and m.user_id = auth.uid()
      and m.replaced_by_id is null
      and (m.declared_at is null or m.has_conflict)
  );
$$;

-- Prices freeze when the tender opening record is signed or the analysis is first signed.
create or replace function app.offer_prices_frozen(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opening_record r
    where r.sourcing_event_id = p_event_id and r.signed_complete_at is not null
  ) or exists (
    select 1 from public.bid_analysis b
    where b.sourcing_event_id = p_event_id and b.status <> 'cancelled' and b.frozen_at is not null
  );
$$;

revoke execute on function app.sourcing_opened(uuid), app.may_see_offer_prices(uuid),
  app.offer_prices_frozen(uuid) from public, anon;
grant execute on function app.sourcing_opened(uuid), app.may_see_offer_prices(uuid),
  app.offer_prices_frozen(uuid) to authenticated, service_role;

create table public.offer_terms (
  offer_id uuid primary key references public.offer (id) on delete restrict,
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  currency char(3) not null references public.currency (code) on delete restrict,
  delivery_days smallint check (delivery_days >= 0),
  validity_days smallint check (validity_days >= 0),
  payment_terms text,
  essential_compliance jsonb not null default '{}'::jsonb,
  scan_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index offer_terms_tenant_idx on public.offer_terms (tenant_id);
create index offer_terms_event_idx on public.offer_terms (sourcing_event_id);
create index offer_terms_scan_idx on public.offer_terms (scan_attachment_id);

create table public.offer_line_price (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  sourcing_event_id uuid not null references public.sourcing_event (id) on delete restrict,
  sourcing_line_id uuid not null references public.sourcing_line (id) on delete restrict,
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  -- the offered quantity; defaults to the sourcing line's (copied on insert)
  quantity numeric(18, 3) not null check (quantity > 0),
  line_total numeric(18, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (offer_id, sourcing_line_id)
);

create index offer_line_price_tenant_idx on public.offer_line_price (tenant_id);
create index offer_line_price_event_idx on public.offer_line_price (sourcing_event_id);
create index offer_line_price_line_idx on public.offer_line_price (sourcing_line_id);

-- RLS: select AND insert need the opening and price visibility; insert also a valid receipt.
do $$
declare
  v_table text;
  v_read constant text :=
    'tenant_id = (select app.current_tenant_id()) '
    'and app.sourcing_opened(sourcing_event_id) '
    'and app.may_see_offer_prices(sourcing_event_id)';
  v_insert constant text :=
    'tenant_id = (select app.current_tenant_id()) '
    'and app.sourcing_opened(sourcing_event_id) '
    'and app.may_see_offer_prices(sourcing_event_id) '
    'and exists (select 1 from public.offer o where o.id = offer_id '
    'and o.status not in (''late'', ''replaced''))';
begin
  foreach v_table in array array['offer_terms', 'offer_line_price'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy tenant_select on public.%I for select to authenticated using (%s)',
      v_table, v_read);
    execute format(
      'create policy tenant_insert on public.%I for insert to authenticated with check (%s)',
      v_table, v_insert);
    execute format(
      'create policy tenant_update on public.%I for update to authenticated '
      'using (%s) with check (%s)', v_table, v_read, v_insert);
    execute format('revoke delete, truncate on public.%I from anon, authenticated', v_table);
    execute format(
      'create trigger touch_updated_at before update on public.%I '
      'for each row execute function app.touch_updated_at()', v_table);
  end loop;
end;
$$;

create trigger bump_version before update on public.offer_terms
  for each row execute function app.bump_version();

-- The event id on a sealed row is the offer's (it drives the policies), the line belongs to the
-- event, the quantity defaults to the line's, and nothing changes after the freeze.
create or replace function app.offer_sealed_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_event uuid;
  v_line_qty numeric(18, 3);
begin
  select o.sourcing_event_id into v_offer_event
  from public.offer o where o.id = new.offer_id and o.tenant_id = new.tenant_id;
  if v_offer_event is distinct from new.sourcing_event_id then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'The offer does not belong to this sourcing event.';
  end if;

  if app.offer_prices_frozen(new.sourcing_event_id) then
    raise exception 'OFFER_FROZEN' using errcode = 'check_violation',
      detail = 'The offer prices are frozen.';
  end if;

  if tg_table_name = 'offer_line_price' then
    select l.quantity into v_line_qty
    from public.sourcing_line l
    where l.id = new.sourcing_line_id and l.sourcing_event_id = new.sourcing_event_id;
    if v_line_qty is null then
      raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
        detail = 'The line does not belong to this sourcing event.';
    end if;
    if new.quantity is null then
      new.quantity := v_line_qty;
    end if;
  end if;
  return new;
end;
$$;

create trigger offer_sealed_guard
  before insert or update on public.offer_terms
  for each row execute function app.offer_sealed_guard();
create trigger offer_sealed_guard
  before insert or update on public.offer_line_price
  for each row execute function app.offer_sealed_guard();

-- =============================================================================================
-- bid_security (tender; voucher FKs are added by 0019)
-- =============================================================================================

create table public.bid_security (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  offer_id uuid not null references public.offer (id) on delete restrict,
  type text not null check (type in ('bank_guarantee', 'cheque', 'cash_deposit', 'insurance')),
  amount numeric(18, 2) not null check (amount > 0),
  currency char(3) not null references public.currency (code) on delete restrict,
  issuer text,
  expiry_date date,
  status text not null default 'held' check (status in ('held', 'returned', 'forfeited')),
  returned_on date,
  forfeit_reason text,
  receipt_voucher_id uuid,
  return_voucher_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint bid_security_forfeit_reason
    check (status <> 'forfeited' or (forfeit_reason is not null and btrim(forfeit_reason) <> ''))
);

create index bid_security_offer_idx on public.bid_security (offer_id);
create index bid_security_tenant_idx on public.bid_security (tenant_id);

select app.setup_doc_child_table('public.bid_security', 'public.offer', 'offer_id');

create trigger bump_version before update on public.bid_security
  for each row execute function app.bump_version();

-- =============================================================================================
-- Offer scans: no attachment row or object for an unopened event (research D3)
-- =============================================================================================

create or replace function app.offer_scan_sealed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.doc_attachment a
    where a.storage_path = p_path and a.purpose = 'offer_scan'
      and not app.sourcing_opened(a.doc_id)
  );
$$;

revoke execute on function app.offer_scan_sealed(text) from public, anon;
grant execute on function app.offer_scan_sealed(text) to authenticated, service_role;

create policy offer_scan_opened on public.doc_attachment as restrictive
  for all to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (purpose <> 'offer_scan' or app.sourcing_opened(doc_id))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (purpose <> 'offer_scan' or app.sourcing_opened(doc_id))
  );

create policy doc_attachments_offer_scan_select on storage.objects as restrictive
  for select to authenticated
  using (bucket_id <> 'doc-attachments' or not app.offer_scan_sealed(name));
create policy doc_attachments_offer_scan_insert on storage.objects as restrictive
  for insert to authenticated
  with check (bucket_id <> 'doc-attachments' or not app.offer_scan_sealed(name));

-- =============================================================================================
-- Registry, audit, rates in use
-- =============================================================================================

update app.doc_type_registry
set table_name = 'public.sourcing_event', office_column = 'office_id'
where code in ('RFQ', 'TND');
update app.doc_type_registry
set table_name = 'public.bid_analysis', office_column = 'office_id'
where code = 'QA';
update app.doc_type_registry
set table_name = 'public.waiver', office_column = 'office_id'
where code = 'WVR';

insert into app.audit_parent_map (table_name, doc_type, doc_type_column, id_column) values
  ('sourcing_event', null, 'doc_type', 'id'),
  ('bid_analysis', 'QA', null, 'id'),
  ('committee_member', 'QA', null, 'bid_analysis_id'),
  ('evaluation_score', 'QA', null, 'bid_analysis_id'),
  ('award_line', 'QA', null, 'bid_analysis_id'),
  ('unsuccessful_notice', 'QA', null, 'bid_analysis_id'),
  ('waiver', 'WVR', null, 'id');

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'waiver', 'sourcing_event', 'tender_lot', 'tender_publication', 'tender_clarification',
    'sourcing_line', 'sourcing_criterion', 'sourcing_invitation', 'offer', 'offer_terms',
    'offer_line_price', 'opening_record', 'opening_attendee', 'bid_analysis', 'committee_member',
    'evaluation_score', 'award_line', 'unsuccessful_notice', 'bid_security'
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
select w.doa_exchange_rate_id from public.waiver w where w.doa_exchange_rate_id is not null;

revoke all on app.exchange_rate_usage from public, anon, authenticated;

revoke execute on function
  app.sourcing_line_guard(),
  app.sourcing_invitation_guard(),
  app.sourcing_event_guard(),
  app.sourcing_line_open(),
  app.offer_receipt_guard(),
  app.bid_analysis_office(),
  app.evaluation_score_guard(),
  app.analysis_result_frozen(),
  app.award_line_inherit(),
  app.offer_sealed_guard()
from public, anon, authenticated;
