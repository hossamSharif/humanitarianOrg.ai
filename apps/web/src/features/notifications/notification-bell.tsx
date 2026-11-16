'use client';

import { formatDateTime, type NotificationItem } from '@ngo/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@ngo/ui';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTenantTimeZone } from '@/features/setup/api';
import { useRouter } from '@/i18n/routing';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from './api';

/** Header bell: unread badge, latest notifications rendered from `kind` + `params` via i18n. */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const tKind = useTranslations('pr.steps.kind');
  const router = useRouter();
  const timeZone = useTenantTimeZone();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = data?.unreadCount ?? 0;

  const message = (n: NotificationItem) =>
    t(`kinds.${n.kind}`, {
      number: n.params.number ?? '—',
      step: n.params.stepKind ? tKind(n.params.stepKind) : '',
      actor: n.params.actorName ?? '',
    });

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    router.push(`/prs/${n.prId}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? t('bellUnread', { count: unread }) : t('title')}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 ? (
            <span
              dir="ltr"
              className="absolute -end-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-destructive-foreground tabular-nums"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuLabel className="p-0">{t('title')}</DropdownMenuLabel>
          {unread > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={markAll.isPending}
              onClick={(e) => {
                e.preventDefault();
                markAll.mutate();
              }}
            >
              {t('markAllRead')}
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {(data?.data ?? []).length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {data!.data.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => open(n)}
                className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
              >
                <span className={cn('text-sm', !n.readAt && 'font-semibold')}>
                  {!n.readAt ? (
                    <span
                      className="me-1.5 inline-block h-2 w-2 rounded-full bg-primary"
                      aria-hidden
                    />
                  ) : null}
                  {message(n)}
                </span>
                <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(n.createdAt, timeZone)}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
