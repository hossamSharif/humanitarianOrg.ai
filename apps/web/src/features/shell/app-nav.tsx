'use client';

import { PERMISSIONS, type Permission } from '@ngo/shared';
import { cn } from '@ngo/ui';
import {
  BarChart3,
  BookOpen,
  Building2,
  Contact,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Gavel,
  HandCoins,
  Home,
  Landmark,
  type LucideIcon,
  PackageCheck,
  PieChart,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useMe } from '@/lib/use-me';

// Read permissions of the 002 modules (contracts/rls-and-permissions.md §2). They join PERMISSIONS
// in the foundation phase (T019); until a role grants them, these links stay hidden.
const P002 = {
  PROCUREMENT_READ: 'procurement:read',
  FINANCE_READ: 'finance:read',
  REPORTS_READ: 'reports:read',
  SUPPLIERS_READ: 'suppliers:read',
  SUPPLIERS_VET: 'suppliers:vet',
  PAYMENT_CREATE: 'payment:create',
} as const;

type NavPermission = Permission | (typeof P002)[keyof typeof P002];

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown when the user holds any of these; omitted = every member */
  anyOf?: NavPermission[];
  /** active only on this exact path, not on its children */
  exact?: boolean;
}

interface NavGroup {
  /** key under nav.groups; omitted = no heading */
  label?: string;
  items: NavItem[];
}

const P = PERMISSIONS;

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/', label: 'home', icon: Home, exact: true },
      { href: '/prs', label: 'prs', icon: FileText, anyOf: [P.PR_READ] },
      {
        href: '/my-tasks',
        label: 'myTasks',
        icon: ClipboardCheck,
        anyOf: [P.PR_FINANCE_CHECK, P.PR_APPROVE],
      },
      {
        href: '/grants',
        label: 'grants',
        icon: HandCoins,
        anyOf: [P.GRANTS_MANAGE, P.BUDGET_READ],
      },
      { href: '/donors', label: 'donors', icon: Landmark, anyOf: [P.GRANTS_MANAGE, P.BUDGET_READ] },
    ],
  },
  {
    label: 'procurement',
    items: [
      {
        href: '/procurement/suppliers',
        label: 'suppliers',
        icon: Building2,
        anyOf: [P002.PROCUREMENT_READ, P002.SUPPLIERS_READ, P002.SUPPLIERS_VET],
      },
      {
        href: '/procurement/rfqs',
        label: 'rfqs',
        icon: ClipboardList,
        anyOf: [P002.PROCUREMENT_READ],
      },
      {
        href: '/procurement/tenders',
        label: 'tenders',
        icon: Gavel,
        anyOf: [P002.PROCUREMENT_READ],
      },
      {
        href: '/procurement/analyses',
        label: 'evaluations',
        icon: Scale,
        anyOf: [P002.PROCUREMENT_READ],
      },
      {
        href: '/procurement/pos',
        label: 'posContracts',
        icon: FileSignature,
        anyOf: [P002.PROCUREMENT_READ],
      },
      {
        href: '/procurement/receiving',
        label: 'receiving',
        icon: PackageCheck,
        anyOf: [P002.PROCUREMENT_READ],
      },
    ],
  },
  {
    label: 'finance',
    items: [
      { href: '/finance/invoices', label: 'invoices', icon: Receipt, anyOf: [P002.FINANCE_READ] },
      {
        href: '/finance/payment-requests',
        label: 'paymentRequests',
        icon: FileText,
        anyOf: [P002.FINANCE_READ],
      },
      {
        href: '/finance/direct-payments',
        label: 'directPayments',
        icon: Truck,
        anyOf: [P002.FINANCE_READ],
      },
      { href: '/finance/advances', label: 'advances', icon: HandCoins, anyOf: [P002.FINANCE_READ] },
      {
        href: '/finance/staff-payees',
        label: 'staffPayees',
        icon: Contact,
        anyOf: [P002.PAYMENT_CREATE],
      },
      {
        href: '/finance/vouchers',
        label: 'vouchers',
        icon: FileSpreadsheet,
        anyOf: [P002.FINANCE_READ],
      },
      { href: '/finance/bank-cash', label: 'bankCash', icon: Wallet, anyOf: [P002.FINANCE_READ] },
      {
        href: '/finance/accounts',
        label: 'chartOfAccounts',
        icon: BookOpen,
        anyOf: [P002.FINANCE_READ],
      },
      {
        href: '/finance/periods',
        label: 'periods',
        icon: CalendarRange,
        anyOf: [P002.FINANCE_READ],
      },
    ],
  },
  {
    label: 'reports',
    items: [
      {
        href: '/reports',
        label: 'allReports',
        icon: PieChart,
        anyOf: [P002.REPORTS_READ],
        exact: true,
      },
      {
        href: '/reports/budget-status',
        label: 'budgetReport',
        icon: BarChart3,
        anyOf: [P.BUDGET_READ],
      },
    ],
  },
  {
    label: 'settings',
    items: [
      { href: '/rates', label: 'rates', icon: Coins, anyOf: [P.RATES_MANAGE] },
      { href: '/users', label: 'users', icon: Users, anyOf: [P.USERS_MANAGE] },
      { href: '/roles', label: 'roles', icon: ShieldCheck, anyOf: [P.ROLES_MANAGE] },
      {
        href: '/approval-rules',
        label: 'approvalRules',
        icon: Workflow,
        anyOf: [P.SETTINGS_MANAGE],
      },
      {
        href: '/settings/procurement',
        label: 'procurementSettings',
        icon: SlidersHorizontal,
        anyOf: [P002.PROCUREMENT_READ],
      },
      { href: '/setup', label: 'settings', icon: Settings, anyOf: [P.SETTINGS_MANAGE] },
    ],
  },
];

/** Links the caller may use, grouped by module; the API still enforces every permission. */
export function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { data: me } = useMe();
  const held = new Set<string>(me?.permissions ?? []);
  const visible = (item: NavItem) => !item.anyOf || item.anyOf.some((p) => held.has(p));

  return (
    <nav className="flex flex-col gap-4">
      {GROUPS.map((group, index) => {
        const items = group.items.filter(visible);
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? index} className="flex flex-col gap-1">
            {group.label ? (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`groups.${group.label}`)}
              </p>
            ) : null}
            {items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                    active && 'bg-accent text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {t(item.label)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
