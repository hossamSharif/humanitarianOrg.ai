-- 0019 — vouchers, reconciliation, allocation and import (002 data-model §8, research D5, R27,
-- R28, R32; US13, US14, US17, US18, US12). The voucher is the only source of Actual
-- (Principle XI); the database keeps it honest on its own:
--
-- * voucher (⟨doc⟩ ⟨doa⟩; numbered by type BPV / CPV / BRV / CRV / JV / TRF; DoA PV / RV / JV)
--   with the money-account kind per type, the JV reason, the cheque number of a cheque BPV and
--   the received-by fields required before posting cash and cheques (FR-074);
-- * voucher_line with debit xor credit, base amounts = round(amount × rate, 2), the currency /
--   rate consistency (a base-currency line has rate 1 and no rate row, a foreign line has its
--   own rate row and that row's rate — RATE_CURRENCY_CONTRADICTION, US13-4), posting active
--   accounts, dimensions equal to the payment request line's (INHERITED_FIELD_MISMATCH, SC-002)
--   and Actual only on expense accounts with a budget line;
-- * triggers: voucher_balanced (deferred, from `checked` on), voucher_immutable_when_posted
--   (voucher and lines, except stamping the reversal once), voucher_period_open (posting into a
--   closed or missing month is PERIOD_CLOSED) and voucher_three_signers (entered, checked and
--   approved by three people, the DB backstop of BR-8);
-- * budget_line_balance and app.assert_budget_line_available with Actual = Σ posted
--   actual_grant_amount, checked again when lines are posted;
-- * bank_statement / bank_statement_line / reconciliation_match, allocation_template /
--   allocation_line (Σ pct = 100.00), import_batch, and the FKs that waited for them.

-- =============================================================================================
-- import_batch (R32): created first, vouchers and POs point at it
-- =============================================================================================

create table public.import_batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  kind text not null check (kind in (
    'opening_balances', 'budget_line_opening', 'open_pos', 'prior_transactions', 'bank_statement'
  )),
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed')),
  file_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  summary jsonb not null default '{}'::jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  constraint import_batch_committed check ((status = 'committed') = (committed_at is not null))
);

create index import_batch_tenant_kind_idx on public.import_batch (tenant_id, kind);
create index import_batch_attachment_idx on public.import_batch (file_attachment_id);
create index import_batch_created_by_idx on public.import_batch (created_by);

select app.setup_tenant_table('public.import_batch');

alter table public.purchase_order
  add constraint purchase_order_import_batch_fk
  foreign key (import_batch_id) references public.import_batch (id) on delete restrict;
create index purchase_order_import_batch_idx on public.purchase_order (import_batch_id);

-- =============================================================================================
-- voucher (⟨doc⟩ ⟨doa⟩)
-- =============================================================================================

