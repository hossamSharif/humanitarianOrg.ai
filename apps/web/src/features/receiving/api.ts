'use client';

// Goods received note hooks (002 US7, contracts/rest-api.md "Receipt").
import type {
  CreateGrnInput,
  GrnCancelInput,
  GrnDetail,
  GrnReturnInput,
  GrnSignInput,
  GrnSummary,
  ListResponse,
  PoRatingInput,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PO_SLUG } from '@/features/orders/api';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const SLUG = 'grns';

export function useGrns(filters: { page?: number; status?: string; poId?: string }) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<GrnSummary>>('/grns', { query: { ...filters, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
}

export function useGrn(id: string) {
  return useQuery({
    queryKey: queryKeys.docs.detail(SLUG, id),
    queryFn: () => api.get<GrnDetail>(`/grns/${id}`),
  });
}

/** Every write returns the detail; the GRN and its PO are refreshed. */
function useGrnWrite<V>(fn: (vars: V) => Promise<GrnDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (grn) => {
      queryClient.setQueryData(queryKeys.docs.detail(SLUG, grn.id), grn);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PO_SLUG) });
    },
  });
}

export function useCreateGrn(poId: string) {
  return useGrnWrite((input: CreateGrnInput) => api.post<GrnDetail>(`/pos/${poId}/grns`, input));
}

export function useSignGrn(id: string) {
  return useGrnWrite((input: GrnSignInput) => api.post<GrnDetail>(`/grns/${id}/sign`, input));
}

export function useReturnGrnLine(id: string) {
  return useGrnWrite(({ lineId, ...input }: GrnReturnInput & { lineId: string }) =>
    api.post<GrnDetail>(`/grns/${id}/lines/${lineId}/return`, input)
  );
}

export function useCancelGrn(id: string) {
  return useGrnWrite((input: GrnCancelInput) => api.post<GrnDetail>(`/grns/${id}/cancel`, input));
}

export function useRatePo(poId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PoRatingInput) => api.post<void>(`/pos/${poId}/rating`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PO_SLUG) }),
  });
}
