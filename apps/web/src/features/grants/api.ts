'use client';

// Data hooks for donors, grants, budget lines, activities and exchange rates (contracts/rest-api.md
// "Donors, grants, budget lines, activities, rates"). Mutations invalidate the affected lists.
import type {
  Activity,
  ActivityCreate,
  ActivityUpdate,
  BudgetLine,
  BudgetLineCreate,
  BudgetLineListResponse,
  BudgetLineUpdate,
  Donor,
  DonorCreate,
  DonorUpdate,
  ExchangeRate,
  ExchangeRateCreate,
  ExchangeRateUpdate,
  Grant,
  GrantCreate,
  GrantDetail,
  GrantStatus,
  GrantStatusChangeResult,
  GrantUpdate,
  ListResponse,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/** Office as returned by GET /offices (organization setup, US1). */
export interface OfficeOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

const ALL = { page: 1, pageSize: 200 };

export function useOffices() {
  return useQuery({
    queryKey: ['offices', 'active'],
    queryFn: async () => {
      const res = await api.get<{ data: OfficeOption[] } | OfficeOption[]>('/offices', {
        query: { active: true, ...ALL },
      });
      return Array.isArray(res) ? res : res.data;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Donors
// ---------------------------------------------------------------------------------------------

export function useDonors(filters: { active?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.donors.list(filters),
    queryFn: () =>
      api.get<ListResponse<Donor>>('/donors', { query: { ...ALL, active: filters.active } }),
  });
}

export function useSaveDonor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: DonorCreate | DonorUpdate }) =>
      id ? api.patch<Donor>(`/donors/${id}`, body) : api.post<Donor>('/donors', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.donors.all }),
  });
}

// ---------------------------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------------------------

export interface GrantFilters {
  status?: GrantStatus;
  donorId?: string;
}

export function useGrants(filters: GrantFilters = {}) {
  return useQuery({
    queryKey: queryKeys.grants.list({ ...filters }),
    queryFn: () => api.get<ListResponse<Grant>>('/grants', { query: { ...ALL, ...filters } }),
  });
}

export function useGrant(id: string) {
  return useQuery({
    queryKey: queryKeys.grants.detail(id),
    queryFn: () => api.get<GrantDetail>(`/grants/${id}`),
  });
}

export function useSaveGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: GrantCreate | GrantUpdate }) =>
      id ? api.patch<Grant>(`/grants/${id}`, body) : api.post<Grant>('/grants', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.grants.all }),
  });
}

export function useChangeGrantStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      status: GrantStatus;
      expectedVersion: number;
      confirmPendingCount?: number;
    }) => api.post<GrantStatusChangeResult>(`/grants/${id}/status`, body),
    onSuccess: (result) => {
      if (!result.requiresConfirmation) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Budget lines and activities
// ---------------------------------------------------------------------------------------------

export function useBudgetLines(grantId: string) {
  return useQuery({
    queryKey: queryKeys.grants.budgetLines(grantId),
    queryFn: () => api.get<BudgetLineListResponse>(`/grants/${grantId}/budget-lines`),
  });
}

export function useSaveBudgetLine(grantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: BudgetLineCreate | BudgetLineUpdate }) =>
      id
        ? api.patch<BudgetLine>(`/budget-lines/${id}`, body)
        : api.post<BudgetLine>(`/grants/${grantId}/budget-lines`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.budgetLines(grantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.detail(grantId) });
    },
  });
}

export function useActivities(grantId: string) {
  return useQuery({
    queryKey: queryKeys.grants.activities(grantId),
    queryFn: async () =>
      (await api.get<{ data: Activity[] }>(`/grants/${grantId}/activities`)).data,
  });
}

export function useSaveActivity(grantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ActivityCreate | ActivityUpdate }) =>
      id
        ? api.patch<Activity>(`/activities/${id}`, body)
        : api.post<Activity>(`/grants/${grantId}/activities`, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.grants.activities(grantId) }),
  });
}

// ---------------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------------

export function useRates(filters: { currency?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.rates.list(filters),
    queryFn: () =>
      api.get<ListResponse<ExchangeRate>>('/exchange-rates', {
        query: { ...ALL, currency: filters.currency },
      }),
  });
}

export function useSaveRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ExchangeRateCreate | ExchangeRateUpdate }) =>
      id
        ? api.patch<ExchangeRate>(`/exchange-rates/${id}`, body)
        : api.post<ExchangeRate>('/exchange-rates', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rates.all }),
  });
}

export function useDeleteRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/exchange-rates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rates.all }),
  });
}