create table public.voucher (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  type text not null check (type in ('BPV', 'CPV', 'BRV', 'CRV', 'JV', 'TRF')),
  number text,
  status text not null default 'draft' check (status in (
    'draft', 'pending_check', 'checked', 'approved', 'posted', 'returned', 'cancelled'
  )),
  office_id uuid not null references public.office (id) on delete restrict,
  voucher_date date not null,
  money_account_id uuid references public.money_account (id) on delete restrict,
  to_money_account_id uuid references public.money_account (id) on delete restrict,
  payment_method text
    check (payment_method in ('bank_transfer', 'cheque', 'bank_draft', 'cash')),
  cheque_no text,
  payee_name text,
  -- header amount (the money-account side) and its words
  currency char(3) not null references public.currency (code) on delete restrict,
  amount numeric(18, 2) not null default 0 check (amount >= 0),
  amount_in_words_ar text,
  amount_in_words_en text,
  reason text,
  -- sources
  payment_request_id uuid references public.payment_request (id) on delete restrict,
  cash_advance_id uuid references public.cash_advance (id) on delete restrict,
  advance_settlement_id uuid references public.advance_settlement (id) on delete restrict,
  receipt_kind text check (receipt_kind in (
    'donor_tranche', 'supplier_refund', 'advance_return', 'other_income', 'bid_security'
  )),
  grant_id uuid references public."grant" (id) on delete restrict,
  entered_by uuid not null default auth.uid() references auth.users (id),
  posted_at timestamptz,
  posted_by uuid references auth.users (id) on delete restrict,
  -- FR-074: required before posting cash, and cheques
  received_by_name text,
  received_on date,
  received_copy_attachment_id uuid references public.doc_attachment (id) on delete restrict,
  -- reversal (US13-6)
  reversal_of_id uuid references public.voucher (id) on delete restrict,
  reversed_by_id uuid references public.voucher (id) on delete restrict,
  reversed_at timestamptz,
  is_imported boolean not null default false,
  import_batch_id uuid references public.import_batch (id) on delete restrict,
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
  constraint voucher_money_account check (
    (type in ('BPV', 'CPV', 'BRV', 'CRV', 'TRF')) = (money_account_id is not null)
  ),
  constraint voucher_transfer_target check ((type = 'TRF') = (to_money_account_id is not null)),
  constraint voucher_transfer_accounts check (money_account_id is distinct from to_money_account_id
    or to_money_account_id is null),
  constraint voucher_jv_reason check (type <> 'JV' or (reason is not null and btrim(reason) <> '')),
  constraint voucher_cheque_no check (
    type <> 'BPV' or payment_method is distinct from 'cheque' or status <> 'posted'
    or (cheque_no is not null and btrim(cheque_no) <> '')
  ),
  constraint voucher_received_by check (
    status <> 'posted' or is_imported or reversal_of_id is not null
    or not (type = 'CPV' or (type = 'BPV' and payment_method = 'cheque'))
    or (received_by_name is not null and btrim(received_by_name) <> ''
        and received_on is not null and received_copy_attachment_id is not null)
  ),
  constraint voucher_posted check ((status = 'posted') = (posted_at is not null)),
  constraint voucher_reversal_self check (reversal_of_id is distinct from id),
  constraint voucher_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

-- one live reversal per voucher
create unique index voucher_one_reversal
  on public.voucher (reversal_of_id) where reversal_of_id is not null and status <> 'cancelled';
-- one live voucher per payment request (reversals aside)
create unique index voucher_one_per_payment_request
  on public.voucher (payment_request_id)
  where payment_request_id is not null and reversal_of_id is null and status <> 'cancelled'
    and reversed_by_id is null;
create index voucher_tenant_status_idx on public.voucher (tenant_id, status);
create index voucher_tenant_date_idx on public.voucher (tenant_id, voucher_date);
create index voucher_office_idx on public.voucher (office_id);
create index voucher_money_account_idx on public.voucher (money_account_id);
create index voucher_to_money_account_idx on public.voucher (to_money_account_id);
create index voucher_payment_request_idx on public.voucher (payment_request_id);
create index voucher_cash_advance_idx on public.voucher (cash_advance_id);
create index voucher_settlement_idx on public.voucher (advance_settlement_id);
create index voucher_grant_idx on public.voucher (grant_id);
create index voucher_entered_by_idx on public.voucher (entered_by);
create index voucher_posted_by_idx on public.voucher (posted_by);
create index voucher_received_copy_idx on public.voucher (received_copy_attachment_id);
create index voucher_reversed_by_idx on public.voucher (reversed_by_id);
create index voucher_import_batch_idx on public.voucher (import_batch_id);
create index voucher_doa_rate_idx on public.voucher (doa_exchange_rate_id);
create index voucher_created_by_idx on public.voucher (created_by);

select app.setup_office_doc_table('public.voucher', 'office_id');

create trigger bump_version before update on public.voucher
  for each row execute function app.bump_version();
create trigger block_delete_after_draft before delete on public.voucher
  for each row execute function app.block_delete_after_draft();

-- The money accounts fit the type: BPV/BRV a bank, CPV/CRV a cash box, TRF two accounts; the
-- header currency is the money account's.
create or replace function app.voucher_accounts_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_currency text;
begin
  if new.money_account_id is null then
    return new;
  end if;
  select m.kind, m.currency into v_kind, v_currency
  from public.money_account m
  where m.id = new.money_account_id and m.tenant_id = new.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'foreign_key_violation',
      detail = 'Bank or cash account not found.';
  end if;
  if (new.type in ('BPV', 'BRV') and v_kind <> 'bank')
    or (new.type in ('CPV', 'CRV') and v_kind <> 'cash') then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'Bank vouchers use a bank account and cash vouchers a cash box.';
  end if;
  if new.type <> 'TRF' and v_currency <> new.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'check_violation',
      detail = format('The account is in %s, the voucher in %s.', v_currency, new.currency);
  end if;
  return new;
end;
$$;

create trigger voucher_accounts_check
  before insert or update of type, money_account_id, currency on public.voucher
  for each row execute function app.voucher_accounts_check();

-- A posted voucher never changes, except that its reversal is stamped once (FR-073, US13-3).
create or replace function app.voucher_immutable_when_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignore text[] := array['reversed_by_id', 'reversed_at', 'version', 'updated_at'];
begin
  if old.status <> 'posted' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE'
    or (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore)
    or (old.reversed_by_id is not null
        and (new.reversed_by_id is distinct from old.reversed_by_id
             or new.reversed_at is distinct from old.reversed_at)) then
    raise exception 'VOUCHER_POSTED_IMMUTABLE' using errcode = 'check_violation',
      detail = 'A posted voucher cannot be changed; reverse it instead.';
  end if;
  return new;
end;
$$;

create trigger voucher_immutable_when_posted
  before update or delete on public.voucher
  for each row execute function app.voucher_immutable_when_posted();

-- Posting needs the voucher month's period to exist and be open (R33).
create or replace function app.voucher_period_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.accounting_period p
    where p.tenant_id = new.tenant_id
      and p.year = extract(year from new.voucher_date)
      and p.month = extract(month from new.voucher_date)
      and p.status = 'open'
  ) then
    raise exception 'PERIOD_CLOSED' using errcode = 'check_violation',
      detail = format('The period %s is closed or does not exist.', to_char(new.voucher_date, 'MM/YYYY'));
  end if;
  return new;
