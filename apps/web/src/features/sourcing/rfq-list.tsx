'use client';

// RFQ list (002 US3): filter by status and text; new RFQ from approved PR lines.
import { PERMISSIONS_002, SOURCING_EVENT_STATUSES, formatDate, formatDateTime } from '@ngo/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { Amount, ErrorText } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useRfqs, type RfqFilters } from './api';

const ALL = '__all';
const PAGE_SIZE = 50;

export function RfqList() {
  const t = useTranslations('sourcing');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const can = useHasPermission();
  const router = useRouter();
  const [filters, setFilters] = useState<RfqFilters>({ page: 1, pageSize: PAGE_SIZE });
  const timeZone = useTenantTimeZone();
  const { data, error, isPending } = useRfqs(filters);
  const setFilter = (change: Partial<RfqFilters>) =>
    setFilters((f) => ({ ...f, ...change, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        {can(PERMISSIONS_002.RFQ_CREATE) ? (
          <Button asChild>
            <Link href="/procurement/rfqs/new">
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('add')}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          className="w-full sm:w-64"
          placeholder={t('search')}
          aria-label={t('search')}
          value={filters.q ?? ''}
          onChange={(e) => setFilter({ q: e.target.value })}
        />
        <Select
          value={filters.status ?? ALL}
          onValueChange={(v) => setFilter({ status: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('statusFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {SOURCING_EVENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}

      {data ? (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">{t('number')}</TableHead>
                  <TableHead>{t('titleLabel')}</TableHead>
                  <TableHead className="w-28">{t('grant')}</TableHead>
                  <TableHead className="w-32">{t('statusLabel')}</TableHead>
                  <TableHead className="w-28">{t('method')}</TableHead>
                  <TableHead className="w-40 text-end">{t('estimatedValue')}</TableHead>
                  <TableHead className="w-44">{t('deadline')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((e) => (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/procurement/rfqs/${e.id}`)}
                  >
                    <TableCell dir="ltr">
                      <Link
                        href={`/procurement/rfqs/${e.id}`}
                        className="font-medium hover:underline"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.number ?? t('draftNumber')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{e.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('lineCount', { count: e.lineCount })} ·{' '}
                        {t('invitationCount', { count: e.invitationCount })}
                      </span>
                    </TableCell>
                    <TableCell dir="ltr">{e.grantCode}</TableCell>
                    <TableCell>
                      <DocStatusBadge status={e.status} namespace="sourcing.status" />
                    </TableCell>
                    <TableCell>{t(`methods.${e.chosenMethod}`)}</TableCell>
                    <TableCell className="text-end">
                      <Amount value={e.estimatedValueDoa} currency={e.doaCurrency} />
                    </TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {e.submissionDeadline
                        ? formatDateTime(e.submissionDeadline, timeZone)
                        : e.issueDate
                          ? formatDate(e.issueDate)
                          : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : null}
          {pages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={(filters.page ?? 1) <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              >
                {t('previous')}
              </Button>
              <span className="tabular-nums" dir="ltr">
                {filters.page ?? 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(filters.page ?? 1) >= pages}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              >
                {t('next')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
