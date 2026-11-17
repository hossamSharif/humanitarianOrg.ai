-- 0013 — budget commitments for any source document (research D2).
--
-- budget_commitment keeps its name and its 001 columns, so 001 SQL keeps working: rows without
-- source_doc_type are PR rows ('PR' default, pr_id copied into source_doc_id). Partial
-- consumption never edits an amount: the open row is released and, when something remains, a
-- new row carries the remainder with supersedes_id pointing at the row it continues ("split
-- chain"). The Available guard becomes one function, app.assert_budget_line_available, which
-- 0019 extends with Actual from posted voucher lines.

alter table public.budget_commitment
  add column source_doc_type text not null default 'PR'
    references app.doc_type_registry (code) on delete restrict,
  add column source_doc_id uuid,
  add column source_line_id uuid,
  add column supersedes_id uuid references public.budget_commitment (id) on delete restrict,
  -- rate from the source document's currency to the grant currency, locked when the row was
  -- created (1 / date / 'base' when they are the same currency)
  add column rate_to_grant numeric(18, 6) check (rate_to_grant is null or rate_to_grant > 0),
  add column rate_date date,
  add column rate_source text,
  add column exchange_rate_id uuid references public.exchange_rate (id) on delete restrict;

update public.budget_commitment set source_doc_id = pr_id where source_doc_id is null;

alter table public.budget_commitment alter column pr_id drop not null;

-- PR rows keep pr_id (001 queries read it); every other source leaves it null.
create or replace function app.budget_commitment_source_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_doc_type = 'PR' and new.pr_id is not null then
    new.source_doc_id := new.pr_id;
  end if;
  return new;
end;
$$;

create trigger budget_commitment_source_ref
  before insert or update of pr_id, source_doc_type, source_doc_id on public.budget_commitment
  for each row execute function app.budget_commitment_source_ref();

alter table public.budget_commitment
  alter column source_doc_id set not null,
  add constraint budget_commitment_pr_source
    check ((source_doc_type = 'PR') = (pr_id is not null));

-- one open row per source × budget line × cycle; released rows stay for audit
alter table public.budget_commitment
  drop constraint budget_commitment_pr_id_budget_line_id_cycle_key;
create unique index budget_commitment_open_source_key
  on public.budget_commitment (source_doc_type, source_doc_id, budget_line_id, cycle)
  where status in ('reserved', 'committed');

alter table public.budget_commitment drop constraint budget_commitment_release_reason_check;
alter table public.budget_commitment
  add constraint budget_commitment_release_reason_check check (release_reason in (
    'returned', 'rejected', 'cancelled', 'budget_line_changed',
    'converted_to_po', 'po_closed', 'consumed_by_payment', 'amended', 'settled',
    'reversal_restore'
  ));

create index budget_commitment_source_idx
  on public.budget_commitment (tenant_id, source_doc_type, source_doc_id);
create index budget_commitment_pr_idx on public.budget_commitment (pr_id);
create index budget_commitment_supersedes_idx on public.budget_commitment (supersedes_id);
create index budget_commitment_exchange_rate_idx on public.budget_commitment (exchange_rate_id);

-- ---------------------------------------------------------------------------------------------
-- Available ≥ 0 (FR-037, SC-003/SC-004): one guard function for every caller
-- ---------------------------------------------------------------------------------------------

create or replace function app.assert_budget_line_available(p_budget_line_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget numeric(18, 2);
  v_used numeric(18, 2);
begin
  select b.budget_amount into v_budget
  from public.budget_line b
  where b.id = p_budget_line_id;
  if v_budget is null then
    return;
  end if;

  select coalesce(sum(c.amount), 0) into v_used
  from public.budget_commitment c
  where c.budget_line_id = p_budget_line_id
    and c.status in ('reserved', 'committed');

  if v_used > v_budget then
    raise exception 'BUDGET_EXCEEDED'
      using errcode = 'check_violation',
            detail = format('budget_line_id=%s budget=%s used=%s', p_budget_line_id, v_budget, v_used);
  end if;
end;
$$;

-- The 0005 deferred constraint trigger keeps its name and now calls the shared guard.
create or replace function app.budget_commitment_available_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_budget_line_available(new.budget_line_id);
  return null;
end;
$$;

revoke execute on function app.assert_budget_line_available(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Rates in use: one view over every locked ⟨rate⟩ column; later migrations add their tables
-- ---------------------------------------------------------------------------------------------

create or replace view app.exchange_rate_usage as
select l.exchange_rate_id from public.pr_line l where l.exchange_rate_id is not null
union all
select p.doa_exchange_rate_id from public.purchase_requisition p
where p.doa_exchange_rate_id is not null
union all
select p.grant_exchange_rate_id from public.purchase_requisition p
where p.grant_exchange_rate_id is not null
union all
select c.exchange_rate_id from public.budget_commitment c where c.exchange_rate_id is not null;

revoke all on app.exchange_rate_usage from public, anon, authenticated;

create or replace function app.exchange_rate_locked_when_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.exchange_rate_usage u where u.exchange_rate_id = old.id) then
    raise exception 'EXCHANGE_RATE_IN_USE'
      using errcode = 'restrict_violation',
            detail = 'The rate is used by a document; enter a corrected rate instead.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

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
    and exists (select 1 from app.exchange_rate_usage u where u.exchange_rate_id = r.id);
end;
$$;