end;
$$;

create trigger voucher_period_open
  before update of status on public.voucher
  for each row when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function app.voucher_period_open();

-- =============================================================================================
-- voucher_line
-- =============================================================================================

create table public.voucher_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  voucher_id uuid not null references public.voucher (id) on delete cascade,
  -- the voucher's type (trigger), so the audit trail files the line under its voucher
  doc_type text not null default 'JV',
  line_no smallint not null check (line_no >= 1),
  account_id uuid not null references public.gl_account (id) on delete restrict,
  description text,
  currency char(3) not null references public.currency (code) on delete restrict,
  debit numeric(18, 2) not null default 0 check (debit >= 0),
  credit numeric(18, 2) not null default 0 check (credit >= 0),
  -- ⟨rate⟩ of the line currency on the voucher date
  rate_to_base numeric(18, 6) not null check (rate_to_base > 0),
  rate_date date not null,
  rate_source text not null,
  exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  base_debit numeric(18, 2) not null default 0,
  base_credit numeric(18, 2) not null default 0,
  -- ⟨dims⟩, donor and the printed "Contract" column
  grant_id uuid references public."grant" (id) on delete restrict,
  budget_line_id uuid references public.budget_line (id) on delete restrict,
  location_office_id uuid references public.office (id) on delete restrict,
  activity_id uuid references public.activity (id) on delete restrict,
  donor_id uuid references public.donor (id) on delete restrict,
  category_text text,
  -- grant currency rate on the voucher date, locked at posting (clarification Q2)
  grant_rate_to_base numeric(18, 6) check (grant_rate_to_base > 0),
  grant_rate_date date,
  grant_rate_source text,
  grant_exchange_rate_id uuid references public.exchange_rate (id) on delete restrict,
  actual_grant_amount numeric(18, 2),
  commitment_consumed_grant numeric(18, 2) check (commitment_consumed_grant >= 0),
  -- the commitment row the posting released (restored by a reversal)
  consumed_commitment_id uuid references public.budget_commitment (id) on delete restrict,
  posted_period date,
  -- trail links (D6)
  payment_request_line_id uuid references public.payment_request_line (id) on delete restrict,
  po_line_id uuid references public.po_line (id) on delete restrict,
  advance_line_id uuid references public.cash_advance_line (id) on delete restrict,
  settlement_line_id uuid references public.advance_settlement_line (id) on delete restrict,
  allocation_source_line_id uuid references public.voucher_line (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (voucher_id, line_no) deferrable initially deferred,
  constraint voucher_line_one_side check ((debit > 0) <> (credit > 0)),
  constraint voucher_line_base_debit check (base_debit = round(debit * rate_to_base, 2)),
  constraint voucher_line_base_credit check (base_credit = round(credit * rate_to_base, 2)),
  constraint voucher_line_actual_needs_line
    check (actual_grant_amount is null or budget_line_id is not null),
  constraint voucher_line_period_first_day
    check (posted_period is null or posted_period = date_trunc('month', posted_period)::date)
);

