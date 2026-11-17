-- 0018 — supplier invoices, payment requests, cash advances and settlements (002 data-model §7,
-- research R25, R26; US11, US15, US16). The direct-payment, advance and settlement parts are
-- created here too, so this file is applied once.
--
-- * supplier_invoice (numbered INV on registration) / supplier_invoice_line: supplier and office
--   inherited from the PO; one live invoice number per supplier (case and space insensitive);
--   po_line.invoiced_qty maintained from the registered invoices;
-- * payment_request (⟨doc⟩ ⟨doa⟩, numbering PAY / DPR): `order` and `retention` requests take
--   their supplier, grant and office from the PO (INHERITED_FIELD_MISMATCH otherwise), the money
--   account's currency is the payment currency (CURRENCY_MISMATCH), and the amounts are computed
--   by the service (net = gross − advance − retention − deductions, checked here);
-- * payment_request_line (dimensions inherited from the PO line), payment_request_deduction,
--   payment_match_override (one per request);
-- * cash_advance / cash_advance_line and advance_settlement / advance_settlement_line (a
--   settlement line may change the budget line only within the advance's grant);
-- * registry, audit, delete guards and rates in use.

-- =============================================================================================
-- supplier_invoice (numbering INV on registration)
-- =============================================================================================

create table public.supplier_invoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text not null,
  status text not null default 'registered'
    check (status in ('registered', 'matched', 'cancelled')),
  po_id uuid not null references public.purchase_order (id) on delete restrict,
  -- inherited from the PO (trigger)
  office_id uuid not null references public.office (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  supplier_invoice_no text not null check (btrim(supplier_invoice_no) <> ''),
  invoice_date date not null,
  currency char(3) not null references public.currency (code) on delete restrict,
  -- Σ lines (trigger)
  amount numeric(18, 2) not null default 0 check (amount >= 0),
  -- the scanned invoice, an attachment of the PO
  attachment_id uuid references public.doc_attachment (id) on delete restrict,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (tenant_id, number),
  constraint supplier_invoice_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

-- US11-5: one live invoice number per supplier, ignoring case and surrounding spaces
create unique index supplier_invoice_no_unique
  on public.supplier_invoice (tenant_id, supplier_id, lower(btrim(supplier_invoice_no)))
  where status <> 'cancelled';
create index supplier_invoice_tenant_status_idx on public.supplier_invoice (tenant_id, status);
create index supplier_invoice_po_idx on public.supplier_invoice (po_id);
create index supplier_invoice_office_idx on public.supplier_invoice (office_id);
create index supplier_invoice_supplier_idx on public.supplier_invoice (supplier_id);
create index supplier_invoice_attachment_idx on public.supplier_invoice (attachment_id);
create index supplier_invoice_created_by_idx on public.supplier_invoice (created_by);

select app.setup_office_doc_table('public.supplier_invoice', 'office_id');

create trigger bump_version before update on public.supplier_invoice
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.supplier_invoice
  for each row execute function app.block_delete_after_draft('status_only');

-- An invoice belongs to an approved PO, in its currency; supplier and office are the PO's and
-- never change (BR-1, SC-002).
create or replace function app.supplier_invoice_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
begin
  select p.status, p.office_id, p.supplier_id, p.currency into v_po
  from public.purchase_order p where p.id = new.po_id and p.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Purchase order not found.';
  end if;

  if tg_op = 'UPDATE' then
    if new.po_id <> old.po_id or new.supplier_id <> v_po.supplier_id
      or new.office_id <> v_po.office_id then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'An invoice keeps the supplier and office of its purchase order.';
    end if;
    return new;
  end if;

  if v_po.status not in ('approved', 'acknowledged', 'partially_received', 'fully_received') then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'Invoices are registered against an approved, open purchase order.';
  end if;
  if new.currency <> v_po.currency then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'The invoice is in the currency of its purchase order.';
  end if;
  new.supplier_id := v_po.supplier_id;
  new.office_id := v_po.office_id;
  return new;
end;
$$;

create trigger supplier_invoice_inherit
  before insert or update on public.supplier_invoice
  for each row execute function app.supplier_invoice_inherit();

create table public.supplier_invoice_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  invoice_id uuid not null references public.supplier_invoice (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete restrict,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  line_total numeric(18, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (invoice_id, po_line_id)
);

create index supplier_invoice_line_tenant_idx on public.supplier_invoice_line (tenant_id);
create index supplier_invoice_line_po_line_idx on public.supplier_invoice_line (po_line_id);

select app.setup_doc_child_table(
  'public.supplier_invoice_line', 'public.supplier_invoice', 'invoice_id');

-- The PO line belongs to the invoice's PO; the header amount is Σ lines.
create or replace function app.supplier_invoice_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
begin
  if tg_op = 'DELETE' then
    v_invoice := old.invoice_id;
  else
    v_invoice := new.invoice_id;
    if not exists (
      select 1 from public.supplier_invoice i
      join public.po_line l on l.po_id = i.po_id
      where i.id = new.invoice_id and l.id = new.po_line_id
    ) then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'An invoice line belongs to a line of the invoice''s purchase order.';
    end if;
  end if;
  update public.supplier_invoice i
  set amount = coalesce((
    select sum(x.line_total) from public.supplier_invoice_line x where x.invoice_id = i.id
  ), 0)
  where i.id = v_invoice;
  return null;
end;
$$;

create trigger supplier_invoice_line_guard
  after insert or update or delete on public.supplier_invoice_line
  for each row execute function app.supplier_invoice_line_guard();

-- po_line.invoiced_qty = Σ quantities on the PO's live invoices
create or replace function app.supplier_invoice_refresh_qty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid;
begin
  if tg_table_name = 'supplier_invoice' then
    v_po := new.po_id;
  elsif tg_op = 'DELETE' then
    select i.po_id into v_po from public.supplier_invoice i where i.id = old.invoice_id;
  else
    select i.po_id into v_po from public.supplier_invoice i where i.id = new.invoice_id;
  end if;
  update public.po_line l
  set invoiced_qty = coalesce((
    select sum(x.quantity)
    from public.supplier_invoice_line x
    join public.supplier_invoice i on i.id = x.invoice_id
    where x.po_line_id = l.id and i.status <> 'cancelled'
  ), 0)
  where l.po_id = v_po;
  return null;
end;
$$;

create trigger supplier_invoice_refresh_qty
  after update of status on public.supplier_invoice
  for each row when (new.status is distinct from old.status)
  execute function app.supplier_invoice_refresh_qty();
create trigger supplier_invoice_line_refresh_qty
  after insert or update or delete on public.supplier_invoice_line
  for each row execute function app.supplier_invoice_refresh_qty();

-- =============================================================================================
-- payment_request (⟨doc⟩ ⟨doa⟩; numbering PAY / DPR; DoA types PAY / DPR)
-- =============================================================================================

create table public.payment_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  kind text not null check (kind in ('order', 'retention', 'direct', 'bid_security_return')),
  doc_type text generated always as (case kind when 'direct' then 'DPR' else 'PAY' end) stored,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'paid', 'returned', 'rejected', 'cancelled'
  )),
  office_id uuid not null references public.office (id) on delete restrict,
  -- sources (order / retention)
  po_id uuid references public.purchase_order (id) on delete restrict,
  invoice_id uuid references public.supplier_invoice (id) on delete restrict,
  is_advance boolean not null default false,
  -- the receipts matched (their signers may not sign the request, receiver_approves_payment)
  grn_ids uuid[] not null default '{}',
  certificate_ids uuid[] not null default '{}',
  -- payee: exactly one of the three
  payee_type text not null check (payee_type in ('supplier', 'staff', 'other')),
  supplier_id uuid references public.supplier (id) on delete restrict,
  staff_payee_id uuid references public.staff_payee (id) on delete restrict,
  payee_name text,
  -- payee bank snapshot (copied at creation)
  payee_bank_name text,
  payee_bank_branch text,
  payee_account_name text,
  payee_account_no text,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  category_id uuid references public.payment_category (id) on delete restrict,
  period_text text,
  payment_method text not null
    check (payment_method in ('bank_transfer', 'cheque', 'bank_draft', 'cash')),
  money_account_id uuid not null references public.money_account (id) on delete restrict,
  -- payment currency and ⟨rate⟩ on the request date; PO currency rate when it differs
  currency char(3) not null references public.currency (code) on delete restrict,
  rate_to_base numeric(18, 6) not null default 1 check (rate_to_base > 0),
  rate_date date,
  rate_source text,
  exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  po_rate_to_base numeric(18, 6) check (po_rate_to_base > 0),
  po_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  -- computed only (payment currency); never accepted from the API (FR-058)
  gross numeric(18, 2) not null default 0 check (gross >= 0),
  advance_deduction numeric(18, 2) not null default 0 check (advance_deduction >= 0),
  retention_amount numeric(18, 2) not null default 0 check (retention_amount >= 0),
  deductions_total numeric(18, 2) not null default 0 check (deductions_total >= 0),
  net numeric(18, 2) not null default 0 check (net >= 0),
  -- what the request counts against the PO total, in the PO currency (FR-060)
  po_amount numeric(18, 2) not null default 0 check (po_amount >= 0),
  amount_in_words_ar text,
  amount_in_words_en text,
  match_status text not null default 'n_a'
    check (match_status in ('matched', 'mismatch', 'overridden', 'n_a')),
  paid_at timestamptz,
  paid_on date,
  -- Finance Manager override for a suspended / closed grant or a blacklisted supplier
  frozen_grant_override jsonb,
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
  constraint payment_request_payee check (
    (payee_type = 'supplier' and supplier_id is not null and staff_payee_id is null
       and payee_name is null)
    or (payee_type = 'staff' and staff_payee_id is not null and supplier_id is null
       and payee_name is null)
    or (payee_type = 'other' and payee_name is not null and btrim(payee_name) <> ''
       and supplier_id is null and staff_payee_id is null)
  ),
  constraint payment_request_order_source check (
    kind not in ('order', 'retention')
    or (po_id is not null and payee_type = 'supplier'
        and (kind <> 'order' or is_advance or invoice_id is not null))
  ),
  constraint payment_request_direct_source check (
    kind <> 'direct' or (po_id is null and invoice_id is null and not is_advance)
  ),
  constraint payment_request_advance_kind check (not is_advance or kind = 'order'),
  constraint payment_request_net check (
    net = gross - advance_deduction - retention_amount - deductions_total
  ),
  constraint payment_request_base_rate check (
    (rate_source = 'base') = (exchange_rate_id is null) or rate_source is null
  ),
  constraint payment_request_paid check ((status = 'paid') = (paid_at is not null)),
  constraint payment_request_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

-- one live request per invoice
create unique index payment_request_one_per_invoice
  on public.payment_request (invoice_id)
  where invoice_id is not null and status not in ('cancelled', 'rejected');
create index payment_request_tenant_status_idx on public.payment_request (tenant_id, status);
create index payment_request_office_idx on public.payment_request (office_id);
create index payment_request_po_idx on public.payment_request (po_id);
create index payment_request_supplier_idx on public.payment_request (supplier_id);
create index payment_request_staff_payee_idx on public.payment_request (staff_payee_id);
create index payment_request_grant_idx on public.payment_request (grant_id);
create index payment_request_category_idx on public.payment_request (category_id);
create index payment_request_money_account_idx on public.payment_request (money_account_id);
create index payment_request_rate_idx on public.payment_request (exchange_rate_id);
create index payment_request_po_rate_idx on public.payment_request (po_exchange_rate_id);
create index payment_request_doa_rate_idx on public.payment_request (doa_exchange_rate_id);
create index payment_request_created_by_idx on public.payment_request (created_by);

select app.setup_office_doc_table('public.payment_request', 'office_id');

create trigger bump_version before update on public.payment_request
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.payment_request
  for each row execute function app.block_delete_after_draft();

-- Order and retention requests take supplier, grant and office from the PO and the invoice from
-- the same PO; none of them changes afterwards. The money account pays in the request currency
-- (FR-075).
create or replace function app.payment_request_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
  v_account record;
begin
  select m.currency, m.is_active into v_account
  from public.money_account m
  where m.id = new.money_account_id and m.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Bank or cash account not found.';
  end if;
  if v_account.currency <> new.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'check_violation',
      detail = format('The account pays in %s, the request is in %s.',
                      v_account.currency, new.currency);
  end if;

  if new.kind not in ('order', 'retention') then
    return new;
  end if;

  select p.supplier_id, p.grant_id, p.office_id into v_po
  from public.purchase_order p where p.id = new.po_id and p.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Purchase order not found.';
  end if;
  if new.invoice_id is not null and not exists (
    select 1 from public.supplier_invoice i where i.id = new.invoice_id and i.po_id = new.po_id
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'The invoice belongs to the request''s purchase order.';
  end if;

  if tg_op = 'UPDATE' then
    if new.po_id <> old.po_id or new.kind <> old.kind
      or new.supplier_id is distinct from v_po.supplier_id
      or new.grant_id <> v_po.grant_id or new.office_id <> v_po.office_id
      or new.invoice_id is distinct from old.invoice_id then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A payment request keeps the supplier, grant and office of its purchase order.';
    end if;
    return new;
  end if;

  new.payee_type := 'supplier';
  new.supplier_id := v_po.supplier_id;
  new.grant_id := v_po.grant_id;
  new.office_id := v_po.office_id;
  return new;
end;
$$;

create trigger payment_request_inherit
  before insert or update on public.payment_request
  for each row execute function app.payment_request_inherit();

create table public.payment_request_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  payment_request_id uuid not null references public.payment_request (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  po_line_id uuid references public.po_line (id) on delete restrict,
  grn_line_id uuid references public.grn_line (id) on delete restrict,
  certificate_id uuid references public.completion_certificate (id) on delete restrict,
  description text,
  quantity numeric(18, 3) check (quantity > 0),
  unit_price numeric(18, 2) check (unit_price >= 0),
  -- payment currency
  gross numeric(18, 2) not null check (gross >= 0),
  -- ⟨dims⟩: inherited from the PO line (trigger) or entered on direct lines
  grant_id uuid not null references public."grant" (id) on delete restrict,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  -- the match (order lines on an invoice)
  invoiced_qty numeric(18, 3),
  accepted_qty numeric(18, 3),
  po_price numeric(18, 2),
  match_result text check (match_result in ('ok', 'qty_exceeds', 'price_exceeds')),
  -- grant currency: at the request rates (direct) or the PO commit rate (order)
  amount_grant numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (payment_request_id, line_no) deferrable initially deferred
);

create index payment_request_line_tenant_idx on public.payment_request_line (tenant_id);
create index payment_request_line_po_line_idx on public.payment_request_line (po_line_id);
create index payment_request_line_grn_line_idx on public.payment_request_line (grn_line_id);
create index payment_request_line_certificate_idx on public.payment_request_line (certificate_id);
create index payment_request_line_grant_idx on public.payment_request_line (grant_id);
create index payment_request_line_budget_line_idx on public.payment_request_line (budget_line_id);
create index payment_request_line_location_idx on public.payment_request_line (location_office_id);
create index payment_request_line_activity_idx on public.payment_request_line (activity_id);

select app.setup_doc_child_table(
  'public.payment_request_line', 'public.payment_request', 'payment_request_id');

-- Lines of a PO request copy the PO line's dimensions and the request's grant; a direct line's
-- budget line belongs to the request's grant (BR-1, BR-2, SC-002).
create or replace function app.payment_request_line_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_line record;
begin
  select r.kind, r.po_id, r.grant_id into v_request
  from public.payment_request r where r.id = new.payment_request_id;

  if v_request.po_id is null then
    if new.po_line_id is not null then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A direct payment line has no purchase order line.';
    end if;
    if new.grant_id <> v_request.grant_id or not exists (
      select 1 from public.budget_line b
      where b.id = new.budget_line_id and b.grant_id = v_request.grant_id
    ) then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A payment line is charged to a budget line of the request''s grant.';
    end if;
    return new;
  end if;

  select l.po_id, l.budget_line_id, l.location_office_id, l.activity_id into v_line
  from public.po_line l where l.id = new.po_line_id;
  if not found or v_line.po_id <> v_request.po_id then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'A payment line belongs to a line of the request''s purchase order.';
  end if;

  if tg_op = 'UPDATE' then
    if new.po_line_id <> old.po_line_id or new.grant_id <> v_request.grant_id
      or new.budget_line_id <> v_line.budget_line_id
      or new.location_office_id is distinct from v_line.location_office_id
      or new.activity_id is distinct from v_line.activity_id then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A payment line keeps the grant, budget line, location and activity of its PO line.';
    end if;
    return new;
  end if;

  new.grant_id := v_request.grant_id;
  new.budget_line_id := v_line.budget_line_id;
  new.location_office_id := v_line.location_office_id;
  new.activity_id := v_line.activity_id;
  return new;
end;
$$;

create trigger payment_request_line_inherit
  before insert or update on public.payment_request_line
  for each row execute function app.payment_request_line_inherit();

create table public.payment_request_deduction (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  payment_request_id uuid not null references public.payment_request (id) on delete cascade,
  deduction_type_id uuid not null references public.deduction_type (id) on delete restrict,
  base numeric(18, 2) not null check (base >= 0),
  rate_pct numeric(5, 2) not null check (rate_pct between 0 and 100),
  amount numeric(18, 2) not null check (amount >= 0),
  -- copied from the deduction type
  payable_account_id uuid not null references public.gl_account (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (payment_request_id, deduction_type_id),
  constraint payment_request_deduction_amount check (amount = round(base * rate_pct / 100, 2))
);

create index payment_request_deduction_tenant_idx on public.payment_request_deduction (tenant_id);
create index payment_request_deduction_type_idx
  on public.payment_request_deduction (deduction_type_id);
create index payment_request_deduction_account_idx
  on public.payment_request_deduction (payable_account_id);

select app.setup_doc_child_table(
  'public.payment_request_deduction', 'public.payment_request', 'payment_request_id');

-- The override of a failed match (FR-056); the `override_match` signature sits in doc_signature.
create table public.payment_match_override (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  payment_request_id uuid not null unique
    references public.payment_request (id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id)
);

create index payment_match_override_tenant_idx on public.payment_match_override (tenant_id);
create index payment_match_override_created_by_idx on public.payment_match_override (created_by);

select app.setup_doc_child_table(
  'public.payment_match_override', 'public.payment_request', 'payment_request_id');

-- The preparer cannot override (override_by_preparer; DB backstop of segregation.service).
create or replace function app.payment_match_override_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.payment_request r
    where r.id = new.payment_request_id and r.created_by = new.created_by
  ) then
    raise exception 'SEGREGATION_OF_DUTIES' using errcode = 'check_violation',
      detail = 'The preparer of a payment request cannot override its match.';
  end if;
  return new;
end;
$$;

create trigger payment_match_override_guard
  before insert or update on public.payment_match_override
  for each row execute function app.payment_match_override_guard();

-- =============================================================================================
-- cash_advance (⟨doc⟩ ⟨doa⟩; numbering ADV) / cash_advance_line (US16)
-- =============================================================================================

create table public.cash_advance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'paid', 'partially_settled', 'settled',
    'returned', 'rejected', 'cancelled'
  )),
  office_id uuid not null references public.office (id) on delete restrict,
  staff_payee_id uuid not null references public.staff_payee (id) on delete restrict,
  purpose text not null check (btrim(purpose) <> ''),
  grant_id uuid not null references public."grant" (id) on delete restrict,
  expected_settlement_date date not null,
  currency char(3) not null references public.currency (code) on delete restrict,
  rate_to_base numeric(18, 6) not null default 1 check (rate_to_base > 0),
  rate_date date,
  rate_source text,
  exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  -- Σ lines (trigger)
  total numeric(18, 2) not null default 0 check (total >= 0),
  -- the overdue-advance waiver (FR-081)
  waiver_id uuid references public.waiver (id) on delete restrict,
  -- the BPV/CPV that paid it (FK added by 0019)
  paid_voucher_id uuid,
  settled_amount numeric(18, 2) not null default 0 check (settled_amount >= 0),
  returned_amount numeric(18, 2) not null default 0 check (returned_amount >= 0),
  outstanding numeric(18, 2) generated always as (total - settled_amount - returned_amount) stored,
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
  constraint cash_advance_outstanding check (settled_amount + returned_amount <= total),
  constraint cash_advance_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

