-- 0021 — 002 organization defaults (data-model §11 items 1, 3, 4; research D7, D8).
--
-- Depends only on 001 tables and the 0012 registry, so it is applied with the foundation; the
-- later 002 migrations (0015–0020) register their own seed hooks for the tables they create.
--
-- * the permission catalogue additions (global; mirrors packages/shared/src/permissions.ts);
-- * per tenant (seed hook 20): the eight new roles with the exact permission sets of
--   contracts/rls-and-permissions.md §4, the additions to the 001 roles org_admin, requester
--   and viewer, numbering for every new document code, and one org-wide DoA rule per type.
--
-- Every insert is idempotent and skips what an organization already has: an existing rule for a
-- type is never replaced, and a role whose names an admin already used is not created (its
-- rules are then skipped too, and the admin configures them).

insert into public.permission (code, description_ar, description_en) values
  ('suppliers:read', 'عرض الموردين', 'View suppliers'),
  ('suppliers:manage', 'إدارة الموردين ووثائقهم وحالاتهم (عدا الاعتماد)',
   'Maintain suppliers, their documents and status (except approval)'),
  ('suppliers:vet', 'تسجيل التحقق من الموردين واعتمادهم', 'Record supplier vetting and approve suppliers'),
  ('procurement:read', 'عرض طلبات عروض الأسعار والتحليلات وأوامر الشراء والاستلام',
   'View sourcing, analyses, purchase orders and receipts'),
  ('procurement:configure', 'تعديل نطاقات طرق الشراء والتفاوتات والخصومات والفئات',
   'Edit procurement method bands, tolerances, deductions and categories'),
  ('rfq:create', 'إعداد طلبات عروض الأسعار وتسجيل الاستلام والتحليلات',
   'Draft RFQs, log offer receipts, create analyses, re-issue and cancel'),
  ('rfq:issue', 'إصدار طلبات عروض الأسعار', 'Issue RFQs'),
  ('rfq:open', 'تسجيل فتح العروض وإدخال الأسعار', 'Record the opening and enter prices'),
  ('tender:manage', 'إدارة ملف المناقصة والنشر والاستيضاحات والضمانات',
   'Manage the tender file, publication, clarifications, bids log and securities'),
  ('tender:open', 'جلسة فتح المظاريف', 'Run the tender opening session'),
  ('evaluation:score', 'التقييم كعضو لجنة مصرّح', 'Score as a declared committee member'),
  ('evaluation:sign', 'توقيع التحليل', 'Sign the analysis'),
  ('award:approve', 'مؤهل لخطوات اعتماد الترسية', 'Eligible for award approval steps'),
  ('waiver:create', 'إنشاء طلبات الإعفاء', 'Create waivers'),
  ('waiver:approve', 'مؤهل لخطوات اعتماد الإعفاء', 'Eligible for waiver approval steps'),
  ('po:create', 'إنشاء أوامر الشراء والعقود', 'Create purchase orders and contracts'),
  ('po:approve', 'مؤهل لخطوات اعتماد أوامر الشراء والعقود والتعديلات',
   'Eligible for PO, contract and amendment approval steps'),
  ('po:amend', 'تعديل أوامر الشراء المعتمدة', 'Amend approved purchase orders'),
  ('po:cancel', 'إلغاء أوامر الشراء', 'Cancel purchase orders'),
  ('po:close', 'إقفال أوامر الشراء يدويًا', 'Close purchase orders manually'),
  ('grn:create', 'تسجيل الاستلام (المستلم)', 'Receive goods (Received By)'),
  ('grn:inspect', 'الفحص وشهادات الإنجاز (الفاحص)', 'Inspect receipts and sign completion certificates'),
  ('invoice:register', 'تسجيل فواتير الموردين', 'Register supplier invoices'),
  ('payment:create', 'إعداد طلبات الدفع', 'Prepare payment requests'),
  ('payment:check', 'مؤهل لخطوات التدقيق المالي لطلبات الدفع', 'Eligible for payment finance check steps'),
  ('payment:approve', 'مؤهل لخطوات اعتماد طلبات الدفع', 'Eligible for payment approval steps'),
  ('payment:override_match', 'تجاوز نتيجة المطابقة الثلاثية مع سبب',
   'Override a failed three-way match with a reason'),
  ('voucher:create', 'إعداد السندات', 'Prepare vouchers'),
  ('voucher:check', 'مؤهل لخطوات تدقيق السندات', 'Eligible for voucher check steps'),
  ('voucher:approve', 'مؤهل لخطوات اعتماد السندات', 'Eligible for voucher approval steps'),
  ('voucher:post', 'ترحيل السندات المعتمدة', 'Post approved vouchers'),
  ('voucher:reverse', 'عكس السندات المرحلة', 'Reverse posted vouchers'),
  ('accounts:manage', 'إدارة دليل الحسابات والربط والحسابات الرقابية والاستيراد',
   'Manage the chart of accounts, mappings, control accounts and imports'),
  ('periods:manage', 'إقفال الفترات المحاسبية وإعادة فتحها', 'Close and reopen accounting periods'),
  ('bank:manage', 'إدارة الحسابات البنكية والصناديق', 'Manage bank accounts and cash boxes'),
  ('bank:reconcile', 'كشوف البنك والمطابقة', 'Bank statements and reconciliation'),
  ('advance:request', 'طلب السلف', 'Request cash advances'),
  ('advance:approve', 'مؤهل لخطوات اعتماد السلف والتسويات', 'Eligible for advance and settlement approval steps'),
  ('advance:settle', 'تسوية السلف', 'Settle cash advances'),
  ('allocation:manage', 'إدارة قوالب توزيع التكاليف', 'Manage cost allocations'),
  ('finance:read', 'عرض السندات والحسابات والفترات والحسابات البنكية',
   'View vouchers, accounts, periods and money accounts'),
  ('reports:read', 'تقارير المشتريات والميزانية', 'Procurement and budget reports'),
  ('reports:finance', 'الأستاذ العام وميزان المراجعة والدفاتر', 'General ledger, trial balance and books')
