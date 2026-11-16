'use client';

// PR list filters (FR-046). The URL search params are the single source of truth, so a filtered
// list can be bookmarked, shared and restored with the back button.
import { PR_STATUSES, type PrStatus } from '@ngo/shared';
import {
  Button,
  Checkbox,
  DateInput,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useGrants } from '@/features/grants/api';
import { useLocalizedName } from '@/features/grants/shared';
import { usePathname, useRouter } from '@/i18n/routing';
import { useMe } from '@/lib/use-me';
import type { PrListFilters } from './api';

const ANY = '__any';
const DEFAULT_PAGE_SIZE = 50;

/** Reads the list filters from the URL. */
export function usePrListFilters(): PrListFilters {
  const params = useSearchParams();
  const text = (key: string) => params.get(key) || undefined;
  return {
    status: params.getAll('status').filter((s) => (PR_STATUSES as readonly string[]).includes(s)),
    officeId: text('officeId'),
    grantId: text('grantId'),
    requesterId: text('requesterId'),
    dateFrom: text('dateFrom'),
    dateTo: text('dateTo'),
    amountMin: text('amountMin'),
    amountMax: text('amountMax'),
    q: text('q'),
    sort: text('sort'),
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE,
  };
}

/** Writes a filter change to the URL; any change other than the page returns to page 1. */
export function useSetPrListFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return (patch: Partial<Record<keyof PrListFilters, string | string[] | number | undefined>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value !== undefined && value !== '') next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

export function PrListFiltersBar() {
  const t = useTranslations('prList.filters');
  const tStatus = useTranslations('status');
  const filters = usePrListFilters();
  const setFilters = useSetPrListFilters();
  const { data: me } = useMe();
  const grants = useGrants();
  const localized = useLocalizedName();

  // the search box writes to the URL after a short pause
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    if ((filters.q ?? '') === q.trim()) return;
    const timer = setTimeout(() => setFilters({ q: q.trim() || undefined }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [amountMin, setAmountMin] = useState(filters.amountMin ?? '');
  const [amountMax, setAmountMax] = useState(filters.amountMax ?? '');
  useEffect(() => setAmountMin(filters.amountMin ?? ''), [filters.amountMin]);
  useEffect(() => setAmountMax(filters.amountMax ?? ''), [filters.amountMax]);

  const statuses = filters.status ?? [];
  const toggleStatus = (s: PrStatus, on: boolean) =>
    setFilters({ status: on ? [...statuses, s] : statuses.filter((x) => x !== s) });
  const active =
    statuses.length > 0 ||
    Boolean(
      filters.officeId ||
      filters.grantId ||
      filters.requesterId ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.amountMin ||
      filters.amountMax ||
      filters.q
    );
  const mine = Boolean(me && filters.requesterId === me.user.id);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="ps-9"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>{t('status')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between font-normal">
                <span className="truncate">
                  {statuses.length === 0
                    ? t('anyStatus')
                    : statuses.map((s) => tStatus(s)).join('، ')}
                </span>
                <ChevronDown className="ms-2 h-4 w-4 shrink-0 opacity-60" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {PR_STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statuses.includes(s)}
                  onCheckedChange={(on) => toggleStatus(s, on === true)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {tStatus(s)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prs-office">{t('office')}</Label>
          <Select
            value={filters.officeId ?? ANY}
            onValueChange={(v) => setFilters({ officeId: v === ANY ? undefined : v })}
          >
            <SelectTrigger id="prs-office">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('anyOffice')}</SelectItem>
              {(me?.offices ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.code} — {localized(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prs-grant">{t('grant')}</Label>
          <Select
            value={filters.grantId ?? ANY}
            onValueChange={(v) => setFilters({ grantId: v === ANY ? undefined : v })}
          >
            <SelectTrigger id="prs-grant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('anyGrant')}</SelectItem>
              {(grants.data?.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.code} — {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2 pb-2">
          <Checkbox
            id="prs-mine"
            checked={mine}
            disabled={!me}
            onCheckedChange={(on) =>
              setFilters({ requesterId: on === true ? me?.user.id : undefined })
            }
          />
          <Label htmlFor="prs-mine">{t('mine')}</Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prs-date-from">{t('dateFrom')}</Label>
          <DateInput
            id="prs-date-from"
            value={filters.dateFrom ?? null}
            onChange={(v) => setFilters({ dateFrom: v ?? undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prs-date-to">{t('dateTo')}</Label>
          <DateInput
            id="prs-date-to"
            value={filters.dateTo ?? null}
            onChange={(v) => setFilters({ dateTo: v ?? undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prs-amount-min">{t('amountMin')}</Label>
          <MoneyInput
            id="prs-amount-min"
            value={amountMin}
            onChange={setAmountMin}
            onBlur={() => setFilters({ amountMin: amountMin || undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prs-amount-max">{t('amountMax')}</Label>
          <MoneyInput
            id="prs-amount-max"
            value={amountMax}
            onChange={setAmountMax}
            onBlur={() => setFilters({ amountMax: amountMax || undefined })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('amountHint')}</p>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters({
                status: undefined,
                officeId: undefined,
                grantId: undefined,
                requesterId: undefined,
                dateFrom: undefined,
                dateTo: undefined,
                amountMin: undefined,
                amountMax: undefined,
                q: undefined,
              })
            }
          >
            <X className="me-1 h-4 w-4" aria-hidden />
            {t('clear')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
