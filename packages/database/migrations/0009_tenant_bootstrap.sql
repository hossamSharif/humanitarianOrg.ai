-- 0009 — organization bootstrap and setup helpers (US1).
--
-- POST /tenants creates an organization for a signed-in user who has no membership in it yet.
-- Every tenant policy requires an active membership in app_metadata.tenant_id, and `tenant` has
-- no insert policy, so the first two rows (tenant + the creator's active, org-wide membership)
-- are written here. The API then puts the new tenant id into request.jwt.claims for the rest of
-- the same transaction and seeds units, roles, numbering and the default approval rule through
-- the ordinary RLS policies (apps/api/src/services/tenant-setup.service.ts).

create or replace function app.bootstrap_tenant(
  p_name_ar text,
  p_name_en text,
  p_address text,
  p_phone text,
  p_email text,
  p_website text,
  p_base_currency char(3),
  p_doa_reference_currency char(3),
  p_fiscal_year_start_month smallint,
  p_timezone text,
  p_max_backdate_days smallint,
  p_admin_full_name_ar text,
  p_admin_full_name_en text,
  p_admin_position_title text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_tenant uuid;
  v_membership uuid;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;

  insert into public.tenant (
    name_ar, name_en, address, phone, email, website, base_currency, doa_reference_currency,
    fiscal_year_start_month, timezone, max_backdate_days, created_by
  )
  values (
    p_name_ar, p_name_en, p_address, p_phone, p_email, p_website, p_base_currency,
    p_doa_reference_currency, p_fiscal_year_start_month, p_timezone, p_max_backdate_days, v_user
  )
  returning id into v_tenant;

  insert into public.membership (
    tenant_id, user_id, email, full_name_ar, full_name_en, position_title, org_wide_access,
    status, invited_at, activated_at, created_by
  )
  values (
    v_tenant, v_user, coalesce(v_email, ''),
    coalesce(p_admin_full_name_ar, v_email, ''), coalesce(p_admin_full_name_en, v_email, ''),
    p_admin_position_title, true, 'active', now(), now(), v_user
  )
  returning id into v_membership;

  return jsonb_build_object('tenantId', v_tenant, 'membershipId', v_membership);
end;
$$;

-- Offices of the current tenant referenced by any PR (their code is locked, FR-002). Definer so
-- the answer does not depend on the caller's office scope.
create or replace function app.offices_in_use()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.office o
  where o.tenant_id = app.current_tenant_id()
    and (
      exists (
        select 1 from public.purchase_requisition p
        where p.requesting_office_id = o.id or p.deliver_to_office_id = o.id
      )
      or exists (select 1 from public.pr_line l where l.location_office_id = o.id)
    );
$$;

-- true once any PR of the current tenant was submitted (it has a number): the base currency is
-- then immutable (data-model §1).
create or replace function app.tenant_has_submitted_pr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchase_requisition p
    where p.tenant_id = app.current_tenant_id() and p.number is not null
  );
$$;

revoke execute on function
  app.bootstrap_tenant(
    text, text, text, text, text, text, char, char, smallint, text, smallint, text, text, text
  ),
  app.offices_in_use(),
  app.tenant_has_submitted_pr()
from public, anon;

grant execute on function
  app.bootstrap_tenant(
    text, text, text, text, text, text, char, char, smallint, text, smallint, text, text, text
  ),
  app.offices_in_use(),
  app.tenant_has_submitted_pr()
to authenticated, service_role;
