-- 0014 — accounting setup (002 data-model §6, US12): chart of accounts, budget-category and
-- budget-line expense mappings, bank and cash accounts, control accounts and periods, with the
-- default chart seeded for every tenant (data-model §11 items 5–6).

-- ---------------------------------------------------------------------------------------------
-- gl_account
-- ---------------------------------------------------------------------------------------------

create table public.gl_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  parent_id uuid references public.gl_account (id) on delete restrict,
  code text not null check (code ~ '^[0-9A-Za-z.\-]{1,20}$'),
  name_ar text not null check (btrim(name_ar) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  type text not null check (type in ('asset', 'liability', 'fund_balance', 'income', 'expense')),
  is_posting boolean not null default true,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, code),
  constraint gl_account_not_own_parent check (parent_id is distinct from id)
);

create index gl_account_parent_idx on public.gl_account (parent_id);
create index gl_account_tenant_type_idx on public.gl_account (tenant_id, type);

select app.setup_tenant_table('public.gl_account');

create trigger bump_version before update on public.gl_account
  for each row execute function app.bump_version();

-- A parent is a group of the same tenant; children inherit its type; a group with children
-- cannot become a posting account, and a type change cannot leave children behind.
create or replace function app.gl_account_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
begin
  if new.parent_id is not null then
    select g.tenant_id, g.type, g.is_posting into v_parent
    from public.gl_account g
    where g.id = new.parent_id;

    if not found or v_parent.tenant_id <> new.tenant_id then
      raise exception 'VALIDATION_ERROR'
        using errcode = 'foreign_key_violation', detail = 'The parent account does not exist.';
    end if;
    if v_parent.is_posting then
      raise exception 'VALIDATION_ERROR'
        using errcode = 'check_violation', detail = 'The parent account must be a group account.';
    end if;
    new.type := v_parent.type;
  end if;

  if tg_op = 'UPDATE' and exists (select 1 from public.gl_account c where c.parent_id = new.id) then
    if new.is_posting then
      raise exception 'VALIDATION_ERROR'
        using errcode = 'check_violation', detail = 'An account with children is a group account.';
    end if;
    if new.type is distinct from old.type then
      raise exception 'VALIDATION_ERROR'
        using errcode = 'check_violation',
              detail = 'The type of an account with children cannot change.';
    end if;
  end if;
  return new;
end;
$$;

create trigger gl_account_hierarchy
  before insert or update of parent_id, type, is_posting on public.gl_account
  for each row execute function app.gl_account_hierarchy();

-- A posting account of the given type in the row's tenant (mapping tables below).
create or replace function app.gl_account_is(p_account_id uuid, p_tenant uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gl_account g
    where g.id = p_account_id and g.tenant_id = p_tenant and g.is_posting
      and (p_type is null or g.type = p_type)
  );
$$;

revoke execute on function app.gl_account_is(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Expense account per budget category, and per budget line (overrides the category)
-- ---------------------------------------------------------------------------------------------

create table public.budget_category_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  category text not null
    check (category in ('supplies', 'services', 'staff', 'equipment', 'running_costs')),
  expense_account_id uuid not null references public.gl_account (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, category)
);

create index budget_category_account_account_idx
  on public.budget_category_account (expense_account_id);

select app.setup_tenant_table('public.budget_category_account');

alter table public.budget_line
  add column expense_account_id uuid references public.gl_account (id) on delete restrict;

create index budget_line_expense_account_idx on public.budget_line (expense_account_id);

create or replace function app.expense_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expense_account_id is not null
    and not app.gl_account_is(new.expense_account_id, new.tenant_id, 'expense') then
    raise exception 'VALIDATION_ERROR'
      using errcode = 'check_violation',
            detail = 'The expense account must be a posting account of type expense.';
  end if;
  return new;
end;
$$;

create trigger expense_account_check
  before insert or update of expense_account_id on public.budget_category_account
  for each row execute function app.expense_account_check();
create trigger expense_account_check
  before insert or update of expense_account_id on public.budget_line
  for each row execute function app.expense_account_check();

