'use client';

// Quotation analysis hooks (002 US5, contracts/rest-api.md "Analysis and award"). The shared
// document actions (submit, approve, …) come from features/documents with slug `bid-analyses`.
import type {
  AnalysisSignInput,
  BidAnalysisDetail,
  BidAnalysisSummary,
  CommitteeInput,
  CreateAnalysisInput,
  DeclarationInput,
  DisqualifyInput,
  ListResponse,
  NoticesInput,
  RecommendationInput,
  ScoresInput,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const SLUG = 'bid-analyses';

export function useAnalyses(filters: { page?: number; status?: string }) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<BidAnalysisSummary>>('/bid-analyses', {
        query: { ...filters, pageSize: 50 },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalysis(id: string) {
  return useQuery({
    queryKey: queryKeys.docs.detail(SLUG, id),
    queryFn: () => api.get<BidAnalysisDetail>(`/bid-analyses/${id}`),
  });
}

/** Every write returns the detail; the cache is refreshed from it. */
function useAnalysisWrite<V>(fn: (vars: V) => Promise<BidAnalysisDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (analysis) => {
      queryClient.setQueryData(queryKeys.docs.detail(SLUG, analysis.id), analysis);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
    },
  });
}

export function useCreateAnalysis() {
  return useAnalysisWrite((input: CreateAnalysisInput) =>
    api.post<BidAnalysisDetail>('/bid-analyses', input)
  );
}

export function useSetCommittee(id: string) {
  return useAnalysisWrite((input: CommitteeInput) =>
    api.put<BidAnalysisDetail>(`/bid-analyses/${id}/committee`, input)
  );
}

export function useDeclare(id: string) {
  return useAnalysisWrite((input: DeclarationInput) =>
    api.post<BidAnalysisDetail>(`/bid-analyses/${id}/declaration`, input)
  );
}

export function usePutScores(id: string) {
  return useAnalysisWrite((input: ScoresInput) =>
    api.put<BidAnalysisDetail>(`/bid-analyses/${id}/scores`, input)
  );
}

export function useDisqualify(id: string) {
  return useAnalysisWrite((input: DisqualifyInput) =>
    api.post<BidAnalysisDetail>(`/bid-analyses/${id}/disqualify`, input)
  );
}

export function useRecommend(id: string) {
  return useAnalysisWrite((input: RecommendationInput) =>
    api.put<BidAnalysisDetail>(`/bid-analyses/${id}/recommendation`, input)
  );
}

export function useSignAnalysis(id: string) {
  return useAnalysisWrite((input: AnalysisSignInput) =>
    api.post<BidAnalysisDetail>(`/bid-analyses/${id}/sign`, input)
  );
}

export function useRecordNotices(id: string) {
  return useAnalysisWrite((input: NoticesInput) =>
    api.post<BidAnalysisDetail>(`/bid-analyses/${id}/notices`, input)
  );
}
