'use client';

// US1 data hooks: organization profile, offices, units and numbering (contracts/rest-api.md
// "Session & organization", "Offices, units, numbering").
import type {
  CreatedTenant,
  CreateOfficeInput,
  CreateTenantInput,
  CreateUnitInput,
  FieldError,
  ListResponse,
  LogoUploadUrl,
  NumberingConfigInput,
  NumberingConfigResponse,
  Office,
  TenantProfile,
  UnitOfMeasure,
  UpdateOfficeInput,
  UpdateTenantInput,
  UpdateUnitInput,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ZodError } from 'zod';
import { api, ApiRequestError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/** Offices and units are small per organization; one page holds them all. */
const ALL = { page: 1, pageSize: 200 };

export function useTenantProfile() {
  return useQuery({
    queryKey: queryKeys.setup.tenant,
    queryFn: () => api.get<TenantProfile>('/tenant'),
  });
}

/** The organization's timezone for DD/MM/YYYY HH:mm display (research R15). */
export function useTenantTimeZone(): string {
  return useTenantProfile().data?.timezone ?? 'Africa/Khartoum';
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) => api.patch<TenantProfile>('/tenant', input),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.setup.tenant, profile);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** Signed upload to org-assets, then PATCH /tenant with the new versioned path. */
export function useUploadLogo() {
  const update = useUpdateTenant();
  return useMutation({
    mutationFn: async (file: File) => {
      const target = await api.post<LogoUploadUrl>('/tenant/logo-upload-url', {
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const { error } = await getSupabaseBrowserClient()
        .storage.from('org-assets')
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw new ApiRequestError(0, 'NETWORK_ERROR', error.message);
      return update.mutateAsync({ logoPath: target.path });
    },
  });
}

/** POST /tenants; the active organization changes, so the session is refreshed and caches reset. */
export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTenantInput) => {
      const created = await api.post<CreatedTenant>('/tenants', input);
      await getSupabaseBrowserClient().auth.refreshSession();
      return created;
    },
    onSuccess: () => queryClient.clear(),
  });
}

export function useOffices() {
  return useQuery({
    queryKey: queryKeys.setup.offices,
    queryFn: () => api.get<ListResponse<Office>>('/offices', { query: ALL }),
  });
}

export function useSaveOffice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateOfficeInput | UpdateOfficeInput }) =>
      id ? api.patch<Office>(`/offices/${id}`, input) : api.post<Office>('/offices', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.setup.offices });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useUnits() {
  return useQuery({
    queryKey: queryKeys.setup.units,
    queryFn: () => api.get<ListResponse<UnitOfMeasure>>('/units', { query: ALL }),
  });
}

export function useSaveUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateUnitInput | UpdateUnitInput }) =>
      id
        ? api.patch<UnitOfMeasure>(`/units/${id}`, input)
        : api.post<UnitOfMeasure>('/units', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.setup.units }),
  });
}

export function useNumbering(docType = 'PR') {
  return useQuery({
    queryKey: queryKeys.setup.numbering(docType),
    queryFn: () => api.get<NumberingConfigResponse>(`/numbering/${docType}`),
    // switching the document type keeps the page (and its type selector) on screen
    placeholderData: keepPreviousData,
  });
}

export function useSaveNumbering(docType = 'PR') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NumberingConfigInput) =>
      api.put<NumberingConfigResponse>(`/numbering/${docType}`, input),
    onSuccess: (config) => queryClient.setQueryData(queryKeys.setup.numbering(docType), config),
  });
}

export type FieldErrors = Record<string, string>;

/** Field → server message code from a 400 VALIDATION_ERROR (first error per field). */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_ERROR') return {};
  const details = Array.isArray(error.details) ? (error.details as FieldError[]) : [];
  const out: FieldErrors = {};
  for (const d of details) out[d.field] ??= d.message;
  return out;
}

/** Field → 'invalid' for a failed client-side parse with a shared schema. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    out[field] ??= issue.message;
  }
  return out;
}
