'use client';

// Supplier registry and staff payee hooks (002 US2, contracts/rest-api.md "Suppliers").
import type {
  CreateStaffPayeeInput,
  CreateSupplierInput,
  ListResponse,
  StaffPayee,
  Supplier,
  SupplierDocumentInput,
  SupplierStatusInput,
  SupplierSummary,
  SupplierVettingInput,
  UpdateStaffPayeeInput,
  UpdateSupplierInput,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface SupplierFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  categoryId?: string;
  q?: string;
  compliance?: 'eligible' | 'flagged';
}

export function useSuppliers(filters: SupplierFilters) {
  return useQuery({
    queryKey: queryKeys.suppliers.list(filters as Record<string, unknown>),
    queryFn: () =>
      api.get<ListResponse<SupplierSummary>>('/suppliers', {
        query: { ...filters, q: filters.q || undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => api.get<Supplier>(`/suppliers/${id}`),
  });
}

/** Every write returns the supplier detail; the cache is refreshed from it. */
function useSupplierWrite<V>(fn: (vars: V) => Promise<Supplier>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (supplier) => {
      queryClient.setQueryData(queryKeys.suppliers.detail(supplier.id), supplier);
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    },
  });
}

export function useSaveSupplier() {
  return useSupplierWrite(
    ({ id, input }: { id?: string; input: CreateSupplierInput | UpdateSupplierInput }) =>
      id ? api.patch<Supplier>(`/suppliers/${id}`, input) : api.post<Supplier>('/suppliers', input)
  );
}

export function useChangeSupplierStatus(id: string) {
  return useSupplierWrite((input: SupplierStatusInput) =>
    api.post<Supplier>(`/suppliers/${id}/status`, input)
  );
}

export function useAddSupplierDocument(id: string) {
  return useSupplierWrite((input: SupplierDocumentInput) =>
    api.post<Supplier>(`/suppliers/${id}/documents`, input)
  );
}

export function useAddVetting(id: string) {
  return useSupplierWrite((input: SupplierVettingInput) =>
    api.post<Supplier>(`/suppliers/${id}/vettings`, input)
  );
}

export function useStaffPayees(filters: { page?: number; q?: string }) {
  return useQuery({
    queryKey: queryKeys.staffPayees.list(filters),
    queryFn: () =>
      api.get<ListResponse<StaffPayee>>('/staff-payees', {
        query: { ...filters, pageSize: 50, q: filters.q || undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveStaffPayee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateStaffPayeeInput | UpdateStaffPayeeInput;
    }) =>
      id
        ? api.patch<StaffPayee>(`/staff-payees/${id}`, input)
        : api.post<StaffPayee>('/staff-payees', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffPayees.all }),
  });
}
