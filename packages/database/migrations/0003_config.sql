-- 0003 — configuration (data-model §2): currencies, units, numbering, approval rules.

-- ---------------------------------------------------------------------------------------------
-- currency (global reference; seeded in 0008)
-- ---------------------------------------------------------------------------------------------

create table public.currency (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  minor_units smallint not null default 2 check (minor_units between 0 and 3),
  name_ar_singular text not null,
  name_ar_dual text not null,
  name_ar_plural text not null,
  name_en_singular text not null,
  name_en_plural text not null,
  minor_name_ar_singular text not null,
  minor_name_ar_dual text not null,
  minor_name_ar_plural text not null,
  minor_name_en_singular text not null,
  minor_name_en_plural text not null
);

alter table public.currency enable row level security;
create policy currency_read on public.currency for select to authenticated using (true);
revoke insert, update, delete, truncate on public.currency from anon, authenticated;

alter table public.tenant
  add constraint tenant_base_currency_fkey
    foreign key (base_currency) references public.currency (code) on delete restrict,
  add constraint tenant_doa_reference_currency_fkey
    foreign key (doa_reference_currency) references public.currency (code) on delete restrict;

-- ---------------------------------------------------------------------------------------------
-- unit_of_measure
-- ---------------------------------------------------------------------------------------------

create table public.unit_of_measure (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  code text not null,
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, code)
);

select app.setup_tenant_table('public.unit_of_measure');

-- ---------------------------------------------------------------------------------------------
-- numbering_config, document_sequence (research R6)
-- ---------------------------------------------------------------------------------------------

create table public.numbering_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null check (doc_type = 'PR'),
  prefix text not null default 'PR',
  include_office boolean not null default true,
  include_year boolean not null default true,
  padding smallint not null default 4 check (padding between 1 and 10),
  separator text not null default '-',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, doc_type)
);

select app.setup_tenant_table('public.numbering_config');

-- Incremented only by `insert … on conflict … do update … returning` inside the submit
-- transaction; never deleted.
create table public.document_sequence (
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null check (doc_type = 'PR'),
  office_id uuid not null references public.office (id) on delete restrict,
  year smallint not null check (year between 2000 and 2999),
  last_value integer not null default 0 check (last_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, doc_type, office_id, year)
);

create index document_sequence_office_id_idx on public.document_sequence (office_id);

alter table public.document_sequence enable row level security;
create policy tenant_select on public.document_sequence for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy tenant_insert on public.document_sequence for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy tenant_update on public.document_sequence for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
revoke delete, truncate on public.document_sequence from anon, authenticated;

create trigger touch_updated_at before update on public.document_sequence
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- approval_rule, approval_rule_step (research R8)
-- ---------------------------------------------------------------------------------------------

create table public.approval_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  doc_type text not null default 'PR' check (doc_type = 'PR'),
  office_id uuid references public.office (id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  -- one org-wide rule (office_id null) and at most one rule per office
  constraint approval_rule_scope_key unique nulls not distinct (tenant_id, doc_type, office_id)
);

create index approval_rule_office_id_idx on public.approval_rule (office_id);

select app.setup_tenant_table('public.approval_rule');

create table public.approval_rule_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  rule_id uuid not null references public.approval_rule (id) on delete cascade,
  step_order smallint not null check (step_order >= 1),
  kind text not null check (kind in ('finance_check', 'approval', 'final_approval')),
  role_id uuid not null references public.role (id) on delete restrict,
  -- band: (min_amount, max_amount], in the DoA reference currency; null min = 0, null max = ∞
  min_amount numeric(18, 2) check (min_amount is null or min_amount >= 0),
  max_amount numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint approval_rule_step_band_order
    check (max_amount is null or min_amount is null or max_amount > min_amount),
  constraint approval_rule_step_finance_check_unbanded
    check (kind <> 'finance_check' or (min_amount is null and max_amount is null))
);

create index approval_rule_step_rule_id_idx on public.approval_rule_step (rule_id, step_order);
create index approval_rule_step_role_id_idx on public.approval_rule_step (role_id);
create index approval_rule_step_tenant_id_idx on public.approval_rule_step (tenant_id);

select app.setup_tenant_table('public.approval_rule_step');
