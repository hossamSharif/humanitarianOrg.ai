'use client';

import { useTranslations } from 'next-intl';
import { InviteUserDialog } from '@/features/users/invite-user-dialog';
import { UsersTable } from '@/features/users/users-table';

export default function UsersPage() {
  const t = useTranslations('users');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <InviteUserDialog />
      </div>
      <UsersTable />
    </div>
  );
}