create index cash_advance_tenant_status_idx on public.cash_advance (tenant_id, status);
create index cash_advance_office_idx on public.cash_advance (office_id);
create index cash_advance_staff_payee_idx on public.cash_advance (staff_payee_id);
create index cash_advance_grant_idx on public.cash_advance (grant_id);
create index cash_advance_waiver_idx on public.cash_advance (waiver_id);
create index cash_advance_rate_idx on public.cash_advance (exchange_rate_id);
create index cash_advance_doa_rate_idx on public.cash_advance (doa_exchange_rate_id);
create index cash_advance_paid_voucher_idx on public.cash_advance (paid_voucher_id);
create index cash_advance_created_by_idx on public.cash_advance (created_by);

select app.setup_office_doc_table('public.cash_advance', 'office_id');

create trigger bump_version before update on public.cash_advance
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.cash_advance
  for each row execute function app.block_delete_after_draft();

create table public.cash_advance_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  cash_advance_id uuid not null references public.cash_advance (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  description text not null check (btrim(description) <> ''),
  amount numeric(18, 2) not null check (amount > 0),
  amount_grant numeric(18, 2),
  -- ⟨dims⟩
  grant_id uuid not null references public."grant" (id) on delete restrict,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (cash_advance_id, line_no) deferrable initially deferred
);