create index voucher_line_budget_period_idx
  on public.voucher_line (tenant_id, budget_line_id, posted_period)
  where posted_period is not null;
create index voucher_line_account_period_idx
  on public.voucher_line (tenant_id, account_id, posted_period);
create index voucher_line_voucher_idx on public.voucher_line (voucher_id);
create index voucher_line_payment_request_line_idx
  on public.voucher_line (payment_request_line_id);
create index voucher_line_account_idx on public.voucher_line (account_id);
create index voucher_line_rate_idx on public.voucher_line (exchange_rate_id);
create index voucher_line_grant_rate_idx on public.voucher_line (grant_exchange_rate_id);
create index voucher_line_grant_idx on public.voucher_line (grant_id);
create index voucher_line_budget_line_idx on public.voucher_line (budget_line_id);
create index voucher_line_location_idx on public.voucher_line (location_office_id);
create index voucher_line_activity_idx on public.voucher_line (activity_id);
create index voucher_line_donor_idx on public.voucher_line (donor_id);
create index voucher_line_consumed_idx on public.voucher_line (consumed_commitment_id);
create index voucher_line_po_line_idx on public.voucher_line (po_line_id);
create index voucher_line_advance_line_idx on public.voucher_line (advance_line_id);
create index voucher_line_settlement_line_idx on public.voucher_line (settlement_line_id);
create index voucher_line_allocation_source_idx on public.voucher_line (allocation_source_line_id);

select app.setup_doc_child_table('public.voucher_line', 'public.voucher', 'voucher_id');

-- Lines of a posted voucher never change (US13-3); the rest of the line rules (BR-1, BR-2,
-- US13-4, Principle XI).
create or replace function app.voucher_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voucher record;
  v_account record;
  v_base text;
  v_rate record;
  v_source record;
begin
  select v.type, v.status, v.reversal_of_id, v.is_imported into v_voucher
  from public.voucher v
  where v.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  if v_voucher.status = 'posted' then
    raise exception 'VOUCHER_POSTED_IMMUTABLE' using errcode = 'check_violation',
      detail = 'The lines of a posted voucher cannot be changed; reverse it instead.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.doc_type := v_voucher.type;

  select g.tenant_id, g.type, g.is_posting, g.is_active into v_account
  from public.gl_account g where g.id = new.account_id;
  if not found or v_account.tenant_id <> new.tenant_id or not v_account.is_posting
    or (not v_account.is_active and v_voucher.reversal_of_id is null
        and (tg_op = 'INSERT' or new.account_id <> old.account_id)) then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'Voucher lines use active posting accounts.';
  end if;
  if new.actual_grant_amount is not null and v_account.type <> 'expense' then
    raise exception 'VALIDATION_ERROR' using errcode = 'check_violation',
      detail = 'Actual is recorded on expense accounts only.';
  end if;

  -- a base-currency line has rate 1 and no rate row; a foreign line its own rate row's rate
  select t.base_currency::text into v_base from public.tenant t where t.id = new.tenant_id;
  if new.currency = v_base then
    if new.rate_to_base <> 1 or new.exchange_rate_id is not null then
      raise exception 'RATE_CURRENCY_CONTRADICTION' using errcode = 'check_violation',
        detail = format('A %s line has rate 1 and no exchange rate.', v_base);
    end if;
  else
    select r.currency::text, r.rate_to_base into v_rate
    from public.exchange_rate r where r.id = new.exchange_rate_id and r.tenant_id = new.tenant_id;
    if not found or v_rate.currency <> new.currency or v_rate.rate_to_base <> new.rate_to_base then
      raise exception 'RATE_CURRENCY_CONTRADICTION' using errcode = 'check_violation',
        detail = format('A %s line needs its own %s exchange rate.', new.currency, new.currency);
    end if;
  end if;

  -- dimensions of a payment line are the payment request line's
  if new.payment_request_line_id is not null then
    select l.grant_id, l.budget_line_id into v_source
    from public.payment_request_line l where l.id = new.payment_request_line_id;
    if new.grant_id is distinct from v_source.grant_id
      or (new.budget_line_id is not null and new.budget_line_id <> v_source.budget_line_id) then
      raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
        detail = 'A voucher line keeps the grant and budget line of its payment request line.';
    end if;
  end if;
  if new.budget_line_id is not null and not exists (
    select 1 from public.budget_line b
    where b.id = new.budget_line_id and b.grant_id is not distinct from new.grant_id
  ) then
    raise exception 'INHERITED_FIELD_MISMATCH' using errcode = 'check_violation',
      detail = 'The budget line belongs to the line''s grant.';
  end if;
  return new;
