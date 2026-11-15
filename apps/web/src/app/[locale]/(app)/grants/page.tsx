'use client';

import { GRANT_STATUSES, PERMISSIONS, formatDate, type GrantStatus } from '@ngo/shared';
import {
  Button,
  Label,
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
import { useMemo, useState } from 'react';
import { useDonors, useGrants } from '@/features/grants/api';
import { GrantForm } from '@/features/grants/grant-form';
import { Amount, ErrorText, GrantStatusBadge } from '@/features/grants/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';

const ALL = 'all';

export default function GrantsPage() {
  const t = useTranslations('grants');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const can = useHasPermission();
  const [status, setStatus] = useState<string>(ALL);
  const [donorId, setDonorId] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);

  const donors = useDonors();
  const grants = useGrants({
    status: status === ALL ? undefined : (status as GrantStatus),
    donorId: donorId === ALL ? undefined : donorId,
  });
  const donorNames = useMemo(
    () => new Map((donors.data?.data ?? []).map((d) => [d.id, d.shortName ?? d.name])),
    [donors.data]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/donors">{t('manageDonors')}</Link>
          </Button>
          {can(PERMISSIONS.GRANTS_MANAGE) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('add')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="w-48 space-y-1.5">
          <Label htmlFor="filter-status">{t('statusLabel')}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {GRANT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-64 space-y-1.5">
          <Label htmlFor="filter-donor">{t('donor')}</Label>
          <Select value={donorId} onValueChange={setDonorId}>
            <SelectTrigger id="filter-donor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allDonors')}</SelectItem>
              {(donors.data?.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {grants.error ? <ErrorText>{apiError(grants.error)}</ErrorText> : null}
      {grants.isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}

      {grants.data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('code')}</TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('donor')}</TableHead>
                <TableHead className="text-end">{t('totalAmount')}</TableHead>
                <TableHead>{t('period')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                grants.data.data.map((g) => (
                  <TableRow
                    key={g.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/grants/${g.id}`)}
                  >
                    <TableCell dir="ltr" className="text-start font-medium">
                      <Link href={`/grants/${g.id}`} onClick={(e) => e.stopPropagation()}>
                        {g.code}
                      </Link>
                    </TableCell>
                    <TableCell>{g.name}</TableCell>
                    <TableCell>{donorNames.get(g.donorId) ?? '—'}</TableCell>
                    <TableCell className="text-end">
                      <Amount value={g.totalAmount} currency={g.currency} />
                    </TableCell>
                    <TableCell dir="ltr" className="text-start tabular-nums">
                      {formatDate(g.startDate)} – {formatDate(g.endDate)}
                    </TableCell>
                    <TableCell>
                      <GrantStatusBadge status={g.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <GrantForm
        open={creating}
        onOpenChange={setCreating}
        onSaved={(g) => router.push(`/grants/${g.id}`)}
      />
    </div>
  );
}