create index cash_advance_line_tenant_idx on public.cash_advance_line (tenant_id);
create index cash_advance_line_grant_idx on public.cash_advance_line (grant_id);
create index cash_advance_line_budget_line_idx on public.cash_advance_line (budget_line_id);
create index cash_advance_line_location_idx on public.cash_advance_line (location_office_id);
create index cash_advance_line_activity_idx on public.cash_advance_line (activity_id);

select app.setup_doc_child_table('public.cash_advance_line', 'public.cash_advance', 'cash_advance_id');

-- =============================================================================================
-- advance_settlement (⟨doc⟩ ⟨doa⟩; numbering STL) / advance_settlement_line (US16)
-- =============================================================================================

create table public.advance_settlement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'posted', 'returned', 'rejected', 'cancelled'
  )),
  office_id uuid not null references public.office (id) on delete restrict,
  cash_advance_id uuid not null references public.cash_advance (id) on delete restrict,
  settlement_date date not null,
  -- Σ lines (trigger)
  receipts_total numeric(18, 2) not null default 0 check (receipts_total >= 0),
  -- outstanding at submission − receipts: positive = returned, negative = paid in addition
  return_amount numeric(18, 2) not null default 0 check (return_amount >= 0),
  additional_amount numeric(18, 2) not null default 0 check (additional_amount >= 0),
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
  constraint advance_settlement_one_side check (return_amount = 0 or additional_amount = 0),
  constraint advance_settlement_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