end;
$$;

create trigger voucher_line_guard
  before insert or update or delete on public.voucher_line
  for each row execute function app.voucher_line_guard();

-- From `checked` on: Σ base debit = Σ base credit > 0 (FR-069, US13-2), at commit.
create or replace function app.voucher_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit numeric(18, 2);
  v_credit numeric(18, 2);
begin
  if new.status not in ('checked', 'approved', 'posted') then
    return null;
  end if;
  select coalesce(sum(l.base_debit), 0), coalesce(sum(l.base_credit), 0) into v_debit, v_credit
  from public.voucher_line l where l.voucher_id = new.id;
  if v_debit <> v_credit or v_debit = 0 then
    raise exception 'VOUCHER_UNBALANCED' using errcode = 'check_violation',
      detail = format('base debit %s, base credit %s', v_debit, v_credit);
  end if;
  return null;
end;
$$;

create constraint trigger voucher_balanced
  after insert or update of status on public.voucher
  deferrable initially deferred
  for each row execute function app.voucher_balanced();

-- Entered by ≠ checked by ≠ approved by (BR-8; segregation.service decides first).
create or replace function app.voucher_three_signers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entered uuid;
begin
  if new.action <> 'approve' or new.doc_type not in ('BPV', 'CPV', 'BRV', 'CRV', 'JV', 'TRF') then
    return new;
  end if;
  select v.entered_by into v_entered from public.voucher v where v.id = new.doc_id;
  if new.user_id = v_entered or exists (
    select 1 from public.doc_signature s
    where s.doc_type = new.doc_type and s.doc_id = new.doc_id and s.action = 'approve'
      and s.cycle = new.cycle and s.user_id = new.user_id
      and s.step_order is distinct from new.step_order
  ) then
    raise exception 'SEGREGATION_OF_DUTIES' using errcode = 'check_violation',
      detail = 'A voucher is entered, checked and approved by three different people.';
  end if;
  return new;
end;
$$;

create trigger voucher_three_signers
  before insert on public.doc_signature
  for each row execute function app.voucher_three_signers();

-- =============================================================================================
-- Actual in the balance view and the Available guard
-- =============================================================================================

create or replace view public.budget_line_balance
with (security_invoker = true)
as
select
  b.id as budget_line_id,
  b.grant_id,
  b.tenant_id,
  b.budget_amount as budget,
  coalesce(c.reserved, 0)::numeric(18, 2) as reserved,
  coalesce(c.committed, 0)::numeric(18, 2) as committed,
  coalesce(a.actual, 0)::numeric(18, 2) as actual,
  (b.budget_amount - coalesce(c.reserved, 0) - coalesce(c.committed, 0) - coalesce(a.actual, 0))
    ::numeric(18, 2) as available,
  round(
    (coalesce(c.reserved, 0) + coalesce(c.committed, 0) + coalesce(a.actual, 0))
      / nullif(b.budget_amount, 0) * 100, 2
  ) as pct_used
