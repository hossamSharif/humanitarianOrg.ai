'use client';

// Data hooks for purchase requisitions (contracts/rest-api.md "Purchase requisitions"): the
// detail read model, draft create / autosave / delete, submit, and attachments through Storage
// signed URLs.
import type {
  Activity,
  AttachmentUpload,
  BudgetLineListResponse,
  GrantDetail,
  AttachmentUploadTarget,
  Grant,
  ListResponse,
  PrAttachmentView,
  PrCreate,
  PrCreated,
  PrDetail,
  PrDraftSaved,
  PrDraftUpdate,
  PrSubmitResult,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function usePr(id: string) {
  return useQuery({
    queryKey: queryKeys.prs.detail(id),
    queryFn: () => api.get<PrDetail>(`/prs/${id}`),
  });
}

export function useCreatePr() {
  return useMutation({
    mutationFn: (body: PrCreate) => api.post<PrCreated>('/prs', body),
  });
}

/** Autosave; the caller keeps the version, so the detail query is not refetched per save. */
export function useSavePrDraft(id: string) {
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: PrDraftUpdate; idempotencyKey?: string }) =>
      api.patch<PrDraftSaved>(`/prs/${id}`, body, { idempotencyKey }),
  });
}

export function useDeletePr(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/prs/${id}`),
    onSuccess: () => queryClient.removeQueries({ queryKey: queryKeys.prs.detail(id) }),
  });
}

export function useSubmitPr(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expectedVersion: number) =>
      api.post<PrSubmitResult>(`/prs/${id}/submit`, { expectedVersion }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
    },
  });
}

/** Grants a PR dated `prDate` from `officeId` may charge (active, period, office; FR-022). */
export function useSelectableGrants(prDate: string | null, officeId: string | null) {
  return useQuery({
    queryKey: queryKeys.grants.list({ selectableFor: 'pr', prDate, officeId }),
    enabled: Boolean(prDate && officeId),
    queryFn: () =>
      api.get<ListResponse<Grant>>('/grants', {
        query: { selectableFor: 'pr', prDate, officeId, page: 1, pageSize: 200 },
      }),
  });
}

export function usePrGrant(grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.grants.detail(grantId ?? ''),
    enabled: Boolean(grantId),
    queryFn: () => api.get<GrantDetail>(`/grants/${grantId}`),
  });
}

/** Budget lines of the chosen grant with Available (any member may read them). */
export function useGrantBudgetLines(grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.grants.budgetLines(grantId ?? ''),
    enabled: Boolean(grantId),
    queryFn: () => api.get<BudgetLineListResponse>(`/grants/${grantId}/budget-lines`),
  });
}

export function useGrantActivities(grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.grants.activities(grantId ?? ''),
    enabled: Boolean(grantId),
    queryFn: async () =>
      (await api.get<{ data: Activity[] }>(`/grants/${grantId}/activities`)).data,
  });
}

// ---------------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------------

/** upload-url → PUT to Storage → complete; the PR detail is refetched afterwards. */
export function useUploadAttachment(prId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body: AttachmentUpload = {
        fileName: file.name,
        mimeType: file.type as AttachmentUpload['mimeType'],
        sizeBytes: file.size,
      };
      const target = await api.post<AttachmentUploadTarget>(
        `/prs/${prId}/attachments/upload-url`,
        body
      );
      const { error } = await getSupabaseBrowserClient()
        .storage.from('pr-attachments')
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw error;
      return api.post<PrAttachmentView>(`/prs/${prId}/attachments/${target.attachmentId}/complete`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prs.detail(prId) }),
  });
}

export function useRemoveAttachment(prId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete<void>(`/prs/${prId}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prs.detail(prId) }),
  });
}

export async function attachmentDownloadUrl(prId: string, attachmentId: string): Promise<string> {
  return (await api.get<{ url: string }>(`/prs/${prId}/attachments/${attachmentId}/url`)).url;
}