create index advance_settlement_tenant_status_idx on public.advance_settlement (tenant_id, status);
create index advance_settlement_office_idx on public.advance_settlement (office_id);
create index advance_settlement_advance_idx on public.advance_settlement (cash_advance_id);
create index advance_settlement_doa_rate_idx on public.advance_settlement (doa_exchange_rate_id);
create index advance_settlement_created_by_idx on public.advance_settlement (created_by);

select app.setup_office_doc_table('public.advance_settlement', 'office_id');

create trigger bump_version before update on public.advance_settlement
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.advance_settlement
  for each row execute function app.block_delete_after_draft();

create table public.advance_settlement_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  settlement_id uuid not null references public.advance_settlement (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  advance_line_id uuid not null references public.cash_advance_line (id) on delete restrict,
  description text not null check (btrim(description) <> ''),
  amount numeric(18, 2) not null check (amount > 0),
  receipt_attachment_ids uuid[] not null default '{}',
  -- ⟨dims⟩: the budget line may differ from the advance line's only within the same grant
  grant_id uuid not null references public."grant" (id) on delete restrict,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (settlement_id, line_no) deferrable initially deferred
);

create index advance_settlement_line_tenant_idx on public.advance_settlement_line (tenant_id);
create index advance_settlement_line_advance_line_idx
  on public.advance_settlement_line (advance_line_id);
