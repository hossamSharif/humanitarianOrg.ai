'use client';

// TanStack Query hooks for US3: users, roles, the permission catalogue and offices.
import type {
  ListResponse,
  PermissionInfo,
  Role,
  RoleCreate,
  RoleUpdate,
  User,
  UserInviteInput,
  UserUpdate,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useCallback } from 'react';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export const usersKeys = {
  users: ['users'] as const,
  usersList: (filters: Record<string, unknown>) => ['users', 'list', filters] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  offices: ['offices', 'active'] as const,
};

/** GET /offices item (US1). */
export interface OfficeOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

/** Arabic or English field of a bilingual record, for the current locale. */
export function useBilingual() {
  const locale = useLocale();
  return useCallback(
    (value: { nameAr: string; nameEn: string }) => (locale === 'ar' ? value.nameAr : value.nameEn),
    [locale]
  );
}

export interface UsersFilter {
  page: number;
  status?: User['status'];
  q?: string;
}

export function useUsers(filter: UsersFilter) {
  return useQuery({
    queryKey: usersKeys.usersList({ ...filter }),
    queryFn: () =>
      api.get<ListResponse<User>>('/users', {
        query: { page: filter.page, pageSize: 50, status: filter.status, q: filter.q || undefined },
      }),
    placeholderData: (previous) => previous,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: usersKeys.roles,
    queryFn: () => api.get<ListResponse<Role>>('/roles', { query: { pageSize: 200 } }),
  });
}

export function usePermissionCatalogue() {
  return useQuery({
    queryKey: usersKeys.permissions,
    queryFn: () => api.get<{ data: PermissionInfo[] }>('/permissions'),
    staleTime: Infinity,
  });
}

export function useOffices() {
  return useQuery({
    queryKey: usersKeys.offices,
    queryFn: () =>
      api.get<ListResponse<OfficeOption>>('/offices', { query: { active: true, pageSize: 200 } }),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UserInviteInput) => api.post<User>('/users/invite', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, body }: { membershipId: string; body: UserUpdate }) =>
      api.patch<User>(`/users/${membershipId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.users });
      // the caller may have edited their own roles or offices
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useSaveRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: RoleCreate | RoleUpdate }) =>
      id ? api.patch<Role>(`/roles/${id}`, body) : api.post<Role>('/roles', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.roles });
      void queryClient.invalidateQueries({ queryKey: usersKeys.users });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.roles }),
  });
}
