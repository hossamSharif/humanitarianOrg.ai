'use client';

// Data hooks for the shared actions of every 002 document (contracts/rest-api.md "Shared
// document actions"), keyed by the document's route slug: submit, approve, reject, return,
// cancel, reassign, history and attachments through Storage signed URLs. PRs keep their own
// hooks in features/pr/api.ts (001 routes).
import {
  DOC_ATTACHMENT_BUCKET,
  type DocActionResult,
  type DocApprove,
  type DocAttachmentUpload,
  type DocAttachmentUploadTarget,
  type DocAttachmentView,
  type DocCancel,
  type DocHistoryEntry,
  type DocReasonAction,
  type DocReassign,
  type DocTypeSlug,
  type PrEligibleUser,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/** After any document action its detail, its lists, My tasks and budget figures may change. */
function useInvalidate(slug: DocTypeSlug) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(slug) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.prs.myTasks });
    void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
  };
}

function useDocMutation<V>(
  slug: DocTypeSlug,
  path: (vars: V) => string,
  body: (vars: V) => unknown
) {
  const invalidate = useInvalidate(slug);
  return useMutation({
    mutationFn: (vars: V) => api.post<DocActionResult>(path(vars), body(vars)),
    onSuccess: invalidate,
  });
}

export function useSubmitDoc(slug: DocTypeSlug, id: string) {
  return useDocMutation<number>(
    slug,
    () => `/${slug}/${id}/submit`,
    (expectedVersion) => ({ expectedVersion })
  );
}

export function useApproveDoc(slug: DocTypeSlug, id: string) {
  return useDocMutation<DocApprove>(
    slug,
    () => `/${slug}/${id}/approve`,
    (v) => v
  );
}

export function useRejectDoc(slug: DocTypeSlug, id: string) {
  return useDocMutation<DocReasonAction>(
    slug,
    () => `/${slug}/${id}/reject`,
    (v) => v
  );
}

export function useReturnDoc(slug: DocTypeSlug, id: string) {
  return useDocMutation<DocReasonAction>(
    slug,
    () => `/${slug}/${id}/return`,
    (v) => v
  );
}

export function useCancelDoc(slug: DocTypeSlug, id: string) {
  return useDocMutation<DocCancel>(
    slug,
    () => `/${slug}/${id}/cancel`,
    (v) => v
  );
}

export function useReassignDocStep(slug: DocTypeSlug, id: string) {
  return useDocMutation<DocReassign & { stepId: string }>(
    slug,
    (v) => `/${slug}/${id}/steps/${v.stepId}/reassign`,
    ({ stepId: _stepId, ...body }) => body
  );
}

/** Users an open step can be reassigned to. */
export function useDocStepEligibleUsers(slug: DocTypeSlug, id: string, stepId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.docs.detail(slug, id), 'eligible-users', stepId],
    enabled: Boolean(stepId),
    queryFn: async () =>
      (await api.get<{ data: PrEligibleUser[] }>(`/${slug}/${id}/steps/${stepId}/eligible-users`))
        .data,
  });
}

export function useDocHistory(slug: DocTypeSlug, id: string) {
  return useQuery({
    queryKey: [...queryKeys.docs.detail(slug, id), 'history'],
    queryFn: async () =>
      (await api.get<{ data: DocHistoryEntry[] }>(`/${slug}/${id}/history`)).data,
  });
}

// ---------------------------------------------------------------------------------------------
// Attachments (research R31)
// ---------------------------------------------------------------------------------------------

export function useDocAttachments(slug: DocTypeSlug, id: string) {
  return useQuery({
    queryKey: [...queryKeys.docs.detail(slug, id), 'attachments'],
    queryFn: async () =>
      (await api.get<{ data: DocAttachmentView[] }>(`/${slug}/${id}/attachments`)).data,
  });
}

export function useUploadDocAttachment(slug: DocTypeSlug, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      purpose,
    }: {
      file: File;
      purpose?: DocAttachmentUpload['purpose'];
    }) => {
      const body: DocAttachmentUpload = {
        fileName: file.name,
        mimeType: file.type as DocAttachmentUpload['mimeType'],
        sizeBytes: file.size,
        ...(purpose ? { purpose } : {}),
      };
      const target = await api.post<DocAttachmentUploadTarget>(
        `/${slug}/${id}/attachments/upload-url`,
        body
      );
      const { error } = await getSupabaseBrowserClient()
        .storage.from(DOC_ATTACHMENT_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw error;
      return api.post<DocAttachmentView>(
        `/${slug}/${id}/attachments/${target.attachmentId}/complete`
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.docs.detail(slug, id) }),
  });
}

export function useRemoveDocAttachment(slug: DocTypeSlug, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete<void>(`/${slug}/${id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.docs.detail(slug, id) }),
  });
}

export async function docAttachmentDownloadUrl(
  slug: DocTypeSlug,
  id: string,
  attachmentId: string
): Promise<string> {
  return (await api.get<{ url: string }>(`/${slug}/${id}/attachments/${attachmentId}/url`)).url;
}
