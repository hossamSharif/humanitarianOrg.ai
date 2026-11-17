'use client';

// RFQ hooks (002 US3, contracts/rest-api.md "RFQs and tenders").
import type {
  CreateRfqInput,
  DocHistoryEntry,
  IssueRfqInput,
  ListResponse,
  PrintLocale,
  RfqPrintData,
  SourceablePrLine,
  SourcingEventDetail,
  SourcingEventSummary,
  SourcingReasonInput,
  UpdateRfqInput,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface RfqFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  grantId?: string;
  q?: string;
}

export function useRfqs(filters: RfqFilters) {
  return useQuery({
    queryKey: queryKeys.sourcing.list('rfq', filters as Record<string, unknown>),
    queryFn: () =>
      api.get<ListResponse<SourcingEventSummary>>('/rfqs', {
        query: { ...filters, q: filters.q || undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useRfq(id: string) {
  return useQuery({
    queryKey: queryKeys.sourcing.detail(id),
    queryFn: () => api.get<SourcingEventDetail>(`/rfqs/${id}`),
  });
}

export function useRfqHistory(id: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.detail(id), 'history'],
    queryFn: async () => (await api.get<{ data: DocHistoryEntry[] }>(`/rfqs/${id}/history`)).data,
  });
}

export function useSourceablePrLines(filters: { grantId?: string; q?: string }) {
  return useQuery({
    queryKey: queryKeys.sourcing.prLines(filters),
    queryFn: () =>
      api.get<{ data: SourceablePrLine[] }>('/sourcing/pr-lines', {
        query: { ...filters, q: filters.q || undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

/** Every write returns the event detail; the cache is refreshed from it. */
function useRfqWrite<V>(fn: (vars: V) => Promise<SourcingEventDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (event) => {
      queryClient.setQueryData(queryKeys.sourcing.detail(event.id), event);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
      // PR lines and PR statuses move with sourcing (FR-038)
      void queryClient.invalidateQueries({ queryKey: queryKeys.prs.all });
    },
  });
}

export function useCreateRfq() {
  return useRfqWrite((input: CreateRfqInput) => api.post<SourcingEventDetail>('/rfqs', input));
}

export function useUpdateRfq(id: string) {
  return useRfqWrite((input: UpdateRfqInput) =>
    api.patch<SourcingEventDetail>(`/rfqs/${id}`, input)
  );
}

export function useIssueRfq(id: string) {
  return useRfqWrite((input: IssueRfqInput) =>
    api.post<SourcingEventDetail>(`/rfqs/${id}/issue`, input)
  );
}

export function useCancelRfq(id: string) {
  return useRfqWrite((input: SourcingReasonInput) =>
    api.post<SourcingEventDetail>(`/rfqs/${id}/cancel`, input)
  );
}

/** Returns the new draft (linked by reissuedFromId). */
export function useReissueRfq(id: string) {
  return useRfqWrite((input: SourcingReasonInput) =>
    api.post<SourcingEventDetail>(`/rfqs/${id}/reissue`, input)
  );
}

export function rfqPrintData(id: string, supplierId: string, locale: PrintLocale) {
  return api.get<RfqPrintData>(`/rfqs/${id}/print`, { query: { supplierId, locale } });
}
