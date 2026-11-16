'use client';

// Data hooks for purchase requisitions (contracts/rest-api.md "Purchase requisitions"): the
// list, My tasks and history (US8), the detail read model, draft create / autosave / delete, submit, the step actions (approve, reject,
// return, change budget line, reassign), cancel, attachments through Storage signed URLs and the
// print data.
import type {
  Activity,
  AttachmentUpload,
  BudgetLineListResponse,
  GrantDetail,
  AttachmentUploadTarget,
  Grant,
  ListResponse,
  MyTaskItem,
  PrActionResult,
  PrApprove,
  PrAttachmentView,
  PrCancel,
  PrChangeBudgetLine,
  PrCreate,
  PrCreated,
  PrDetail,
  PrDraftSaved,
  PrDraftUpdate,
  PrEligibleUser,
  PrHistoryEntry,
  PrListItem,
  PrPrintData,
  PrReasonAction,
  PrReassign,
  PrSubmitResult,
  PrintLocale,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/** Query-string form of the list filters (the URL search params of the list page). */
export interface PrListFilters {
  status?: string[];
  officeId?: string;
  grantId?: string;
  requesterId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
  q?: string;
  sort?: string;
  page: number;
  pageSize: number;
}

export function usePrList(filters: PrListFilters) {
  return useQuery({
    queryKey: queryKeys.prs.list({ ...filters }),
    queryFn: () => api.get<ListResponse<PrListItem>>('/prs', { query: { ...filters } }),
    placeholderData: (previous) => previous,
  });
}

export function useMyTasks() {
  return useQuery({
    queryKey: queryKeys.prs.myTasks,
    queryFn: async () => (await api.get<{ data: MyTaskItem[] }>('/prs/my-tasks')).data,
  });
}

export function usePrHistory(id: string) {
  return useQuery({
    queryKey: [...queryKeys.prs.detail(id), 'history'],
    queryFn: async () => (await api.get<{ data: PrHistoryEntry[] }>(`/prs/${id}/history`)).data,
  });
}

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

// ---------------------------------------------------------------------------------------------
// Step actions (US5)
// ---------------------------------------------------------------------------------------------

/** After a step action the PR, the lists, My tasks and budget figures may all have changed. */
function useStepAction<V>(path: (vars: V) => string, body: (vars: V) => unknown) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => api.post<PrActionResult>(path(vars), body(vars)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
    },
  });
}

export function useApprovePr(id: string) {
  return useStepAction<PrApprove>(
    () => `/prs/${id}/approve`,
    (v) => v
  );
}

export function useRejectPr(id: string) {
  return useStepAction<PrReasonAction>(
    () => `/prs/${id}/reject`,
    (v) => v
  );
}

export function useReturnPr(id: string) {
  return useStepAction<PrReasonAction>(
    () => `/prs/${id}/return`,
    (v) => v
  );
}

export function useChangeBudgetLine(id: string) {
  return useStepAction<PrChangeBudgetLine & { lineId: string }>(
    (v) => `/prs/${id}/lines/${v.lineId}/budget-line`,
    ({ lineId: _lineId, ...body }) => body
  );
}

export function useReassignStep(id: string) {
  return useStepAction<PrReassign & { stepId: string }>(
    (v) => `/prs/${id}/steps/${v.stepId}/reassign`,
    ({ stepId: _stepId, ...body }) => body
  );
}

/** Cancel (US6): the creator before approval, or a holder of pr:cancel_approved. */
export function useCancelPr(id: string) {
  return useStepAction<PrCancel>(
    () => `/prs/${id}/cancel`,
    (v) => v
  );
}

/** Users a step can be reassigned to (needs pr:reassign). */
export function useStepEligibleUsers(prId: string, stepId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.prs.detail(prId), 'eligible-users', stepId],
    enabled: Boolean(stepId),
    queryFn: async () =>
      (await api.get<{ data: PrEligibleUser[] }>(`/prs/${prId}/steps/${stepId}/eligible-users`))
        .data,
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

/** GET /prs/:id/print — PrPrintData with labels in `locale` (US7). */
export function prPrintData(prId: string, locale: PrintLocale): Promise<PrPrintData> {
  return api.get<PrPrintData>(`/prs/${prId}/print`, { query: { locale } });
}
