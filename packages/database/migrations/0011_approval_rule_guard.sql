-- 0011 — US3 approval rule integrity (FR-019, FR-035).
-- The approval-routing service validates a rule before saving it and explains every problem
-- (422 APPROVAL_RULE_INVALID). This deferred guard is the database backstop: whatever writes
-- approval_rule / approval_rule_step (API, seeding, or a client calling PostgREST directly with
-- its own token), a transaction cannot commit a PR rule whose step 1 is not the only finance
-- check, or whose final-approval bands leave an amount without a route. Deferred so a full
-- replace (delete steps, insert new ones) is checked once, at commit.

create or replace function app.approval_rule_check(p_rule_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_highest smallint;
  v_orders smallint;
  v_problem text;
  v_prev_max numeric(18, 2);
  v_first boolean := true;
  v_band record;
begin
  -- rule deleted in the same transaction (steps cascade): nothing to check
  if not exists (select 1 from public.approval_rule r where r.id = p_rule_id) then
    return;
  end if;

  select max(s.step_order), count(distinct s.step_order)
  into v_highest, v_orders
  from public.approval_rule_step s
  where s.rule_id = p_rule_id;

  if v_highest is null then
    v_problem := 'no_steps';
  elsif v_orders <> v_highest then
    v_problem := 'step_order_gap';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.step_order = 1 and s.kind <> 'finance_check'
  ) then
    v_problem := 'first_step_not_finance_check';
  elsif (
    select count(*) from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.kind = 'finance_check'
  ) <> 1 then
    v_problem := 'multiple_finance_check';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id
      and ((s.step_order = v_highest) <> (s.kind = 'final_approval'))
  ) then
    v_problem := 'final_not_highest';
  elsif exists (
    select 1 from public.approval_rule_step s
    where s.rule_id = p_rule_id and s.step_order < v_highest
    group by s.step_order
    having count(*) > 1
        or bool_or(s.min_amount is not null or s.max_amount is not null)
  ) then
    v_problem := 'non_final_multiple_rows';
  else
    -- final bands: start at 0, each starts where the previous ended, the last is open
    for v_band in
      select coalesce(s.min_amount, 0) as lo, s.max_amount as hi
      from public.approval_rule_step s
      where s.rule_id = p_rule_id and s.step_order = v_highest
      order by coalesce(s.min_amount, 0), s.max_amount nulls last
    loop
      if v_first then
        if v_band.lo <> 0 then
          v_problem := 'band_not_from_zero';
          exit;
        end if;
        v_first := false;
      elsif v_prev_max is null or v_band.lo <> v_prev_max then
        v_problem := case when v_prev_max is null or v_band.lo < v_prev_max
                          then 'band_overlap' else 'band_gap' end;
        exit;
      end if;
      v_prev_max := v_band.hi;
    end loop;

    if v_problem is null and v_prev_max is not null then
      v_problem := 'band_not_open_ended';
    end if;
  end if;

  if v_problem is not null then
    raise exception 'APPROVAL_RULE_INVALID'
      using errcode = 'check_violation',
            detail = format('rule_id=%s reason=%s', p_rule_id, v_problem);
  end if;
end;
$$;

create or replace function app.approval_rule_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'approval_rule' then
    perform app.approval_rule_check(new.id);
  else
    if tg_op in ('INSERT', 'UPDATE') then
      perform app.approval_rule_check(new.rule_id);
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      perform app.approval_rule_check(old.rule_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger approval_rule_guard
  after insert on public.approval_rule
  deferrable initially deferred
  for each row execute function app.approval_rule_guard();

create constraint trigger approval_rule_step_guard
  after insert or update or delete on public.approval_rule_step
  deferrable initially deferred
  for each row execute function app.approval_rule_guard();

revoke execute on function app.approval_rule_check(uuid), app.approval_rule_guard()
  from public, anon, authenticated;
