'use client';

// PR list (FR-046): TanStack Table for columns and server-side sorting, TanStack Virtual for the
// rows of a page (up to 200), server-side pagination. Filters, sort and page live in the URL.
import { formatAmount, formatDate, type PrListItem, type PrListSortField } from '@ngo/shared';
import { Button, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from '@ngo/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef } from 'react';
import { useLocalizedName } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { usePrList } from './api';
import { usePrListFilters, useSetPrListFilters } from './pr-list-filters';
import { PrStatusBadge } from './pr-status-badge';

const ROW_HEIGHT = 52;

/** Column id → API sort field, for sortable columns. */
const SORTABLE: Partial<Record<string, PrListSortField>> = {
  number: 'number',
  status: 'status',
  prDate: 'prDate',
  totalGrantCurrency: 'totalGrantCurrency',
  updatedAt: 'updatedAt',
};

export function PrListTable() {
  const t = useTranslations('prList');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const filters = usePrListFilters();
  const setFilters = useSetPrListFilters();
  const { data, error, isPending, isFetching } = usePrList(filters);

  const [sortField, sortDirection] = (filters.sort ?? 'createdAt:desc').split(':') as [
    string,
    'asc' | 'desc',
  ];

  const columns = useMemo<ColumnDef<PrListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('columns.number'),
        cell: ({ row }) => (
          <Link
            href={`/prs/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            <bdi dir="ltr">{row.original.number ?? t('draftNumber')}</bdi>
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <PrStatusBadge status={row.original.status} />,
      },
      {
        id: 'prDate',
        header: t('columns.prDate'),
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {formatDate(row.original.prDate) || '—'}
          </span>
        ),
      },
      {
        id: 'office',
        header: t('columns.office'),
        cell: ({ row }) => (row.original.office ? localized(row.original.office) : '—'),
      },
      {
        id: 'grant',
        header: t('columns.grant'),
        cell: ({ row }) => <bdi dir="ltr">{row.original.grant?.code ?? '—'}</bdi>,
      },
      {
        id: 'requester',
        header: t('columns.requester'),
        cell: ({ row }) => localized(row.original.requester),
      },
      {
        id: 'totals',
        header: t('columns.total'),
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {row.original.totals.map((m) => formatAmount(m)).join(' + ') || '—'}
          </span>
        ),
      },
      {
        id: 'totalGrantCurrency',
        header: t('columns.totalGrantCurrency'),
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {row.original.totalGrantCurrency ? formatAmount(row.original.totalGrantCurrency) : '—'}
          </span>
        ),
      },
    ],
    [t, localized]
  );

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = items.length
    ? virtualizer.getTotalSize() - items[items.length - 1]!.end
    : 0;

  const toggleSort = (columnId: string) => {
    const field = SORTABLE[columnId];
    if (!field) return;
    const direction = sortField === field && sortDirection === 'desc' ? 'asc' : 'desc';
    setFilters({ sort: `${field}:${direction}` });
  };

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiError(error)}
      </p>
    );
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize));
  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(total, filters.page * filters.pageSize);

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className={cn('max-h-[70vh] overflow-auto rounded-md border', isFetching && 'opacity-70')}
      >
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const field = SORTABLE[header.column.id];
                  const sorted = field && sortField === field ? sortDirection : null;
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className="whitespace-nowrap"
                    >
                      {field ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(header.column.id)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {label}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  {tc('loading')}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 ? (
                  <tr aria-hidden>
                    <td style={{ height: paddingTop }} colSpan={columns.length} />
                  </tr>
                ) : null}
                {items.map((item) => {
                  const row = rows[item.index]!;
                  return (
                    <TableRow key={row.id} style={{ height: ROW_HEIGHT }}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 ? (
                  <tr aria-hidden>
                    <td style={{ height: paddingBottom }} colSpan={columns.length} />
                  </tr>
                ) : null}
              </>
            )}
          </TableBody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">{t('range', { from, to, total })}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => setFilters({ page: filters.page - 1 })}
          >
            <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden />
            {t('previous')}
          </Button>
          <span dir="ltr" className="tabular-nums">
            {filters.page} / {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= lastPage}
            onClick={() => setFilters({ page: filters.page + 1 })}
          >
            {t('next')}
            <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
