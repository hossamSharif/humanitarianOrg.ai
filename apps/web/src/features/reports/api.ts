'use client';

// Budget status report (FR-049): the JSON report, the drill-down to reserving / committing PRs,
// and the Excel export (rendered by the API).
import type { BudgetDrillDown, BudgetStatusReport, PrintLocale } from '@ngo/shared';
import { useQuery } from '@tanstack/react-query';
import { api, apiDownload, saveBlob } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function useBudgetStatus(grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.reports.budgetStatus(grantId ?? ''),
    enabled: Boolean(grantId),
    queryFn: () => api.get<BudgetStatusReport>('/reports/budget-status', { query: { grantId } }),
  });
}

export function useBudgetDrillDown(
  budgetLineId: string | null,
  status: 'reserved' | 'committed' | null
) {
  return useQuery({
    queryKey: queryKeys.reports.drillDown(budgetLineId ?? '', status),
    enabled: Boolean(budgetLineId),
    queryFn: () =>
      api.get<BudgetDrillDown>(`/reports/budget-status/lines/${budgetLineId}/prs`, {
        query: { status: status ?? undefined },
      }),
  });
}

export async function downloadBudgetStatusXlsx(grantId: string, locale: PrintLocale) {
  const { blob, fileName } = await apiDownload('/reports/budget-status/export.xlsx', {
    grantId,
    locale,
  });
  saveBlob(blob, fileName ?? `budget-status-${locale}.xlsx`);
}
