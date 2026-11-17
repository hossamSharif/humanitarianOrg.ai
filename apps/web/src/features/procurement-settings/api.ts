'use client';

// Procurement configuration hooks (002 US1, contracts/rest-api.md "Procurement configuration").
import type {
  CreateDeductionTypeInput,
  CreatePaymentCategoryInput,
  CreateSupplierCategoryInput,
  DeductionType,
  MethodBandSet,
  MethodBandsInput,
  PaymentCategory,
  ProcurementSettings,
  ProcurementSettingsInput,
  SupplierCategory,
  UpdateDeductionTypeInput,
  UpdatePaymentCategoryInput,
  UpdateSupplierCategoryInput,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const keys = queryKeys.procurement;

export function useProcurementSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<ProcurementSettings>('/procurement-settings'),
  });
}

export function useSaveProcurementSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcurementSettingsInput) =>
      api.put<ProcurementSettings>('/procurement-settings', input),
    onSuccess: (saved) => queryClient.setQueryData(keys.settings, saved),
  });
}

/** The tenant's bands, or the grant's stricter bands when `grantId` is given. */
export function useMethodBands(grantId?: string) {
  return useQuery({
    queryKey: keys.bands(grantId ?? null),
    queryFn: () =>
      api.get<MethodBandSet>(
        grantId ? `/grants/${grantId}/procurement-rules` : '/procurement-settings/method-bands'
      ),
  });
}

export function useSaveMethodBands(grantId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MethodBandsInput) =>
      api.put<MethodBandSet>(
        grantId ? `/grants/${grantId}/procurement-rules` : '/procurement-settings/method-bands',
        input
      ),
    onSuccess: (saved) => queryClient.setQueryData(keys.bands(grantId ?? null), saved),
  });
}

export function useDeductionTypes() {
  return useQuery({
    queryKey: keys.deductions,
    queryFn: () => api.get<{ data: DeductionType[] }>('/deduction-types'),
  });
}

export function useSaveDeductionType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateDeductionTypeInput | UpdateDeductionTypeInput;
    }) =>
      id
        ? api.patch<DeductionType>(`/deduction-types/${id}`, input)
        : api.post<DeductionType>('/deduction-types', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.deductions }),
  });
}

export type CategoryKind = 'payment' | 'supplier';

const categoryPath = (kind: CategoryKind) =>
  kind === 'payment' ? '/payment-categories' : '/supplier-categories';

export function useCategories<K extends CategoryKind>(kind: K) {
  return useQuery({
    queryKey: keys.categories(kind),
    queryFn: () =>
      api.get<{ data: K extends 'payment' ? PaymentCategory[] : SupplierCategory[] }>(
        categoryPath(kind)
      ),
  });
}

export function useSaveCategory(kind: CategoryKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input:
        | CreatePaymentCategoryInput
        | UpdatePaymentCategoryInput
        | CreateSupplierCategoryInput
        | UpdateSupplierCategoryInput;
    }) =>
      id
        ? api.patch<PaymentCategory | SupplierCategory>(`${categoryPath(kind)}/${id}`, input)
        : api.post<PaymentCategory | SupplierCategory>(categoryPath(kind), input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.categories(kind) }),
  });
}
