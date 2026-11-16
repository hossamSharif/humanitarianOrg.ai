'use client';

// In-app notifications (FR-048, research R16): the latest items with the unread count, polled
// every 30 s and refetched when the window regains focus; mark one or all as read.
import type { NotificationItem, NotificationList } from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const POLL_MS = 30_000;

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications.list(false),
    queryFn: () => api.get<NotificationList>('/notifications', { query: { limit: 20 } }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<NotificationItem>(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}