from public.budget_line b
left join lateral (
  select
    sum(bc.amount) filter (where bc.status = 'reserved') as reserved,
    sum(bc.amount) filter (where bc.status = 'committed') as committed
  from public.budget_commitment bc
  where bc.budget_line_id = b.id
    and bc.status in ('reserved', 'committed')
) c on true
left join lateral (
  select sum(vl.actual_grant_amount) as actual
  from public.voucher_line vl
  where vl.budget_line_id = b.id and vl.posted_period is not null
) a on true;

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
  v_actual numeric(18, 2);
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
  select coalesce(sum(l.actual_grant_amount), 0) into v_actual
  from public.voucher_line l
  where l.budget_line_id = p_budget_line_id and l.posted_period is not null;

  if v_used + v_actual > v_budget then
    raise exception 'BUDGET_EXCEEDED'
      using errcode = 'check_violation',
            detail = format('budget_line_id=%s budget=%s used=%s actual=%s',
                            p_budget_line_id, v_budget, v_used, v_actual);
  end if;
end;
$$;

create or replace function app.voucher_line_available_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.budget_line_id is not null and new.posted_period is not null then
    perform app.assert_budget_line_available(new.budget_line_id);
  end if;
  return null;
end;
$$;

create constraint trigger voucher_line_available_guard
  after update of posted_period on public.voucher_line
  deferrable initially deferred
  for each row execute function app.voucher_line_available_guard();

-- =============================================================================================
-- Bank reconciliation (US18)
-- =============================================================================================

create table public.bank_statement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  money_account_id uuid not null references public.money_account (id) on delete restrict,
  year smallint not null check (year between 2000 and 2999),
  month smallint not null check (month between 1 and 12),
  opening_balance numeric(18, 2) not null,
  closing_balance numeric(18, 2) not null,
  status text not null default 'open' check (status in ('open', 'signed_off')),
  signed_off_by uuid references auth.users (id) on delete restrict,
  signed_off_at timestamptz,
  reopen_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (money_account_id, year, month),
  constraint bank_statement_signed check ((status = 'signed_off') = (signed_off_at is not null))
);

create index bank_statement_tenant_idx on public.bank_statement (tenant_id);
create index bank_statement_signed_off_by_idx on public.bank_statement (signed_off_by);

select app.setup_tenant_table('public.bank_statement');

create trigger bump_version before update on public.bank_statement
  for each row execute function app.bump_version();

