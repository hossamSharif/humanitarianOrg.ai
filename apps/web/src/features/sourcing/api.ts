'use client';

// RFQ hooks (002 US3, contracts/rest-api.md "RFQs and tenders").
import type {
  CreateRfqInput,
  DocHistoryEntry,
  DocAttachmentUploadTarget,
  IssueRfqInput,
  OfferReceiptInput,
  OfferScanUploadInput,
  OfferTermsInput,
  OfferTermsView,
  OpenSourcingInput,
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
import { DOC_ATTACHMENT_BUCKET } from '@ngo/shared';
import { api } from '@/lib/api-client';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
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

// --- receipts, opening, sealed terms (US4) ----------------------------------------------------

export function useLogReceipt(id: string) {
  return useRfqWrite((input: OfferReceiptInput) =>
    api.post<SourcingEventDetail>(`/rfqs/${id}/offers`, input)
  );
}

export function useOpenRfq(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenSourcingInput) =>
      api.post<SourcingEventDetail>(`/rfqs/${id}/open`, input),
    onSuccess: (event) => {
      queryClient.setQueryData(queryKeys.sourcing.detail(event.id), event);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
    },
  });
}

/** Terms and prices of every offer; empty while sealed (RLS). */
export function useOfferTerms(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sourcing.terms(id),
    queryFn: async () =>
      (await api.get<{ data: OfferTermsView[] }>(`/rfqs/${id}/offer-terms`)).data,
    enabled,
  });
}

export function useEnterTerms(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, input }: { offerId: string; input: OfferTermsInput }) =>
      api.put<OfferTermsView>(`/rfqs/${id}/offers/${offerId}/terms`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.terms(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.detail(id) });
    },
  });
}

/** Upload URL (sealed until the opening), the file to storage, then link it to the offer. */
export function useUploadOfferScan(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, file }: { offerId: string; file: File }) => {
      const body: OfferScanUploadInput = {
        fileName: file.name,
        mimeType: file.type as OfferScanUploadInput['mimeType'],
        sizeBytes: file.size,
      };
      const target = await api.post<DocAttachmentUploadTarget>(
        `/rfqs/${id}/offers/${offerId}/scan-upload-url`,
        body
      );
      const { error } = await getSupabaseBrowserClient()
        .storage.from(DOC_ATTACHMENT_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw error;
      return api.post<OfferTermsView>(
        `/rfqs/${id}/offers/${offerId}/scan/${target.attachmentId}/complete`
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.terms(id) }),
  });
}

export async function offerScanUrl(id: string, offerId: string): Promise<string> {
  return (await api.get<{ url: string }>(`/rfqs/${id}/offers/${offerId}/scan-url`)).url;
}
