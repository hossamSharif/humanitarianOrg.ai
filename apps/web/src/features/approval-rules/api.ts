'use client';

import type {
  ApprovalRule,
  ApprovalRuleBodyInput,
  ApprovalRuleResolveInput,
  DoaType,
  ResolvedRoute,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export const approvalRulesKeys = {
  all: ['approval-rules'] as const,
};

export function useApprovalRules(docType: DoaType = 'PR') {
  return useQuery({
    queryKey: [...approvalRulesKeys.all, docType],
    queryFn: () => api.get<{ data: ApprovalRule[] }>('/approval-rules', { query: { docType } }),
  });
}

export function useSaveApprovalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ApprovalRuleBodyInput }) =>
      id
        ? api.put<ApprovalRule>(`/approval-rules/${id}`, body)
        : api.post<ApprovalRule>('/approval-rules', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: approvalRulesKeys.all }),
  });
}

export function useResolveRoute() {
  return useMutation({
    mutationFn: (body: ApprovalRuleResolveInput) =>
      api.post<ResolvedRoute>('/approval-rules/resolve', body),
  });
}
