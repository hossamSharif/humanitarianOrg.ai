'use client';

import { Button, Sheet, SheetContent, SheetTrigger } from '@ngo/ui';
import { LogOut, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { AppNav } from './app-nav';
import { LocaleSwitcher } from './locale-switcher';
import { OrgSwitcher } from './org-switcher';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const tSetup = useTranslations('setup.onboarding');
  const pathname = usePathname();
  const router = useRouter();
  const apiError = useApiError();
  const { data: me, error, isPending, refetch } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  let body: ReactNode;
  if (isPending) {
    body = <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  } else if (error) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {apiError(error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (!me?.tenantId && pathname === '/onboarding') {
    // creating a first organization needs no membership
    body = children;
  } else if (!me?.tenantId) {
    body = (
      <div className="max-w-prose space-y-3">
        <p className="text-sm text-muted-foreground">{t('noOrganization')}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">{tSetup('createLink')}</Link>
        </Button>
      </div>
    );
  } else {
    body = children;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-e bg-muted/30 p-4 lg:block">
        <p className="mb-6 px-3 text-lg font-bold text-primary">{t('appName')}</p>
        {me?.tenantId ? <AppNav /> : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('appName')}>
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" className="w-64 p-4">
              <p className="mb-6 px-3 text-lg font-bold text-primary">{t('appName')}</p>
              {me?.tenantId ? <AppNav onNavigate={() => setMenuOpen(false)} /> : null}
            </SheetContent>
          </Sheet>

          <OrgSwitcher />
          <div className="ms-auto flex items-center gap-2">
            {me?.tenantId ? <NotificationBell /> : null}
            <LocaleSwitcher />
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="me-2 h-4 w-4 rtl:rotate-180" aria-hidden />
              {t('signOut')}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">{body}</main>
      </div>
    </div>
  );
}
