'use client';

// Voucher hooks (002 US13, contracts/rest-api.md "Accounting"). Submit, approve, return and
// cancel are the shared document actions (slug `vouchers`); check, post and reverse are here.
import type {
  GenerateVoucherInput,
  ListResponse,
  VoucherCheckInput,
  VoucherDetail,
  VoucherPostInput,
  VoucherReverseInput,
  VoucherSummary,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_SLUG } from '@/features/payments/api';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export const VOUCHER_SLUG = 'vouchers';

export function useVouchers(filters: { page?: number; status?: string; type?: string }) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(VOUCHER_SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<VoucherSummary>>('/vouchers', { query: { ...filters, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
}

export function useVoucher(id: string) {
  return useQuery({
    queryKey: queryKeys.docs.detail(VOUCHER_SLUG, id),
    queryFn: () => api.get<VoucherDetail>(`/vouchers/${id}`),
  });
}

/** Every write returns a voucher detail; vouchers, payment requests and budgets refresh. */
function useVoucherWrite<V>(fn: (vars: V) => Promise<VoucherDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (voucher) => {
      queryClient.setQueryData(queryKeys.docs.detail(VOUCHER_SLUG, voucher.id), voucher);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(VOUCHER_SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PAYMENT_SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
    },
  });
}

export function useGenerateVoucher(paymentRequestId: string) {
  return useVoucherWrite((input: GenerateVoucherInput) =>
    api.post<VoucherDetail>(`/payment-requests/${paymentRequestId}/voucher`, input)
  );
}

export function useCheckVoucher(id: string) {
  return useVoucherWrite((input: VoucherCheckInput) =>
    api.post<VoucherDetail>(`/vouchers/${id}/check`, input)
  );
}

export function usePostVoucher(id: string) {
  return useVoucherWrite((input: VoucherPostInput) =>
    api.post<VoucherDetail>(`/vouchers/${id}/post`, input)
  );
}

export function useReverseVoucher(id: string) {
  return useVoucherWrite((input: VoucherReverseInput) =>
    api.post<VoucherDetail>(`/vouchers/${id}/reverse`, input)
  );
}