-- ---------------------------------------------------------------------------------------------
-- money_account: bank accounts and cash boxes
-- ---------------------------------------------------------------------------------------------

create table public.money_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  kind text not null check (kind in ('bank', 'cash')),
  name text not null check (btrim(name) <> ''),
  bank_name text,
  branch text,
  account_no text,
  currency char(3) not null references public.currency (code) on delete restrict,
  office_id uuid not null references public.office (id) on delete restrict,
  gl_account_id uuid not null unique references public.gl_account (id) on delete restrict,
  custodian_user_id uuid references auth.users (id) on delete restrict,
  opening_balance numeric(18, 2) not null default 0,
  opening_date date,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, name)
);

create index money_account_office_idx on public.money_account (office_id);
create index money_account_currency_idx on public.money_account (currency);
create index money_account_custodian_idx on public.money_account (custodian_user_id);

select app.setup_tenant_table('public.money_account');

create trigger bump_version before update on public.money_account
  for each row execute function app.bump_version();

create or replace function app.money_account_gl_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.gl_account_is(new.gl_account_id, new.tenant_id, 'asset') then
    raise exception 'VALIDATION_ERROR'
      using errcode = 'check_violation',
            detail = 'A bank or cash account needs its own posting asset account.';
  end if;
  return new;
end;
$$;

create trigger money_account_gl_check
  before insert or update of gl_account_id on public.money_account
  for each row execute function app.money_account_gl_check();

-- ---------------------------------------------------------------------------------------------
-- control_account_setting
-- ---------------------------------------------------------------------------------------------

create table public.control_account_setting (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  key text not null check (key in (
    'staff_advances', 'supplier_advances', 'retention_payable', 'grant_funds_received',
    'exchange_gain_loss', 'opening_balance_equity', 'suspense'
  )),
  grant_id uuid references public."grant" (id) on delete restrict,
  account_id uuid not null references public.gl_account (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  constraint control_account_setting_scope_key unique nulls not distinct (tenant_id, key, grant_id),
  constraint control_account_setting_grant_only_funds
    check (grant_id is null or key = 'grant_funds_received')
);

create index control_account_setting_grant_idx on public.control_account_setting (grant_id);
create index control_account_setting_account_idx on public.control_account_setting (account_id);

select app.setup_tenant_table('public.control_account_setting');

create or replace function app.control_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.gl_account_is(new.account_id, new.tenant_id, null) then
    raise exception 'VALIDATION_ERROR'
      using errcode = 'check_violation', detail = 'A control account must be a posting account.';
  end if;
  return new;
end;
$$;

create trigger control_account_check
  before insert or update of account_id on public.control_account_setting
  for each row execute function app.control_account_check();

-- ---------------------------------------------------------------------------------------------
-- accounting_period
-- ---------------------------------------------------------------------------------------------

create table public.accounting_period (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  year smallint not null check (year between 2000 and 2999),
  month smallint not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete restrict,
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id) on delete restrict,
  reopen_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, year, month),
  constraint accounting_period_closed_stamp
    check ((status = 'closed') = (closed_at is not null)),
  constraint accounting_period_reopen_reason
    check (reopened_at is null or (reopen_reason is not null and btrim(reopen_reason) <> ''))
);

select app.setup_tenant_table('public.accounting_period');

create trigger bump_version before update on public.accounting_period
  for each row execute function app.bump_version();

