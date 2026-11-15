-- 0002 — organization and access (data-model §1).
-- FKs to `currency` are added in 0003, once that table exists.

-- ---------------------------------------------------------------------------------------------
-- tenant (it is the tenant: no tenant_id column; RLS on id)
-- ---------------------------------------------------------------------------------------------

create table public.tenant (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  logo_path text,
  address text,
  phone text,
  email text,
  website text,
  base_currency char(3) not null default 'SDG',
  doa_reference_currency char(3) not null default 'USD',
  fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  timezone text not null default 'Africa/Khartoum',
  max_backdate_days smallint not null default 30 check (max_backdate_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

alter table public.tenant enable row level security;

create policy tenant_select on public.tenant for select to authenticated
  using (id = (select app.current_tenant_id()));
create policy tenant_update on public.tenant for update to authenticated
  using (id = (select app.current_tenant_id()) and (select app.has_permission('settings:manage')))
  with check (id = (select app.current_tenant_id()));
-- Tenants are created by the bootstrap endpoint (POST /tenants, US1), never deleted.

create trigger touch_updated_at before update on public.tenant
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- membership
-- ---------------------------------------------------------------------------------------------

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  email extensions.citext not null,
  full_name_ar text not null,
  full_name_en text not null,
  position_title text,
  org_wide_access boolean not null default false,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, user_id)
);

create index membership_user_id_idx on public.membership (user_id);

select app.setup_tenant_table('public.membership');

-- ---------------------------------------------------------------------------------------------
-- office
-- ---------------------------------------------------------------------------------------------

create table public.office (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9]{2,10}$'),
  name_ar text not null,
  name_en text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, code)
);

select app.setup_tenant_table('public.office');

-- ---------------------------------------------------------------------------------------------
-- user_office
-- ---------------------------------------------------------------------------------------------

create table public.user_office (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  membership_id uuid not null references public.membership (id) on delete cascade,
  office_id uuid not null references public.office (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, membership_id, office_id)
);

create index user_office_membership_id_idx on public.user_office (membership_id);
create index user_office_office_id_idx on public.user_office (office_id);

select app.setup_tenant_table('public.user_office');

-- ---------------------------------------------------------------------------------------------
-- permission (global reference; seeded in 0008, read-only to API users)
-- ---------------------------------------------------------------------------------------------

create table public.permission (
  code text primary key check (code ~ '^[a-z_]+:[a-z_]+$'),
  description_ar text not null,
  description_en text not null
);

alter table public.permission enable row level security;
create policy permission_read on public.permission for select to authenticated using (true);
revoke insert, update, delete, truncate on public.permission from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- role, role_permission, user_role
-- ---------------------------------------------------------------------------------------------

create table public.role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  key text,
  name_ar text not null,
  name_en text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, key),
  unique (tenant_id, name_ar),
  unique (tenant_id, name_en)
);

select app.setup_tenant_table('public.role');

create table public.role_permission (
  role_id uuid not null references public.role (id) on delete cascade,
  permission_code text not null references public.permission (code) on delete restrict,
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  primary key (role_id, permission_code)
);

create index role_permission_tenant_id_idx on public.role_permission (tenant_id);
create index role_permission_permission_code_idx on public.role_permission (permission_code);

select app.setup_tenant_table('public.role_permission');

create table public.user_role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  membership_id uuid not null references public.membership (id) on delete cascade,
  role_id uuid not null references public.role (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, membership_id, role_id)
);

create index user_role_membership_id_idx on public.user_role (membership_id);
create index user_role_role_id_idx on public.user_role (role_id);

select app.setup_tenant_table('public.user_role');

-- ---------------------------------------------------------------------------------------------
-- Session functions used by GET /me and the tenant middleware. They read the caller's own rows
-- across tenants (before a tenant is selected), so they are SECURITY DEFINER and always filter
-- on auth.uid().
-- ---------------------------------------------------------------------------------------------

-- The caller's invited/active memberships in every organization.
create or replace function app.my_memberships()
returns table (
  membership_id uuid,
  tenant_id uuid,
  tenant_name_ar text,
  tenant_name_en text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.tenant_id, t.name_ar, t.name_en, m.status
  from public.membership m
  join public.tenant t on t.id = m.tenant_id
  where m.user_id = auth.uid()
    and m.status in ('invited', 'active')
  order by t.name_en;
$$;

-- First sign-in after an invitation: invited → active for the caller's own memberships.
create or replace function app.accept_invitations()
returns setof uuid
language sql
volatile
security definer
set search_path = ''
as $$
  update public.membership
  set status = 'active', activated_at = now()
  where user_id = auth.uid()
    and status = 'invited'
  returning tenant_id;
$$;

-- Everything the API needs about the caller in the current tenant, in one round trip:
-- { membershipId, tenantId, orgWideAccess, permissions[], officeIds[] } or null.
create or replace function app.session_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.membership;
begin
  select * into v_membership
  from public.membership
  where id = app.current_membership_id();

  if v_membership.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'membershipId', v_membership.id,
    'tenantId', v_membership.tenant_id,
    'orgWideAccess', v_membership.org_wide_access,
    'permissions', coalesce((
      select jsonb_agg(distinct rp.permission_code order by rp.permission_code)
      from public.user_role ur
      join public.role_permission rp on rp.role_id = ur.role_id
      where ur.membership_id = v_membership.id
    ), '[]'::jsonb),
    'officeIds', coalesce((
      select jsonb_agg(o.id order by o.code)
      from public.office o
      where o.tenant_id = v_membership.tenant_id
        and (
          v_membership.org_wide_access
          or exists (
            select 1 from public.user_office uo
            where uo.membership_id = v_membership.id and uo.office_id = o.id
          )
        )
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function
  app.my_memberships(),
  app.accept_invitations(),
  app.session_context()
to authenticated, service_role;
