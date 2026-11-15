-- 0008 — global reference data: currencies (names for amount-in-words) and the permission
-- catalogue (contracts/rls-and-permissions.md §3; mirrors packages/shared/src/permissions.ts).

insert into public.currency (
  code, minor_units,
  name_ar_singular, name_ar_dual, name_ar_plural, name_en_singular, name_en_plural,
  minor_name_ar_singular, minor_name_ar_dual, minor_name_ar_plural,
  minor_name_en_singular, minor_name_en_plural
) values
  ('SDG', 2,
   'جنيه سوداني', 'جنيهان سودانيان', 'جنيهات سودانية', 'Sudanese Pound', 'Sudanese Pounds',
   'قرش', 'قرشان', 'قروش', 'Piastre', 'Piastres'),
  ('USD', 2,
   'دولار أمريكي', 'دولاران أمريكيان', 'دولارات أمريكية', 'US Dollar', 'US Dollars',
   'سنت', 'سنتان', 'سنتات', 'Cent', 'Cents'),
  ('EUR', 2,
   'يورو', 'يوروان', 'يوروهات', 'Euro', 'Euros',
   'سنت', 'سنتان', 'سنتات', 'Cent', 'Cents'),
  ('GBP', 2,
   'جنيه إسترليني', 'جنيهان إسترلينيان', 'جنيهات إسترلينية', 'Pound Sterling', 'Pounds Sterling',
   'بنس', 'بنسان', 'بنسات', 'Penny', 'Pence'),
  ('SAR', 2,
   'ريال سعودي', 'ريالان سعوديان', 'ريالات سعودية', 'Saudi Riyal', 'Saudi Riyals',
   'هللة', 'هللتان', 'هللات', 'Halala', 'Halalas')
on conflict (code) do nothing;

insert into public.permission (code, description_ar, description_en) values
  ('settings:manage', 'إدارة إعدادات المنظمة والمكاتب والوحدات والترقيم وقواعد الاعتماد',
   'Manage organization profile, offices, units, numbering and approval rules'),
  ('users:manage', 'دعوة المستخدمين وتعيين المكاتب والأدوار وإيقاف الحسابات',
   'Invite users, assign offices and roles, suspend users'),
  ('roles:manage', 'تعديل الأدوار ومجموعات الصلاحيات', 'Edit roles and permission sets'),
  ('grants:manage', 'إدارة المانحين والمنح وبنود الميزانية والأنشطة والاستيراد',
   'Manage donors, grants, grant status, budget lines, activities and import'),
  ('rates:manage', 'إدارة أسعار الصرف', 'Manage exchange rates'),
  ('budget:read', 'عرض تقرير حالة الميزانية والتفاصيل', 'View the budget status report and drill-down'),
  ('pr:read', 'عرض طلبات الشراء ضمن نطاق المكاتب', 'View purchase requisitions within office scope'),
  ('pr:create', 'إنشاء طلبات الشراء وتعديل المسودات وتقديمها وإلغاء الطلبات الخاصة',
   'Create, edit own drafts, submit and cancel own purchase requisitions'),
  ('pr:finance_check', 'مؤهل لخطوات التدقيق المالي', 'Eligible for finance check steps'),
  ('pr:approve', 'مؤهل لخطوات الاعتماد والاعتماد النهائي', 'Eligible for approval and final approval steps'),
  ('pr:cancel_approved', 'إلغاء الطلبات المعتمدة وطلبات المستخدمين الآخرين',
   'Cancel approved requisitions and pending or returned requisitions of other requesters'),
  ('pr:reassign', 'إعادة تعيين خطوات الاعتماد المعلقة', 'Reassign pending approval steps'),
  ('audit:read', 'قراءة سجل تغييرات الإعدادات', 'Read the history of configuration records')
on conflict (code) do nothing;
