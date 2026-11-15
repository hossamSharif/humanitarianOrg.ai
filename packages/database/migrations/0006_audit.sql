-- 0006 — append-only audit history (Principle I, research R9).
--
-- `audit.log_change()` runs AFTER INSERT/UPDATE/DELETE on every tenant table from 0002–0005
-- except audit_history, notification and idempotency_key. Global reference tables (currency,
-- permission) have no tenant and change only through migrations, so they are not attached.
-- `pr_id` (not in data-model §5) ties child rows to their PR so the PR timeline and the RLS read
-- rule ("PR records the caller can read") need no per-table joins.

create table public.audit_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  table_name text not null,
  record_id uuid,
  pr_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  from_state text,
  to_state text,
  changed_fields text[],
  old_data jsonb,
  new_data jsonb,
  comment text,
  request_id text
);

create index audit_history_record_idx
  on public.audit_history (tenant_id, table_name, record_id, occurred_at);
create index audit_history_pr_idx
  on public.audit_history (pr_id, occurred_at) where pr_id is not null;

alter table public.audit_history enable row level security;

create policy tenant_select on public.audit_history for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.has_permission('audit:read'))
      or (
        pr_id is not null
        and exists (select 1 from public.purchase_requisition p where p.id = audit_history.pr_id)
      )
    )
  );
-- No insert/update/delete policies: rows are written only by the SECURITY DEFINER trigger.
revoke insert, update, delete, truncate on public.audit_history from anon, authenticated;

create trigger audit_history_append_only
  before update or delete on public.audit_history
  for each row execute function app.block_modification();

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_pr_id uuid;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'version')
      and n.value is distinct from v_old -> n.key;

    -- nothing but bookkeeping columns changed
    if v_changed is null then
      return null;
    end if;
  end if;

  v_pr_id := case
    when tg_table_name = 'purchase_requisition' then (v_row ->> 'id')::uuid
    else (v_row ->> 'pr_id')::uuid
  end;

  insert into public.audit_history (
    tenant_id, table_name, record_id, pr_id, action, actor_id,
    from_state, to_state, changed_fields, old_data, new_data, comment, request_id
  ) values (
    case when tg_table_name = 'tenant' then (v_row ->> 'id')::uuid
         else (v_row ->> 'tenant_id')::uuid end,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_pr_id,
    lower(tg_op),
    auth.uid(),
    v_old ->> 'status',
    v_new ->> 'status',
    v_changed,
    v_old,
    v_new,
    nullif(current_setting('app.audit_comment', true), ''),
    nullif(current_setting('app.request_id', true), '')
  );

  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'tenant', 'membership', 'office', 'user_office', 'role', 'role_permission', 'user_role',
    'unit_of_measure', 'numbering_config', 'document_sequence', 'approval_rule',
    'approval_rule_step', 'donor', 'grant', 'grant_office', 'activity', 'budget_line',
    'exchange_rate', 'purchase_requisition', 'pr_line', 'pr_attachment', 'pr_approval_step',
    'approval_action', 'budget_commitment'
  ] loop
    execute format(
      'create trigger audit_log_change after insert or update or delete on public.%I '
      'for each row execute function audit.log_change()', v_table);
  end loop;
end;
$$;
