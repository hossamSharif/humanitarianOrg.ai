'use client';

import { useTranslations } from 'next-intl';
import { MyTasksList } from '@/features/pr/my-tasks-list';

export default function MyTasksPage() {
  const t = useTranslations('myTasks');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <MyTasksList />
    </div>
  );
}
