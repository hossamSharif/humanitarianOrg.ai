'use client';

// Accounting setup hooks (002 US12, contracts/rest-api.md "Accounting"): chart of accounts,
// mappings, control accounts, bank accounts and cash boxes, periods.
import type {
  AccountingPeriodView,
  BudgetLineAccountView,
  BudgetLineExpenseAccountInput,
  CategoryMappingInput,
  CategoryMappingView,
  ClosePeriodInput,
  ClosePeriodResult,
  ControlAccountView,
  ControlAccountsInput,
  CreateBankAccountInput,
  CreateCashBoxInput,
  CreateGlAccountInput,
  CreatePeriodInput,
  GlAccountView,
  MoneyAccountView,
  ReopenPeriodInput,
  UpdateGlAccountInput,
  UpdateMoneyAccountInput,
} from '@ngo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

const KEY = ['accounting'] as const;

function useAccountingWrite<V, R>(fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      void queryClient.invalidateQueries({ queryKey: ['money-accounts'] });
    },
  });
}

export function useGlAccounts(filters: { type?: string; postingOnly?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEY, 'gl-accounts', filters],
    queryFn: async () =>
      (
        await api.get<{ data: GlAccountView[] }>('/gl-accounts', {
          query: {
            type: filters.type,
            postingOnly: filters.postingOnly ? 'true' : undefined,
          },
        })
      ).data,
  });
}

export function useCreateGlAccount() {
  return useAccountingWrite((input: CreateGlAccountInput) =>
    api.post<GlAccountView>('/gl-accounts', input)
  );
}

export function useUpdateGlAccount() {
  return useAccountingWrite(({ id, ...input }: UpdateGlAccountInput & { id: string }) =>
    api.patch<GlAccountView>(`/gl-accounts/${id}`, input)
  );
}

export function useDeleteGlAccount() {
  return useAccountingWrite((id: string) => api.delete<void>(`/gl-accounts/${id}`));
}

export function useCategoryMappings() {
  return useQuery({
    queryKey: [...KEY, 'category-mapping'],
    queryFn: async () =>
      (await api.get<{ data: CategoryMappingView[] }>('/gl-accounts/category-mapping')).data,
  });
}

export function useSaveCategoryMappings() {
  return useAccountingWrite((input: CategoryMappingInput) =>
    api.put<{ data: CategoryMappingView[] }>('/gl-accounts/category-mapping', input)
  );
}

export function useBudgetLineAccounts(grantId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'budget-lines', grantId],
    queryFn: async () =>
      (
        await api.get<{ data: BudgetLineAccountView[] }>('/gl-accounts/budget-lines', {
          query: { grantId },
        })
      ).data,
    enabled: !!grantId,
  });
}

export function useSetBudgetLineAccount() {
  return useAccountingWrite(
    ({ budgetLineId, ...input }: BudgetLineExpenseAccountInput & { budgetLineId: string }) =>
      api.patch<void>(`/budget-lines/${budgetLineId}/expense-account`, input)
  );
}

export function useControlAccounts() {
  return useQuery({
    queryKey: [...KEY, 'control-accounts'],
    queryFn: async () => (await api.get<{ data: ControlAccountView[] }>('/control-accounts')).data,
  });
}

export function useSaveControlAccounts() {
  return useAccountingWrite((input: ControlAccountsInput) =>
    api.put<{ data: ControlAccountView[] }>('/control-accounts', input)
  );
}

const MONEY_PATH = { bank: '/bank-accounts', cash: '/cash-boxes' } as const;

export function useMoneyAccountList(kind: 'bank' | 'cash') {
  return useQuery({
    queryKey: [...KEY, 'money', kind],
    queryFn: async () =>
      (
        await api.get<{ data: MoneyAccountView[] }>(MONEY_PATH[kind], {
          query: { includeInactive: 'true' },
        })
      ).data,
  });
}

export function useCreateMoneyAccount(kind: 'bank' | 'cash') {
  return useAccountingWrite((input: CreateBankAccountInput | CreateCashBoxInput) =>
    api.post<MoneyAccountView>(MONEY_PATH[kind], input)
  );
}

export function useUpdateMoneyAccount(kind: 'bank' | 'cash') {
  return useAccountingWrite(({ id, ...input }: UpdateMoneyAccountInput & { id: string }) =>
    api.patch<MoneyAccountView>(`${MONEY_PATH[kind]}/${id}`, input)
  );
}

export function usePeriods() {
  return useQuery({
    queryKey: [...KEY, 'periods'],
    queryFn: async () => (await api.get<{ data: AccountingPeriodView[] }>('/periods')).data,
  });
}

export function useCreatePeriod() {
  return useAccountingWrite((input: CreatePeriodInput) =>
    api.post<AccountingPeriodView>('/periods', input)
  );
}

export function useClosePeriod() {
  return useAccountingWrite(({ id, ...input }: ClosePeriodInput & { id: string }) =>
    api.post<ClosePeriodResult>(`/periods/${id}/close`, input)
  );
}

export function useReopenPeriod() {
  return useAccountingWrite(({ id, ...input }: ReopenPeriodInput & { id: string }) =>
    api.post<AccountingPeriodView>(`/periods/${id}/reopen`, input)
  );
}
