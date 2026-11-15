import type { ReactNode } from 'react';
import { redirect } from '@/i18n/routing';
import { AppShell } from '@/features/shell/app-shell';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/** Signed-in area: no session → login. Membership and permissions come from GET /me. */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser();
  if (!user) {
    redirect({ href: '/login', locale: params.locale });
  }
  return <AppShell>{children}</AppShell>;
}