on conflict (code) do nothing;

create or replace function app.seed_doc_defaults_002(p_tenant uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- signing permissions the organization admin never holds (rls-and-permissions §4)
  v_admin_excluded constant text[] := array[
    'award:approve', 'po:approve', 'waiver:approve', 'payment:check', 'payment:approve',
    'voucher:check', 'voucher:approve', 'evaluation:score', 'evaluation:sign', 'advance:approve',
    'grn:inspect'
  ];
  v_new_codes constant text[] := array[
    'suppliers:read', 'suppliers:manage', 'suppliers:vet', 'procurement:read',
    'procurement:configure', 'rfq:create', 'rfq:issue', 'rfq:open', 'tender:manage',
    'tender:open', 'evaluation:score', 'evaluation:sign', 'award:approve', 'waiver:create',
    'waiver:approve', 'po:create', 'po:approve', 'po:amend', 'po:cancel', 'po:close',
    'grn:create', 'grn:inspect', 'invoice:register', 'payment:create', 'payment:check',
    'payment:approve', 'payment:override_match', 'voucher:create', 'voucher:check',
    'voucher:approve', 'voucher:post', 'voucher:reverse', 'accounts:manage', 'periods:manage',
    'bank:manage', 'bank:reconcile', 'advance:request', 'advance:approve', 'advance:settle',
    'allocation:manage', 'finance:read', 'reports:read', 'reports:finance'
  ];
  v_fm uuid;
  v_cd uuid;
  v_rule uuid;
  v_type record;
begin
  -- 1. the eight new roles and their permission sets ---------------------------------------
  insert into public.role (tenant_id, key, name_ar, name_en, is_system)
  values
    (p_tenant, 'procurement_officer', 'مسؤول المشتريات', 'Procurement Officer', true),
    (p_tenant, 'committee_member', 'عضو لجنة', 'Committee Member', true),
    (p_tenant, 'storekeeper', 'أمين المخزن / المستلم', 'Storekeeper / Receiver', true),
    (p_tenant, 'technical_inspector', 'المفتش الفني', 'Technical Inspector', true),
    (p_tenant, 'accountant', 'المحاسب', 'Accountant', true),
    (p_tenant, 'finance_manager', 'المدير المالي', 'Finance Manager', true),
    (p_tenant, 'cashier', 'أمين الصندوق', 'Cashier', true),
    (p_tenant, 'country_director', 'المدير القطري / المفوض بالتوقيع',
     'Country Director / Authorized Signatory', true)
  on conflict do nothing;

  insert into public.role_permission (role_id, permission_code, tenant_id)
  select r.id, p.code, p_tenant
  from (values
    ('procurement_officer', array[
      'pr:read', 'procurement:read', 'suppliers:read', 'suppliers:manage', 'rfq:create',
      'rfq:issue', 'rfq:open', 'tender:manage', 'tender:open', 'waiver:create', 'po:create',
      'po:amend', 'po:cancel', 'po:close', 'reports:read']),
    ('committee_member', array['procurement:read', 'evaluation:score', 'evaluation:sign']),
    ('storekeeper', array['procurement:read', 'grn:create']),
    ('technical_inspector', array['procurement:read', 'grn:inspect']),
    ('accountant', array[
      'procurement:read', 'finance:read', 'invoice:register', 'payment:create',
      'voucher:create', 'voucher:post', 'advance:settle', 'budget:read', 'reports:read',
      'reports:finance']),
    ('finance_manager', array[
      'finance:read', 'procurement:read', 'suppliers:vet', 'payment:check',
      'payment:override_match', 'voucher:check', 'voucher:reverse', 'accounts:manage',
      'periods:manage', 'bank:manage', 'bank:reconcile', 'allocation:manage', 'award:approve',
      'po:approve', 'waiver:approve', 'advance:approve', 'rates:manage', 'budget:read',
      'reports:read', 'reports:finance']),
    ('cashier', array['finance:read', 'voucher:create', 'voucher:post', 'bank:manage']),
    ('country_director', array[
      'procurement:read', 'finance:read', 'award:approve', 'po:approve', 'waiver:approve',
      'payment:approve', 'voucher:approve', 'advance:approve', 'reports:read',
      'reports:finance']),
    -- additions to the 001 roles
    ('org_admin', (
      select array_agg(c) from unnest(v_new_codes) c where c <> all (v_admin_excluded))),
    ('requester', array['advance:request']),
    ('viewer', array[
      'procurement:read', 'finance:read', 'suppliers:read', 'reports:read', 'reports:finance'])
  ) as s (role_key, codes)
  join public.role r on r.tenant_id = p_tenant and r.key = s.role_key
  cross join lateral unnest(s.codes) as p (code)
  on conflict (role_id, permission_code) do nothing;

  -- 2. numbering for every new code: {prefix}-{OFFICE}-{YYYY}-{seq:4} --------------------
  insert into public.numbering_config (tenant_id, doc_type, prefix)
  select p_tenant, d.code, d.code
  from app.doc_type_registry d
  where d.code <> 'PR'
  on conflict (tenant_id, doc_type) do nothing;

  -- 3. one org-wide DoA rule per new type (research D8) ------------------------------------
  select r.id into v_fm from public.role r where r.tenant_id = p_tenant and r.key = 'finance_manager';
  select r.id into v_cd from public.role r where r.tenant_id = p_tenant and r.key = 'country_director';
  if v_fm is null then
    return;
  end if;

  for v_type in
    select t.doa_type, t.first_kind, t.two_steps
    from (values
      ('AWARD', 'approval', true),
      ('PO', 'approval', true),
      ('CON', 'approval', true),
      ('AMD', 'approval', true),
      ('WAIVER', 'approval', true),
      ('PAY', 'finance_check', true),
      ('DPR', 'finance_check', true),
      ('PV', 'check', true),
      ('RV', 'check', true),
      ('JV', 'check', true),
      ('ADV', 'final_approval', false),
      ('STL', 'final_approval', false)
    ) as t (doa_type, first_kind, two_steps)
    where (not t.two_steps or v_cd is not null)
      and not exists (
        select 1 from public.approval_rule ar
        where ar.tenant_id = p_tenant and ar.doc_type = t.doa_type and ar.office_id is null
      )
  loop
    insert into public.approval_rule (tenant_id, doc_type, office_id, name, is_active)
    values (p_tenant, v_type.doa_type, null, format('Default %s approval', v_type.doa_type), true)
    returning id into v_rule;

    insert into public.approval_rule_step (tenant_id, rule_id, step_order, kind, role_id)
    values (p_tenant, v_rule, 1, v_type.first_kind, v_fm);
    if v_type.two_steps then
      insert into public.approval_rule_step (tenant_id, rule_id, step_order, kind, role_id)
      values (p_tenant, v_rule, 2, 'final_approval', v_cd);
    end if;
  end loop;
end;
$$;

revoke execute on function app.seed_doc_defaults_002(uuid) from public, anon, authenticated;

insert into app.tenant_seed_hook (seq, fn)
values (20, 'app.seed_doc_defaults_002(uuid)'::regprocedure);

select app.run_tenant_seed_hooks(t.id) from public.tenant t;
