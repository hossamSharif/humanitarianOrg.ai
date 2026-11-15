'use client';

import type { Permission } from '@ngo/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './api-client';
import { queryKeys } from './query-keys';
import { getSupabaseBrowserClient } from './supabase/client';

// Mirrors MeResponse in apps/api/src/services/session.service.ts.
export interface Me {
  user: { id: string; email: string | null };
  tenantId: string | null;
  membership: {
    id: string;
    fullNameAr: string;
    fullNameEn: string;
    positionTitle: string | null;
    email: string;
  } | null;
  memberships: {
    membershipId: string;
    tenantId: string;
    tenantNameAr: string;
    tenantNameEn: string;
    status: 'invited' | 'active';
  }[];
  permissions: Permission[];
  offices: { id: string; code: string; nameAr: string; nameEn: string; isActive: boolean }[];
  orgWideAccess: boolean;
  sessionRefreshRequired: boolean;
}

/** GET /me. When the API changed the active organization, refresh the token and refetch. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await api.get<Me>('/me');
      if (!me.sessionRefreshRequired) return me;
      await getSupabaseBrowserClient().auth.refreshSession();
      return api.get<Me>('/me');
    },
  });
}

export function useHasPermission() {
  const { data } = useMe();
  return useCallback(
    (...codes: Permission[]) => codes.some((c) => data?.permissions.includes(c) ?? false),
    [data]
  );
}

/** Switch the active organization: server sets the claim, the client refreshes, caches reset. */
export function useSwitchTenant() {
  const queryClient = useQueryClient();
  return useCallback(
    async (tenantId: string) => {
      await api.post('/session/tenant', { tenantId });
      await getSupabaseBrowserClient().auth.refreshSession();
      queryClient.clear();
    },
    [queryClient]
  );
}