-- Accounting records are master data: deactivated, never deleted once used. Periods are never
-- deleted at all.
revoke delete on public.accounting_period from anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'gl_account', 'budget_category_account', 'money_account', 'control_account_setting',
    'accounting_period'
  ] loop
    execute format(
      'create trigger audit_log_change after insert or update or delete on public.%I '
      'for each row execute function audit.log_change()', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Defaults (data-model §11 items 5–6): chart, control accounts, category mappings, and the
-- current and next month open. Idempotent; registered as a tenant seed hook.
-- ---------------------------------------------------------------------------------------------

create or replace function app.seed_accounting_defaults(p_tenant uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  -- groups first, then their posting children (type comes from the parent)
  insert into public.gl_account (tenant_id, parent_id, code, name_ar, name_en, type, is_posting)
  values
    (p_tenant, null, '1', 'الأصول', 'Assets', 'asset', false),
    (p_tenant, null, '2', 'الالتزامات', 'Liabilities', 'liability', false),
    (p_tenant, null, '3', 'أرصدة الأموال', 'Fund balances', 'fund_balance', false),
    (p_tenant, null, '4', 'الإيرادات', 'Income', 'income', false),
    (p_tenant, null, '5', 'المصروفات', 'Expenses', 'expense', false)
  on conflict (tenant_id, code) do nothing;

  insert into public.gl_account (tenant_id, parent_id, code, name_ar, name_en, type, is_posting)
  select p_tenant, parent.id, child.code, child.name_ar, child.name_en, parent.type, child.is_posting
  from (values
    ('1', '11', 'النقدية والبنوك', 'Cash & bank', false),
    ('1', '12', 'سلف الموظفين', 'Staff advances', true),
    ('1', '13', 'دفعات مقدمة للموردين', 'Supplier advances', true),
    ('1', '14', 'حساب معلق', 'Suspense', true),
    ('2', '21', 'ضريبة مستقطعة مستحقة', 'WHT payable', true),
    ('2', '22', 'محتجزات مستحقة', 'Retention payable', true),
    ('3', '31', 'أموال المنح المستلمة', 'Grant funds received', true),
    ('3', '32', 'حقوق الأرصدة الافتتاحية', 'Opening balance equity', true),
    ('4', '41', 'إيرادات أخرى', 'Other income', true),
    ('4', '42', 'أرباح وخسائر فروق العملة', 'Exchange gain/loss', true),
    ('5', '51', 'مستلزمات', 'Supplies', true),
    ('5', '52', 'خدمات', 'Services', true),
    ('5', '53', 'تكاليف الموظفين', 'Staff', true),
    ('5', '54', 'معدات', 'Equipment', true),
    ('5', '55', 'تكاليف تشغيلية', 'Running costs', true)
  ) as child (parent_code, code, name_ar, name_en, is_posting)
  join public.gl_account parent on parent.tenant_id = p_tenant and parent.code = child.parent_code
  on conflict (tenant_id, code) do nothing;

  insert into public.control_account_setting (tenant_id, key, grant_id, account_id)
  select p_tenant, s.key, null, g.id
  from (values
    ('staff_advances', '12'),
    ('supplier_advances', '13'),
    ('suspense', '14'),
    ('retention_payable', '22'),
    ('grant_funds_received', '31'),
    ('opening_balance_equity', '32'),
    ('exchange_gain_loss', '42')
  ) as s (key, code)
  join public.gl_account g on g.tenant_id = p_tenant and g.code = s.code and g.is_posting
  on conflict do nothing;

  insert into public.budget_category_account (tenant_id, category, expense_account_id)
  select p_tenant, m.category, g.id
  from (values
    ('supplies', '51'),
    ('services', '52'),
    ('staff', '53'),
    ('equipment', '54'),
    ('running_costs', '55')
  ) as m (category, code)
  join public.gl_account g on g.tenant_id = p_tenant and g.code = m.code and g.is_posting
  on conflict (tenant_id, category) do nothing;

  select (now() at time zone t.timezone)::date into v_today
  from public.tenant t where t.id = p_tenant;

  insert into public.accounting_period (tenant_id, year, month)
  select p_tenant, extract(year from d)::smallint, extract(month from d)::smallint
  from (values (date_trunc('month', v_today)), (date_trunc('month', v_today) + interval '1 month'))
    as months (d)
  on conflict (tenant_id, year, month) do nothing;
end;
$$;

revoke execute on function app.seed_accounting_defaults(uuid) from public, anon, authenticated;

insert into app.tenant_seed_hook (seq, fn)
values (10, 'app.seed_accounting_defaults(uuid)'::regprocedure);

select app.run_tenant_seed_hooks(t.id) from public.tenant t;
