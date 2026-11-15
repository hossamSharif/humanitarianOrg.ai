'use client';

import type {
  ApprovalRule,
  ApprovalRuleBodyInput,
  ApprovalRuleResolve,
  ResolvedRoute,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export const approvalRulesKeys = {
  all: ['approval-rules'] as const,
};

export function useApprovalRules() {
  return useQuery({
    queryKey: approvalRulesKeys.all,
    queryFn: () =>
      api.get<{ data: ApprovalRule[] }>('/approval-rules', { query: { docType: 'PR' } }),
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
    mutationFn: (body: ApprovalRuleResolve) =>
      api.post<ResolvedRoute>('/approval-rules/resolve', body),
  });
}