create index advance_settlement_line_grant_idx on public.advance_settlement_line (grant_id);
create index advance_settlement_line_budget_line_idx
  on public.advance_settlement_line (budget_line_id);
create index advance_settlement_line_location_idx
  on public.advance_settlement_line (location_office_id);
create index advance_settlement_line_activity_idx on public.advance_settlement_line (activity_id);

select app.setup_doc_child_table(
  'public.advance_settlement_line', 'public.advance_settlement', 'settlement_id');

-- Advance lines are charged to the advance's grant; settlement lines keep the grant of the
-- advance line they settle and use a budget line of that grant.
create or replace function app.advance_line_dims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  if tg_table_name = 'cash_advance_line' then
    select a.grant_id into v_grant from public.cash_advance a where a.id = new.cash_advance_id;
  else
    select a.grant_id into v_grant
    from public.advance_settlement s
    join public.cash_advance a on a.id = s.cash_advance_id
    where s.id = new.settlement_id;
    if not exists (
      select 1 from public.cash_advance_line l
      join public.advance_settlement s on s.cash_advance_id = l.cash_advance_id
      where l.id = new.advance_line_id and s.id = new.settlement_id
    ) then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A settlement line settles a line of the settlement''s advance.';
    end if;
  end if;

  if new.grant_id <> v_grant or not exists (
    select 1 from public.budget_line b where b.id = new.budget_line_id and b.grant_id = v_grant
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'The line is charged to a budget line of the advance''s grant.';
  end if;
  return new;
end;
$$;

create trigger advance_line_dims
  before insert or update on public.cash_advance_line
  for each row execute function app.advance_line_dims();
create trigger advance_line_dims
  before insert or update on public.advance_settlement_line
  for each row execute function app.advance_line_dims();

-- Header totals: advance total = Σ lines; settlement receipts = Σ lines.
create or replace function app.advance_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  if tg_table_name = 'cash_advance_line' then
    update public.cash_advance a
    set total = coalesce((
      select sum(l.amount) from public.cash_advance_line l where l.cash_advance_id = a.id
    ), 0)
    where a.id = (v_row ->> 'cash_advance_id')::uuid;
  else
    update public.advance_settlement s
    set receipts_total = coalesce((
      select sum(l.amount) from public.advance_settlement_line l where l.settlement_id = s.id
    ), 0)
    where s.id = (v_row ->> 'settlement_id')::uuid;
  end if;
  return null;
end;
$$;

create trigger advance_totals
  after insert or update or delete on public.cash_advance_line
  for each row execute function app.advance_totals();
create trigger advance_totals
  after insert or update or delete on public.advance_settlement_line
  for each row execute function app.advance_totals();

-- =============================================================================================
-- Registry, audit, rates in use
-- =============================================================================================

update app.doc_type_registry
set table_name = 'public.supplier_invoice', office_column = 'office_id'
where code = 'INV';
update app.doc_type_registry
set table_name = 'public.payment_request', office_column = 'office_id'
where code in ('PAY', 'DPR');
update app.doc_type_registry
set table_name = 'public.cash_advance', office_column = 'office_id'
where code = 'ADV';
update app.doc_type_registry
set table_name = 'public.advance_settlement', office_column = 'office_id'
where code = 'STL';

insert into app.audit_parent_map (table_name, doc_type, doc_type_column, id_column) values
  ('supplier_invoice', 'INV', null, 'id'),
  ('supplier_invoice_line', 'INV', null, 'invoice_id'),
  ('payment_request', null, 'doc_type', 'id'),
  ('payment_request_line', 'PAY', null, 'payment_request_id'),
  ('payment_request_deduction', 'PAY', null, 'payment_request_id'),
  ('payment_match_override', 'PAY', null, 'payment_request_id'),
  ('cash_advance', 'ADV', null, 'id'),
  ('cash_advance_line', 'ADV', null, 'cash_advance_id'),
  ('advance_settlement', 'STL', null, 'id'),
  ('advance_settlement_line', 'STL', null, 'settlement_id');

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'supplier_invoice', 'supplier_invoice_line', 'payment_request', 'payment_request_line',
    'payment_request_deduction', 'payment_match_override', 'cash_advance', 'cash_advance_line',
    'advance_settlement', 'advance_settlement_line'
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
select a.doa_exchange_rate_id from public.po_amendment a where a.doa_exchange_rate_id is not null
union all
select r.exchange_rate_id from public.payment_request r where r.exchange_rate_id is not null
union all
select r.po_exchange_rate_id from public.payment_request r where r.po_exchange_rate_id is not null
union all
select r.doa_exchange_rate_id from public.payment_request r
where r.doa_exchange_rate_id is not null
union all
select a.exchange_rate_id from public.cash_advance a where a.exchange_rate_id is not null
union all
select a.doa_exchange_rate_id from public.cash_advance a where a.doa_exchange_rate_id is not null
union all
select s.doa_exchange_rate_id from public.advance_settlement s
where s.doa_exchange_rate_id is not null;

revoke all on app.exchange_rate_usage from public, anon, authenticated;

revoke execute on function
  app.supplier_invoice_inherit(),
  app.supplier_invoice_line_guard(),
  app.supplier_invoice_refresh_qty(),
  app.payment_request_inherit(),
  app.payment_request_line_inherit(),
  app.payment_match_override_guard(),
  app.advance_line_dims(),
  app.advance_totals()
from public, anon, authenticated;
