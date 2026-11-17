'use client';

// Supplier list (002 US2): filters by status, category, compliance and text; new supplier.
import { PERMISSIONS_002, SUPPLIER_STATUSES, formatDate } from '@ngo/shared';
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
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useCategories } from '@/features/procurement-settings/api';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useSuppliers, type SupplierFilters } from './api';
import { ComplianceBadges, SupplierStatusBadge } from './supplier-badges';
import { SupplierFormDialog } from './supplier-form-dialog';

const ALL = '__all';
const PAGE_SIZE = 50;

export function SuppliersList() {
  const t = useTranslations('suppliers');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const can = useHasPermission();
  const router = useRouter();
  const categories = useCategories('supplier');
  const [filters, setFilters] = useState<SupplierFilters>({ page: 1, pageSize: PAGE_SIZE });
  const [creating, setCreating] = useState(false);
  const { data, error, isPending } = useSuppliers(filters);

  const categoryName = new Map((categories.data?.data ?? []).map((c) => [c.id, localized(c)]));
  const setFilter = (change: Partial<SupplierFilters>) =>
    setFilters((f) => ({ ...f, ...change, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        {can(PERMISSIONS_002.SUPPLIERS_MANAGE) ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
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
            {SUPPLIER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.categoryId ?? ALL}
          onValueChange={(v) => setFilter({ categoryId: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('categoryFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
            {(categories.data?.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {localized(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.compliance ?? ALL}
          onValueChange={(v) =>
            setFilter({ compliance: v === ALL ? undefined : (v as 'eligible' | 'flagged') })
          }
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t('complianceFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allCompliance')}</SelectItem>
            <SelectItem value="eligible">{t('complianceEligible')}</SelectItem>
            <SelectItem value="flagged">{t('complianceFlagged')}</SelectItem>
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
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('categories')}</TableHead>
                  <TableHead className="w-32">{t('statusLabel')}</TableHead>
                  <TableHead className="w-32">{t('lastVetted')}</TableHead>
                  <TableHead>{t('complianceLabel')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/procurement/suppliers/${s.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/procurement/suppliers/${s.id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {localized({ nameAr: s.legalNameAr, nameEn: s.legalNameEn })}
                      </Link>
                      {s.tradeName ? (
                        <div className="text-xs text-muted-foreground">{s.tradeName}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.categoryIds.map((id) => categoryName.get(id) ?? '').join(' · ')}
                    </TableCell>
                    <TableCell>
                      <SupplierStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {s.lastVettedAt ? formatDate(s.lastVettedAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <ComplianceBadges compliance={s.compliance} />
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

      <SupplierFormDialog
        open={creating}
        onOpenChange={setCreating}
        supplier={null}
        onSaved={(saved) => router.push(`/procurement/suppliers/${saved.id}`)}
      />
    </div>
  );
}
