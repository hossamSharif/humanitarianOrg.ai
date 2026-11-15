'use client';

import { PERMISSIONS, formatDate, type ExchangeRate } from '@ngo/shared';
import {
  Badge,
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
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useDeleteRate, useRates } from './api';
import { GRANT_CURRENCIES } from './grant-form';
import { RateDialog, type RateDialogMode } from './rate-dialog';
import { ErrorText } from './shared';

const ALL = 'all';

/**
 * Manual exchange rates (FR-015). Rates used by a PR are read-only; "Enter correction" opens a
 * new rate with the same currency and date, which then wins as the latest entered.
 */
export function RatesTable({ baseCurrency }: { baseCurrency?: string }) {
  const t = useTranslations('rates');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const can = useHasPermission();
  const canManage = can(PERMISSIONS.RATES_MANAGE);
  const [currency, setCurrency] = useState<string>(ALL);
  const rates = useRates({ currency: currency === ALL ? undefined : currency });
  const remove = useDeleteRate();
  const [mode, setMode] = useState<RateDialogMode>({ kind: 'create' });
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const openDialog = (next: RateDialogMode) => {
    setMode(next);
    setOpen(true);
  };

  const actions = (rate: ExchangeRate) =>
    rate.inUse ? (
      <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'correction', rate })}>
        {t('enterCorrection')}
      </Button>
    ) : confirmDelete === rate.id ? (
      <span className="flex gap-1">
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(rate.id, { onSettled: () => setConfirmDelete(null) })}
        >
          {t('confirmDelete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
          {tc('cancel')}
        </Button>
      </span>
    ) : (
      <span className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'edit', rate })}>
          {t('edit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(rate.id)}>
          {t('delete')}
        </Button>
      </span>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="w-40 space-y-1.5">
          <Label htmlFor="rates-currency">{t('currency')}</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="rates-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allCurrencies')}</SelectItem>
              {GRANT_CURRENCIES.filter((c) => c !== baseCurrency).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage ? (
          <Button onClick={() => openDialog({ kind: 'create' })}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
        ) : null}
      </div>

      {rates.error ? <ErrorText>{apiError(rates.error)}</ErrorText> : null}
      {remove.error ? <ErrorText>{apiError(remove.error)}</ErrorText> : null}
      {rates.isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}

      {rates.data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('currency')}</TableHead>
                <TableHead className="text-end">{t('rateToBase')}</TableHead>
                <TableHead>{t('rateDate')}</TableHead>
                <TableHead>{t('source')}</TableHead>
                <TableHead>{t('usage')}</TableHead>
                {canManage ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rates.data.data.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">{rate.currency}</TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {rate.rateToBase} {baseCurrency ?? ''}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start tabular-nums">
                      {formatDate(rate.rateDate)}
                    </TableCell>
                    <TableCell>{rate.source}</TableCell>
                    <TableCell>
                      {rate.inUse ? (
                        <Badge variant="secondary">{t('inUse')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t('unused')}</span>
                      )}
                    </TableCell>
                    {canManage ? <TableCell>{actions(rate)}</TableCell> : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <RateDialog open={open} onOpenChange={setOpen} mode={mode} baseCurrency={baseCurrency} />
    </div>
  );
}
