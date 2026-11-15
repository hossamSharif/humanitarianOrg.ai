'use client';

import { PERMISSIONS, type Permission } from '@ngo/shared';
import { cn } from '@ngo/ui';
import {
  BarChart3,
  ClipboardCheck,
  Coins,
  FileText,
  HandCoins,
  Home,
  Landmark,
  type LucideIcon,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useHasPermission } from '@/lib/use-me';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown when the user holds any of these; omitted = every member */
  anyOf?: Permission[];
}

const P = PERMISSIONS;

const ITEMS: NavItem[] = [
  { href: '/', label: 'home', icon: Home },
  { href: '/prs', label: 'prs', icon: FileText, anyOf: [P.PR_READ] },
  {
    href: '/my-tasks',
    label: 'myTasks',
    icon: ClipboardCheck,
    anyOf: [P.PR_FINANCE_CHECK, P.PR_APPROVE],
  },
  { href: '/grants', label: 'grants', icon: HandCoins, anyOf: [P.GRANTS_MANAGE, P.BUDGET_READ] },
  { href: '/donors', label: 'donors', icon: Landmark, anyOf: [P.GRANTS_MANAGE, P.BUDGET_READ] },
  {
    href: '/reports/budget-status',
    label: 'budgetReport',
    icon: BarChart3,
    anyOf: [P.BUDGET_READ],
  },
  { href: '/rates', label: 'rates', icon: Coins, anyOf: [P.RATES_MANAGE] },
  { href: '/users', label: 'users', icon: Users, anyOf: [P.USERS_MANAGE] },
  { href: '/roles', label: 'roles', icon: ShieldCheck, anyOf: [P.ROLES_MANAGE] },
  { href: '/approval-rules', label: 'approvalRules', icon: Workflow, anyOf: [P.SETTINGS_MANAGE] },
  { href: '/setup', label: 'settings', icon: Settings, anyOf: [P.SETTINGS_MANAGE] },
];

/** Links the caller may use; the API still enforces every permission. */
export function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const can = useHasPermission();

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.filter((item) => !item.anyOf || can(...item.anyOf)).map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
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
    </nav>
  );
}
