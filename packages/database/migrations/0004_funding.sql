-- 0004 — funding (data-model §3): donors, grants, activities, budget lines, exchange rates.
-- Master data is never hard-deleted once referenced: every FK is `on delete restrict`.

-- ---------------------------------------------------------------------------------------------
-- donor
-- ---------------------------------------------------------------------------------------------

create table public.donor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  short_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create unique index donor_tenant_name_key on public.donor (tenant_id, lower(name));

select app.setup_tenant_table('public.donor');

-- ---------------------------------------------------------------------------------------------
-- grant
-- ---------------------------------------------------------------------------------------------

create table public."grant" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  donor_id uuid not null references public.donor (id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  name text not null,
  currency char(3) not null references public.currency (code) on delete restrict,
  total_amount numeric(18, 2) not null check (total_amount > 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  -- donor codes are stored exactly as entered
  unique (tenant_id, code),
  constraint grant_period check (end_date >= start_date)
);

create index grant_donor_id_idx on public."grant" (donor_id);
create index grant_currency_idx on public."grant" (currency);

select app.setup_tenant_table('public."grant"');
create trigger bump_version before update on public."grant"
  for each row execute function app.bump_version();

-- ---------------------------------------------------------------------------------------------
-- grant_office: offices where a grant operates
-- ---------------------------------------------------------------------------------------------

create table public.grant_office (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  office_id uuid not null references public.office (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, grant_id, office_id)
);

create index grant_office_grant_id_idx on public.grant_office (grant_id);
create index grant_office_office_id_idx on public.grant_office (office_id);

select app.setup_tenant_table('public.grant_office');

-- ---------------------------------------------------------------------------------------------
-- activity
-- ---------------------------------------------------------------------------------------------

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (grant_id, code)
);

create index activity_tenant_id_idx on public.activity (tenant_id);

select app.setup_tenant_table('public.activity');

-- ---------------------------------------------------------------------------------------------
-- budget_line
-- ---------------------------------------------------------------------------------------------

create table public.budget_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  -- donor's code exactly as entered ('10202', '2.2.31')
  code text not null check (btrim(code) <> ''),
  description text not null,
  category text not null
    check (category in ('supplies', 'services', 'staff', 'equipment', 'running_costs')),
  budget_amount numeric(18, 2) not null check (budget_amount >= 0),
  office_id uuid references public.office (id) on delete restrict,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (grant_id, code)
);

create index budget_line_tenant_id_idx on public.budget_line (tenant_id);
create index budget_line_office_id_idx on public.budget_line (office_id);

select app.setup_tenant_table('public.budget_line');
create trigger bump_version before update on public.budget_line
  for each row execute function app.bump_version();

-- ---------------------------------------------------------------------------------------------
-- exchange_rate: 1 unit of `currency` = rate_to_base × tenant base currency.
-- Several rows per date are allowed (corrections are new rows); lookup takes the latest
-- rate_date <= document date, then the latest created_at.
-- ---------------------------------------------------------------------------------------------

create table public.exchange_rate (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  currency char(3) not null references public.currency (code) on delete restrict,
  rate_to_base numeric(18, 6) not null check (rate_to_base > 0),
  rate_date date not null,
  source text not null check (btrim(source) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index exchange_rate_lookup_idx
  on public.exchange_rate (tenant_id, currency, rate_date desc, created_at desc);
create index exchange_rate_currency_idx on public.exchange_rate (currency);

select app.setup_tenant_table('public.exchange_rate');

create or replace function app.exchange_rate_not_base_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tenant t
    where t.id = new.tenant_id and t.base_currency = new.currency
  ) then
    raise exception 'EXCHANGE_RATE_BASE_CURRENCY'
      using errcode = 'check_violation',
            detail = 'The base currency has an implied rate of 1 and takes no exchange rate.';
  end if;
  return new;
end;
$$;

create trigger exchange_rate_not_base_currency
  before insert or update of currency, tenant_id on public.exchange_rate
  for each row execute function app.exchange_rate_not_base_currency();