create table public.bank_statement_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  statement_id uuid not null references public.bank_statement (id) on delete cascade,
  txn_date date not null,
  description text,
  reference text,
  -- signed: deposits positive, withdrawals negative
  amount numeric(18, 2) not null check (amount <> 0),
  import_batch_id uuid references public.import_batch (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

create index bank_statement_line_tenant_idx on public.bank_statement_line (tenant_id);
create index bank_statement_line_statement_idx on public.bank_statement_line (statement_id);
create index bank_statement_line_import_idx on public.bank_statement_line (import_batch_id);

select app.setup_doc_child_table(
  'public.bank_statement_line', 'public.bank_statement', 'statement_id');

create table public.reconciliation_match (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  statement_line_id uuid not null references public.bank_statement_line (id) on delete cascade,
  voucher_line_id uuid not null references public.voucher_line (id) on delete restrict,
  amount numeric(18, 2) not null check (amount <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (statement_line_id, voucher_line_id)
);

create index reconciliation_match_tenant_idx on public.reconciliation_match (tenant_id);
create index reconciliation_match_voucher_line_idx on public.reconciliation_match (voucher_line_id);

select app.setup_doc_child_table(
  'public.reconciliation_match', 'public.bank_statement_line', 'statement_line_id');

-- Matches and statement lines are fixed while the statement is signed off (US18).
create or replace function app.reconciliation_signed_off_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  if exists (
    select 1 from public.bank_statement s
    where s.status = 'signed_off'
      and s.id = case tg_table_name
        when 'bank_statement_line' then (v_row ->> 'statement_id')::uuid
        else (select l.statement_id from public.bank_statement_line l
              where l.id = (v_row ->> 'statement_line_id')::uuid)
      end
  ) then
    raise exception 'INVALID_STATE' using errcode = 'check_violation',
      detail = 'The statement is signed off; reopen it first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger reconciliation_signed_off_guard
  before insert or update or delete on public.bank_statement_line
  for each row execute function app.reconciliation_signed_off_guard();
create trigger reconciliation_signed_off_guard
  before insert or update or delete on public.reconciliation_match
  for each row execute function app.reconciliation_signed_off_guard();

-- =============================================================================================
-- Shared cost allocation (US17)
-- =============================================================================================

create table public.allocation_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (tenant_id, name),
  constraint allocation_template_dates check (effective_to is null or effective_to >= effective_from)
);

select app.setup_tenant_table('public.allocation_template');

create trigger bump_version before update on public.allocation_template
  for each row execute function app.bump_version();

create table public.allocation_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  template_id uuid not null references public.allocation_template (id) on delete cascade,
  grant_id uuid not null references public."grant" (id) on delete restrict,
  budget_line_id uuid not null references public.budget_line (id) on delete restrict,
  pct numeric(5, 2) not null check (pct > 0 and pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  unique (template_id, budget_line_id)
);

create index allocation_line_tenant_idx on public.allocation_line (tenant_id);
create index allocation_line_grant_idx on public.allocation_line (grant_id);
create index allocation_line_budget_line_idx on public.allocation_line (budget_line_id);

select app.setup_doc_child_table('public.allocation_line', 'public.allocation_template', 'template_id');

create or replace function app.allocation_total_100()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template uuid := ((to_jsonb(case when tg_op = 'DELETE' then old else new end)) ->> 'template_id')::uuid;
  v_total numeric(7, 2);
begin
  if not exists (select 1 from public.allocation_template t where t.id = v_template) then
    return null;
  end if;
  select coalesce(sum(l.pct), 0) into v_total
  from public.allocation_line l where l.template_id = v_template;
  if v_total <> 100.00 then
    raise exception 'ALLOCATION_NOT_100' using errcode = 'check_violation',
      detail = format('The percentages add up to %s.', v_total);
  end if;
  return null;
end;
$$;

create constraint trigger allocation_total_100
  after insert or update or delete on public.allocation_line
  deferrable initially deferred
  for each row execute function app.allocation_total_100();

-- =============================================================================================
-- FKs that waited for vouchers; registry, audit, rates in use
-- =============================================================================================

alter table public.bid_security
  add constraint bid_security_receipt_voucher_fk
    foreign key (receipt_voucher_id) references public.voucher (id) on delete restrict,
  add constraint bid_security_return_voucher_fk
    foreign key (return_voucher_id) references public.voucher (id) on delete restrict;
create index if not exists bid_security_receipt_voucher_idx on public.bid_security (receipt_voucher_id);
create index if not exists bid_security_return_voucher_idx on public.bid_security (return_voucher_id);

alter table public.cash_advance
  add constraint cash_advance_paid_voucher_fk
  foreign key (paid_voucher_id) references public.voucher (id) on delete restrict;

update app.doc_type_registry
set table_name = 'public.voucher', office_column = 'office_id'
where code in ('BPV', 'CPV', 'BRV', 'CRV', 'JV', 'TRF');

insert into app.audit_parent_map (table_name, doc_type, doc_type_column, id_column) values
  ('voucher', null, 'type', 'id'),
  ('voucher_line', null, 'doc_type', 'voucher_id');

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'voucher', 'voucher_line', 'import_batch', 'bank_statement', 'bank_statement_line',
    'reconciliation_match', 'allocation_template', 'allocation_line'
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
where s.doa_exchange_rate_id is not null
union all
select v.doa_exchange_rate_id from public.voucher v where v.doa_exchange_rate_id is not null
union all
select l.exchange_rate_id from public.voucher_line l where l.exchange_rate_id is not null
union all
select l.grant_exchange_rate_id from public.voucher_line l
where l.grant_exchange_rate_id is not null;

revoke all on app.exchange_rate_usage from public, anon, authenticated;

revoke execute on function
  app.voucher_accounts_check(),
  app.voucher_immutable_when_posted(),
  app.voucher_period_open(),
  app.voucher_line_guard(),
  app.voucher_balanced(),
  app.voucher_three_signers(),
  app.voucher_line_available_guard(),
  app.reconciliation_signed_off_guard(),
  app.allocation_total_100()
from public, anon, authenticated;
