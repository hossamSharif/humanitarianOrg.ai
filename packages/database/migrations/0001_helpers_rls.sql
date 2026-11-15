-- 0001 — extensions, schemas, shared trigger functions and the RLS helpers
-- (contracts/rls-and-permissions.md §1, research R2–R3).
--
-- Helper bodies are plpgsql so they may reference tables created in 0002 (plpgsql is resolved at
-- call time). They are SECURITY DEFINER with an empty search_path: every name is schema-qualified.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
create schema if not exists audit;

revoke all on schema app from public;
revoke all on schema audit from public;
grant usage on schema app to authenticated, service_role;

-- Functions in app/audit are not executable by default; each one is granted explicitly below.
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema audit revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Optimistic concurrency: every update of a versioned row increments `version`. Services compare
-- `expectedVersion` in the WHERE clause; the trigger guarantees the counter always moves.
create or replace function app.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------------------------

-- Tenant of the caller: app_metadata.tenant_id (server-controlled) and only while the caller has
-- an active membership there. Never reads user_metadata.
create or replace function app.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  begin
    v_tenant := nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid;
  exception when invalid_text_representation then
    return null;
  end;

  if v_tenant is null or auth.uid() is null then
    return null;
  end if;

  if exists (
    select 1
    from public.membership m
    where m.tenant_id = v_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
  ) then
    return v_tenant;
  end if;

  return null;
end;
$$;

create or replace function app.current_membership_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select m.id into v_id
  from public.membership m
  where m.tenant_id = app.current_tenant_id()
    and m.user_id = auth.uid()
    and m.status = 'active';
  return v_id;
end;
$$;

create or replace function app.has_office_access(p_office_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_office_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.membership m
    where m.id = app.current_membership_id()
      and (
        m.org_wide_access
        or exists (
          select 1
          from public.user_office uo
          where uo.membership_id = m.id
            and uo.office_id = p_office_id
        )
      )
  );
end;
$$;

create or replace function app.has_permission(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    where ur.membership_id = app.current_membership_id()
      and rp.permission_code = p_code
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Migration-only helper: the standard tenant policies (the only allowed shapes) and the
-- updated_at trigger. One policy per command so no table has two permissive policies for the
-- same action. Not executable by API roles.
-- ---------------------------------------------------------------------------------------------

create or replace function app.setup_tenant_table(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_expr constant text := 'tenant_id = (select app.current_tenant_id())';
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

grant execute on function
  app.current_tenant_id(),
  app.current_membership_id(),
  app.has_office_access(uuid),
  app.has_permission(text)
to authenticated, service_role;
