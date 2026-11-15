-- 0010 — US2 funding helpers.
-- PR rows are office-scoped by RLS, so a Finance or grants user without access to every office
-- would see too few PRs when the API asks "is this rate in use?" or "how many PRs are pending on
-- this grant?" (FR-015, FR-022). These SECURITY DEFINER helpers answer only those questions,
-- only for the caller's tenant, and return no PR data. A guard trigger also keeps a grant's
-- currency fixed once its budget lines carry commitments (data-model §3).

-- Ids among p_ids that a purchase requisition references (pr_line or the PR's locked rates).
create or replace function app.exchange_rates_in_use(p_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select r.id
  from public.exchange_rate r
  where r.id = any (p_ids)
    and r.tenant_id = (select app.current_tenant_id())
    and (
      exists (select 1 from public.pr_line l where l.exchange_rate_id = r.id)
      or exists (
        select 1 from public.purchase_requisition p
        where p.doa_exchange_rate_id = r.id or p.grant_exchange_rate_id = r.id
      )
    );
end;
$$;

-- Pending (submitted, not yet decided) PRs charged to a grant of the caller's tenant.
create or replace function app.grant_pending_pr_count(p_grant_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select count(*)::integer
    from public.purchase_requisition p
    where p.grant_id = p_grant_id
      and p.tenant_id = (select app.current_tenant_id())
      and p.status in ('pending_finance_check', 'pending_approval')
  );
end;
$$;

grant execute on function
  app.exchange_rates_in_use(uuid[]),
  app.grant_pending_pr_count(uuid)
to authenticated, service_role;

-- Commitment amounts are in the grant currency: once any exists, the currency cannot change.
create or replace function app.grant_currency_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency and exists (
    select 1
    from public.budget_commitment c
    join public.budget_line b on b.id = c.budget_line_id
    where b.grant_id = old.id
  ) then
    raise exception 'GRANT_CURRENCY_LOCKED'
      using errcode = 'restrict_violation',
            detail = 'The grant has budget commitments; its currency cannot change.';
  end if;
  return new;
end;
$$;

create trigger grant_currency_locked
  before update of currency on public."grant"
  for each row execute function app.grant_currency_locked();
