'use client';

// Supplier invoice, payment request and money account hooks (002 US11, contracts/rest-api.md
// "Invoices and payment requests"). The shared document actions (submit, approve, …) come from
// features/documents with slug `payment-requests`.
import type {
  CreateInvoiceInput,
  CreateOrderPaymentInput,
  ListResponse,
  MatchOverrideInput,
  MoneyAccountView,
  PaymentPatchInput,
  PaymentRequestDetail,
  PaymentRequestSummary,
  SupplierInvoiceDetail,
  SupplierInvoiceSummary,
} from '@ngo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PO_SLUG } from '@/features/orders/api';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export const INVOICE_SLUG = 'invoices';
export const PAYMENT_SLUG = 'payment-requests';

export function useInvoices(filters: { page?: number; status?: string; poId?: string }) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(INVOICE_SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<SupplierInvoiceSummary>>('/invoices', {
        query: { ...filters, pageSize: 50 },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.docs.detail(INVOICE_SLUG, id ?? ''),
    queryFn: () => api.get<SupplierInvoiceDetail>(`/invoices/${id}`),
    enabled: !!id,
  });
}

export function useRegisterInvoice(poId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      api.post<SupplierInvoiceDetail>(`/pos/${poId}/invoices`, input),
    onSuccess: (invoice) => {
      queryClient.setQueryData(queryKeys.docs.detail(INVOICE_SLUG, invoice.id), invoice);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(INVOICE_SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PO_SLUG) });
    },
  });
}

export function usePaymentRequests(filters: {
  page?: number;
  status?: string;
  kind?: string;
  poId?: string;
}) {
  return useQuery({
    queryKey: [...queryKeys.docs.all(PAYMENT_SLUG), 'list', filters],
    queryFn: () =>
      api.get<ListResponse<PaymentRequestSummary>>('/payment-requests', {
        query: { ...filters, pageSize: 50 },
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentRequest(id: string) {
  return useQuery({
    queryKey: queryKeys.docs.detail(PAYMENT_SLUG, id),
    queryFn: () => api.get<PaymentRequestDetail>(`/payment-requests/${id}`),
  });
}

/** Every write returns the detail; the request, its lists and the invoices are refreshed. */
function usePaymentWrite<V>(fn: (vars: V) => Promise<PaymentRequestDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (request) => {
      queryClient.setQueryData(queryKeys.docs.detail(PAYMENT_SLUG, request.id), request);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(PAYMENT_SLUG) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.docs.all(INVOICE_SLUG) });
    },
  });
}

export function useCreatePaymentRequest(poId: string) {
  return usePaymentWrite((input: CreateOrderPaymentInput) =>
    api.post<PaymentRequestDetail>(`/pos/${poId}/payment-requests`, input)
  );
}

export function usePatchPaymentRequest(id: string) {
  return usePaymentWrite((input: PaymentPatchInput) =>
    api.patch<PaymentRequestDetail>(`/payment-requests/${id}`, input)
  );
}

export function useOverrideMatch(id: string) {
  return usePaymentWrite((input: MatchOverrideInput) =>
    api.post<PaymentRequestDetail>(`/payment-requests/${id}/match-override`, input)
  );
}

/** Active bank accounts and cash boxes, optionally only those paying in `currency`. */
export function useMoneyAccounts(currency?: string) {
  return useQuery({
    queryKey: ['money-accounts', 'picker', currency ?? null],
    queryFn: async () => {
      const [banks, cash] = await Promise.all([
        api.get<{ data: MoneyAccountView[] }>('/bank-accounts', { query: { currency } }),
        api.get<{ data: MoneyAccountView[] }>('/cash-boxes', { query: { currency } }),
      ]);
      return [...banks.data, ...cash.data];
    },
  });
}
