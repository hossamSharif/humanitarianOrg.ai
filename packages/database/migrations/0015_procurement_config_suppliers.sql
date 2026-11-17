-- 0015 — procurement configuration and the supplier registry (002 data-model §2 and §3, US1,
-- US2): settings, method bands (tenant and per grant), deduction types, payment categories,
-- suppliers with categories, documents, insert-only vetting and ratings, staff payees, the
-- compliance view and duplicate lookups, and the per-tenant defaults (seed hook 30).

-- =============================================================================================
-- procurement_setting (one row per tenant)
-- =============================================================================================

create table public.procurement_setting (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenant (id) on delete restrict,
  invoice_price_tolerance_pct numeric(5, 2) not null default 0
    check (invoice_price_tolerance_pct between 0 and 100),
  invoice_qty_tolerance_pct numeric(5, 2) not null default 0
    check (invoice_qty_tolerance_pct between 0 and 100),
  grn_over_delivery_tolerance_pct numeric(5, 2) not null default 0
    check (grn_over_delivery_tolerance_pct between 0 and 100),
  committee_min_size smallint not null default 3 check (committee_min_size >= 2),
  revetting_months smallint not null default 12 check (revetting_months >= 1),
  guarantee_warning_days smallint not null default 30 check (guarantee_warning_days >= 1),
  advance_overdue_days smallint not null default 30 check (advance_overdue_days >= 0),
  require_po_acknowledgement boolean not null default true,
  splitting_window_days smallint not null default 30 check (splitting_window_days >= 0),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

select app.setup_tenant_table('public.procurement_setting');

create trigger bump_version before update on public.procurement_setting
  for each row execute function app.bump_version();

revoke delete on public.procurement_setting from anon, authenticated;

-- =============================================================================================
-- Method bands: the tenant set and optional stricter per-grant sets (research D4)
-- =============================================================================================

create table public.procurement_method_band (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  method text not null check (method in ('direct', 'rfq', 'tender')),
  min_amount numeric(18, 2) check (min_amount >= 0),
  max_amount numeric(18, 2) check (max_amount > 0),
  min_quotations smallint not null check (min_quotations >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint procurement_method_band_not_empty
    check (max_amount is null or max_amount > coalesce(min_amount, 0))
);

create index procurement_method_band_tenant_idx on public.procurement_method_band (tenant_id);

select app.setup_tenant_table('public.procurement_method_band');

create table public.grant_procurement_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  method text not null check (method in ('direct', 'rfq', 'tender')),
  min_amount numeric(18, 2) check (min_amount >= 0),
  max_amount numeric(18, 2) check (max_amount > 0),
  min_quotations smallint not null check (min_quotations >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint grant_procurement_rule_not_empty
    check (max_amount is null or max_amount > coalesce(min_amount, 0))
);

create index grant_procurement_rule_tenant_idx on public.grant_procurement_rule (tenant_id);
create index grant_procurement_rule_grant_idx on public.grant_procurement_rule (grant_id);

select app.setup_tenant_table('public.grant_procurement_rule');

-- One band set (the tenant's when p_grant is null) must start at 0, be contiguous and
-- non-overlapping, and end open. An empty grant set means "no grant rule"; the tenant set may
-- not be empty. The service explains the problem first (PROCUREMENT_BANDS_INVALID); this is
-- the backstop, deferred so a full replace is checked once at commit (as 0011).
create or replace function app.procurement_bands_check(p_tenant uuid, p_grant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_band record;
  v_first boolean := true;
  v_prev_max numeric(18, 2);
  v_problem text;
  v_count integer := 0;
begin
  for v_band in
    select coalesce(b.min_amount, 0) as lo, b.max_amount as hi
    from (
      select min_amount, max_amount from public.procurement_method_band
      where p_grant is null and tenant_id = p_tenant
      union all
      select min_amount, max_amount from public.grant_procurement_rule
      where p_grant is not null and tenant_id = p_tenant and grant_id = p_grant
    ) b
    order by coalesce(b.min_amount, 0), b.max_amount nulls last
  loop
    v_count := v_count + 1;
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

  if v_problem is null then
    if v_count = 0 then
      if p_grant is null and exists (select 1 from public.tenant t where t.id = p_tenant) then
        v_problem := 'no_bands';
      end if;
    elsif v_prev_max is not null then
      v_problem := 'band_not_open_ended';
    end if;
  end if;

  if v_problem is not null then
    raise exception 'PROCUREMENT_BANDS_INVALID'
      using errcode = 'check_violation',
            detail = format('tenant_id=%s grant_id=%s reason=%s', p_tenant, p_grant, v_problem);
  end if;
end;
$$;

create or replace function app.procurement_bands_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'procurement_method_band' then
    if tg_op in ('INSERT', 'UPDATE') then
      perform app.procurement_bands_check(new.tenant_id, null);
    end if;
    if tg_op = 'DELETE' then
      perform app.procurement_bands_check(old.tenant_id, null);
    end if;
  else
    if tg_op in ('INSERT', 'UPDATE') then
      perform app.procurement_bands_check(new.tenant_id, new.grant_id);
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      perform app.procurement_bands_check(old.tenant_id, old.grant_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger procurement_method_band_guard
  after insert or update or delete on public.procurement_method_band
  deferrable initially deferred
  for each row execute function app.procurement_bands_guard();

create constraint trigger grant_procurement_rule_guard
  after insert or update or delete on public.grant_procurement_rule
  deferrable initially deferred
  for each row execute function app.procurement_bands_guard();

revoke execute on function app.procurement_bands_check(uuid, uuid), app.procurement_bands_guard()
  from public, anon, authenticated;

-- =============================================================================================
-- deduction_type, payment_category
-- =============================================================================================

create table public.deduction_type (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  name_ar text not null check (btrim(name_ar) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  rate_pct numeric(5, 2) not null default 0 check (rate_pct between 0 and 100),
  applies_to text not null default 'both' check (applies_to in ('goods', 'services', 'both')),
  payable_account_id uuid not null references public.gl_account (id) on delete restrict,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, name_en)
);

create index deduction_type_account_idx on public.deduction_type (payable_account_id);

select app.setup_tenant_table('public.deduction_type');

create trigger bump_version before update on public.deduction_type
  for each row execute function app.bump_version();

create or replace function app.deduction_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.gl_account_is(new.payable_account_id, new.tenant_id, 'liability') then
    raise exception 'VALIDATION_ERROR'
      using errcode = 'check_violation',
            detail = 'The payable account must be a posting account of type liability.';
  end if;
  return new;
end;
$$;

create trigger deduction_account_check
  before insert or update of payable_account_id on public.deduction_type
  for each row execute function app.deduction_account_check();

create table public.payment_category (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name_ar text not null check (btrim(name_ar) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  procurement_only boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, code)
);

select app.setup_tenant_table('public.payment_category');

create trigger bump_version before update on public.payment_category
  for each row execute function app.bump_version();

revoke delete on public.deduction_type, public.payment_category from anon, authenticated;

-- =============================================================================================
-- Suppliers (data-model §3)
-- =============================================================================================

create table public.supplier (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  legal_name_ar text not null check (btrim(legal_name_ar) <> ''),
  legal_name_en text not null check (btrim(legal_name_en) <> ''),
  trade_name text,
  type text not null default 'company' check (type in ('company', 'individual', 'government', 'ngo')),
  registration_no text,
  tax_no text,
  address text,
  city text,
  phone text,
  email text,
  contact_person text,
  bank_name text,
  bank_branch text,
  bank_account_name text,
  bank_account_no text,
  notes text,
  status text not null default 'pending_vetting'
    check (status in ('pending_vetting', 'approved', 'suspended', 'blacklisted')),
  status_reason text,
  last_vetted_at date,
  rating_avg_on_time numeric(3, 2),
  rating_avg_quality numeric(3, 2),
  rating_avg_docs numeric(3, 2),
  rating_count smallint not null default 0,
  -- normalized copies for duplicate warnings (FR-012)
  registration_no_norm text generated always as (nullif(upper(btrim(registration_no)), '')) stored,
  tax_no_norm text generated always as (nullif(upper(btrim(tax_no)), '')) stored,
  phone_norm text generated always as (nullif(regexp_replace(phone, '\D', '', 'g'), '')) stored,
  bank_account_no_norm text
    generated always as (nullif(regexp_replace(upper(bank_account_no), '[^0-9A-Z]', '', 'g'), ''))
    stored,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint supplier_status_reason
    check (status not in ('suspended', 'blacklisted')
           or (status_reason is not null and btrim(status_reason) <> ''))
);

create index supplier_tenant_status_idx on public.supplier (tenant_id, status);
create index supplier_registration_norm_idx on public.supplier (tenant_id, registration_no_norm)
  where registration_no_norm is not null;
create index supplier_tax_norm_idx on public.supplier (tenant_id, tax_no_norm)
  where tax_no_norm is not null;
create index supplier_phone_norm_idx on public.supplier (tenant_id, phone_norm)
  where phone_norm is not null;
create index supplier_bank_norm_idx on public.supplier (tenant_id, bank_account_no_norm)
  where bank_account_no_norm is not null;

select app.setup_tenant_table('public.supplier');

create trigger bump_version before update on public.supplier
  for each row execute function app.bump_version();

create table public.supplier_category (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name_ar text not null check (btrim(name_ar) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, code)
);

select app.setup_tenant_table('public.supplier_category');

create trigger bump_version before update on public.supplier_category
  for each row execute function app.bump_version();

create table public.supplier_category_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete cascade,
  category_id uuid not null references public.supplier_category (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (supplier_id, category_id)
);

create index supplier_category_link_category_idx on public.supplier_category_link (category_id);
create index supplier_category_link_tenant_idx on public.supplier_category_link (tenant_id);

select app.setup_tenant_table('public.supplier_category_link');

create table public.supplier_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  doc_kind text not null check (doc_kind in ('registration', 'tax', 'other')),
  is_required boolean not null default false,
  number text,
  issue_date date,
  expiry_date date,
  attachment_id uuid references public.doc_attachment (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint supplier_document_dates check (expiry_date is null or issue_date is null
                                            or expiry_date >= issue_date)
);

create index supplier_document_supplier_idx on public.supplier_document (supplier_id);
create index supplier_document_tenant_idx on public.supplier_document (tenant_id);
create index supplier_document_attachment_idx on public.supplier_document (attachment_id);

select app.setup_tenant_table('public.supplier_document');

create trigger bump_version before update on public.supplier_document
  for each row execute function app.bump_version();

-- Insert-only: a vetting is evidence of a check made on a date (FR-010).
create table public.supplier_vetting (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  checked_on date not null,
  checked_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  lists_checked text[] not null default '{}',
  result text not null check (result in ('clear', 'match', 'inconclusive')),
  notes text,
  evidence_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index supplier_vetting_supplier_idx on public.supplier_vetting (supplier_id, checked_on desc);
create index supplier_vetting_tenant_idx on public.supplier_vetting (tenant_id);
create index supplier_vetting_checked_by_idx on public.supplier_vetting (checked_by);
create index supplier_vetting_evidence_idx on public.supplier_vetting (evidence_attachment_id);

select app.setup_tenant_table('public.supplier_vetting');

create trigger supplier_vetting_append_only
  before update or delete on public.supplier_vetting
  for each row execute function app.block_modification();

revoke update, delete on public.supplier_vetting from anon, authenticated;

-- The latest clear vetting date is the supplier's last_vetted_at.
create or replace function app.supplier_vetting_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result = 'clear' then
    update public.supplier s
    set last_vetted_at = greatest(coalesce(s.last_vetted_at, new.checked_on), new.checked_on)
    where s.id = new.supplier_id and s.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

create trigger supplier_vetting_stamp
  after insert on public.supplier_vetting
  for each row execute function app.supplier_vetting_stamp();

-- One rating per PO; the FK to purchase_order is added by 0017.
create table public.supplier_rating (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  supplier_id uuid not null references public.supplier (id) on delete restrict,
  po_id uuid not null unique,
  on_time smallint not null check (on_time between 1 and 5),
  quality smallint not null check (quality between 1 and 5),
  documentation smallint not null check (documentation between 1 and 5),
  rated_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index supplier_rating_supplier_idx on public.supplier_rating (supplier_id);
create index supplier_rating_tenant_idx on public.supplier_rating (tenant_id);
create index supplier_rating_rated_by_idx on public.supplier_rating (rated_by);

select app.setup_tenant_table('public.supplier_rating');

create or replace function app.supplier_rating_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid := coalesce(new.supplier_id, old.supplier_id);
begin
  update public.supplier s
  set rating_avg_on_time = r.on_time,
      rating_avg_quality = r.quality,
      rating_avg_docs = r.docs,
      rating_count = r.n
  from (
    select round(avg(on_time), 2) as on_time, round(avg(quality), 2) as quality,
           round(avg(documentation), 2) as docs, count(*)::smallint as n
    from public.supplier_rating where supplier_id = v_supplier
  ) r
  where s.id = v_supplier;
  return null;
end;
$$;

create trigger supplier_rating_refresh
  after insert or update or delete on public.supplier_rating
  for each row execute function app.supplier_rating_refresh();

-- =============================================================================================
-- staff_payee (direct payments and advances, FR-012)
-- =============================================================================================

create table public.staff_payee (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  membership_id uuid references public.membership (id) on delete restrict,
  full_name_ar text not null check (btrim(full_name_ar) <> ''),
  full_name_en text not null check (btrim(full_name_en) <> ''),
  phone text,
  bank_name text,
  bank_branch text,
  bank_account_name text,
  bank_account_no text,
  phone_norm text generated always as (nullif(regexp_replace(phone, '\D', '', 'g'), '')) stored,
  bank_account_no_norm text
    generated always as (nullif(regexp_replace(upper(bank_account_no), '[^0-9A-Z]', '', 'g'), ''))
    stored,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index staff_payee_tenant_idx on public.staff_payee (tenant_id);
create index staff_payee_membership_idx on public.staff_payee (membership_id);
create index staff_payee_phone_norm_idx on public.staff_payee (tenant_id, phone_norm)
  where phone_norm is not null;
create index staff_payee_bank_norm_idx on public.staff_payee (tenant_id, bank_account_no_norm)
  where bank_account_no_norm is not null;

select app.setup_tenant_table('public.staff_payee');

create trigger bump_version before update on public.staff_payee
  for each row execute function app.bump_version();

-- Master data: deactivated, never deleted.
revoke delete on public.supplier, public.supplier_category, public.supplier_document,
  public.staff_payee from anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'procurement_setting', 'procurement_method_band', 'grant_procurement_rule', 'deduction_type',
    'payment_category', 'supplier', 'supplier_category', 'supplier_category_link',
    'supplier_document', 'supplier_vetting', 'supplier_rating', 'staff_payee'
  ] loop
    execute format(
      'create trigger audit_log_change after insert or update or delete on public.%I '
      'for each row execute function audit.log_change()', v_table);
  end loop;
end;
$$;

-- =============================================================================================
-- supplier_compliance (derived; security_invoker so the caller's RLS applies)
-- =============================================================================================

create view public.supplier_compliance
with (security_invoker = true)
as
select
  s.id as supplier_id,
  s.tenant_id,
  s.status,
  v.vetting_overdue,
  d.has_expired_required_doc,
  s.status = 'approved' as can_invite,
  s.status = 'approved' and not v.vetting_overdue and not d.has_expired_required_doc
    as can_award_or_pay
from public.supplier s
left join public.procurement_setting ps on ps.tenant_id = s.tenant_id
cross join lateral (
  select s.last_vetted_at is null
      or s.last_vetted_at + make_interval(months => coalesce(ps.revetting_months, 12))
         < current_date as vetting_overdue
) v
cross join lateral (
  select exists (
    select 1 from public.supplier_document sd
    where sd.supplier_id = s.id and sd.is_required
      and sd.expiry_date is not null and sd.expiry_date < current_date
  ) as has_expired_required_doc
) d;

-- =============================================================================================
-- Duplicate lookups: a warning, never a block (US2-3). Matches on normalized registration no,
-- tax no, phone, or bank account across suppliers and staff payees of the caller's tenant.
-- =============================================================================================

create or replace function public.party_duplicates(
  p_registration_no text,
  p_tax_no text,
  p_phone text,
  p_bank_account_no text,
  p_exclude_id uuid
)
returns table (party_kind text, party_id uuid, name_ar text, name_en text, field text)
language sql
stable
security invoker
set search_path = ''
as $$
  with n as (
    select nullif(upper(btrim(p_registration_no)), '') as reg,
           nullif(upper(btrim(p_tax_no)), '') as tax,
           nullif(regexp_replace(p_phone, '\D', '', 'g'), '') as phone,
           nullif(regexp_replace(upper(p_bank_account_no), '[^0-9A-Z]', '', 'g'), '') as bank
  )
  select 'supplier', s.id, s.legal_name_ar, s.legal_name_en, f.field
  from public.supplier s
  cross join n
  cross join lateral (values
    ('registration_no', s.registration_no_norm = n.reg),
    ('tax_no', s.tax_no_norm = n.tax),
    ('phone', s.phone_norm = n.phone),
    ('bank_account_no', s.bank_account_no_norm = n.bank)
  ) as f (field, hit)
  where s.tenant_id = (select app.current_tenant_id())
    and s.id is distinct from p_exclude_id and f.hit
  union all
  select 'staff_payee', p.id, p.full_name_ar, p.full_name_en, f.field
  from public.staff_payee p
  cross join n
  cross join lateral (values
    ('phone', p.phone_norm = n.phone),
    ('bank_account_no', p.bank_account_no_norm = n.bank)
  ) as f (field, hit)
  where p.tenant_id = (select app.current_tenant_id())
    and p.id is distinct from p_exclude_id and f.hit;
$$;

create or replace function public.supplier_duplicates(p_supplier_id uuid)
returns table (party_kind text, party_id uuid, name_ar text, name_en text, field text)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.*
  from public.supplier s
  cross join lateral public.party_duplicates(
    s.registration_no, s.tax_no, s.phone, s.bank_account_no, s.id) d
  where s.id = p_supplier_id;
$$;

revoke execute on function public.party_duplicates(text, text, text, text, uuid),
  public.supplier_duplicates(uuid) from public, anon;
grant execute on function public.party_duplicates(text, text, text, text, uuid),
  public.supplier_duplicates(uuid) to authenticated, service_role;

-- =============================================================================================
-- Defaults (data-model §2): settings, bands, withholding deductions, payment and supplier
-- categories. Idempotent; seed hook 30 (after the chart of accounts, hook 10).
-- =============================================================================================

create or replace function app.seed_procurement_defaults(p_tenant uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.procurement_setting (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;

  if not exists (select 1 from public.procurement_method_band b where b.tenant_id = p_tenant) then
    insert into public.procurement_method_band
      (tenant_id, method, min_amount, max_amount, min_quotations)
    values
      (p_tenant, 'direct', null, 1000, 1),
      (p_tenant, 'rfq', 1000, 25000, 3),
      (p_tenant, 'tender', 25000, null, 3);
  end if;

  insert into public.deduction_type
    (tenant_id, name_ar, name_en, rate_pct, applies_to, payable_account_id)
  select p_tenant, d.name_ar, d.name_en, 0, d.applies_to, g.id
  from (values
    ('ضريبة مستقطعة – سلع', 'Withholding tax – goods', 'goods'),
    ('ضريبة مستقطعة – خدمات', 'Withholding tax – services', 'services')
  ) as d (name_ar, name_en, applies_to)
  join public.gl_account g on g.tenant_id = p_tenant and g.code = '21' and g.is_posting
  on conflict (tenant_id, name_en) do nothing;

  insert into public.payment_category (tenant_id, code, name_ar, name_en, procurement_only)
  select p_tenant, c.code, c.name_ar, c.name_en, c.procurement_only
  from (values
    ('salary', 'رواتب', 'Salary', false),
    ('allowance', 'بدلات', 'Allowance', false),
    ('rent', 'إيجار', 'Rent', false),
    ('utilities', 'خدمات عامة', 'Utilities', false),
    ('per_diem', 'نثريات سفر', 'Per diem', false),
    ('transport_refund', 'استرداد مواصلات', 'Transport refund', false),
    ('tax_remittance', 'توريد ضرائب', 'Tax remittance', false),
    ('goods', 'سلع', 'Goods', true)
  ) as c (code, name_ar, name_en, procurement_only)
  on conflict (tenant_id, code) do nothing;

  insert into public.supplier_category (tenant_id, code, name_ar, name_en)
  select p_tenant, c.code, c.name_ar, c.name_en
  from (values
    ('stationery', 'قرطاسية', 'Stationery'),
    ('food', 'مواد غذائية', 'Food'),
    ('construction', 'إنشاءات', 'Construction'),
    ('transport', 'نقل', 'Transport'),
    ('it', 'تقنية المعلومات', 'IT'),
    ('fuel', 'وقود', 'Fuel'),
    ('other', 'أخرى', 'Other')
  ) as c (code, name_ar, name_en)
  on conflict (tenant_id, code) do nothing;
end;
$$;

revoke execute on function app.seed_procurement_defaults(uuid) from public, anon, authenticated;

insert into app.tenant_seed_hook (seq, fn)
values (30, 'app.seed_procurement_defaults(uuid)'::regprocedure);

select app.run_tenant_seed_hooks(t.id) from public.tenant t;
