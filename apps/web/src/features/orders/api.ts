'use client';

// Purchase order hooks (002 US6, contracts/rest-api.md "POs, contracts, amendments"). The shared
// document actions (submit, approve, …) come from features/documents with slug `pos` /
// `contracts`.
import type {
  CreatePosInput,
  ListResponse,
  PoAcknowledgeInput,
  PoCloseInput,
  PoPatchInput,
  PurchaseOrderDetail,
  PurchaseOrderSummary,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export const PO_SLUG = 'pos';

export const poSlug = (po: Pick<PurchaseOrderSummary, 'kind'>) =>
  po.kind === 'contract' ? 'contracts' : 'pos';

export function usePurchaseOrders(filters: {
  page?: number;
  status?: string;
  kind?: string;
  bidAnalysisId?: string;
  receivable?: boolean;
}) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(PO_SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<PurchaseOrderSummary>>('/pos', {
        query: {
          ...filters,
          receivable: filters.receivable === undefined ? undefined : String(filters.receivable),
          pageSize: 50,
        },
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.docs.detail(PO_SLUG, id),
    queryFn: () => api.get<PurchaseOrderDetail>(`/pos/${id}`),
  });
}

/** Every write returns the detail; the cache is refreshed from it. */
function usePoWrite<V>(fn: (vars: V) => Promise<PurchaseOrderDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (po) => {
      queryClient.setQueryData(queryKeys.docs.detail(PO_SLUG, po.id), po);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PO_SLUG) });
    },
  });
}

export function useCreatePos(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePosInput) =>
      api.post<{ data: PurchaseOrderSummary[] }>(`/bid-analyses/${analysisId}/pos`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PO_SLUG) }),
  });
}

export function usePatchPo(id: string) {
  return usePoWrite((input: PoPatchInput) => api.patch<PurchaseOrderDetail>(`/pos/${id}`, input));
}

export function useAcknowledgePo(id: string) {
  return usePoWrite((input: PoAcknowledgeInput) =>
    api.post<PurchaseOrderDetail>(`/pos/${id}/acknowledge`, input)
  );
}

export function useClosePo(id: string) {
  return usePoWrite((input: PoCloseInput) =>
    api.post<PurchaseOrderDetail>(`/pos/${id}/close`, input)
  );
}
