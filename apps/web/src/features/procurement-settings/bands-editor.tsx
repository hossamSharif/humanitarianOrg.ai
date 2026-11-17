'use client';

// Method bands editor (002 US1, research D4), used for the organization's bands and for a
// grant's stricter bands. Each row is `(from, up to]` in the DoA reference currency; gaps and
// overlaps are shown inline as the user types (validateBands), and the API checks again
// (422 PROCUREMENT_BANDS_INVALID).
import {
  PROCUREMENT_METHODS,
  formatAmount,
  methodBandsBody,
  validateBands,
  type BandRange,
  type MethodBand,
  type MethodBandSet,
  type ProcurementMethod,
} from '@ngo/shared';
import {
  Button,
  Input,
  MoneyInput,
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
  toast,
} from '@ngo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useSaveMethodBands } from './api';

interface Row {
  method: ProcurementMethod;
  minAmount: string;
  maxAmount: string;
  minQuotations: string;
}

const toRow = (b: MethodBand): Row => ({
  method: b.method,
  minAmount: b.minAmount ?? '',
  maxAmount: b.maxAmount ?? '',
  minQuotations: String(b.minQuotations),
});

const toBand = (r: Row): MethodBand => ({
  method: r.method,
  minAmount: r.minAmount.trim() === '' ? null : r.minAmount.trim(),
  maxAmount: r.maxAmount.trim() === '' ? null : r.maxAmount.trim(),
  minQuotations: Number(r.minQuotations),
});

const isAmount = (v: string) => v.trim() === '' || /^\d+(\.\d{1,2})?$/.test(v.trim());

export function BandsEditor({
  set,
  canEdit,
  grantId,
}: {
  set: MethodBandSet;
  canEdit: boolean;
  /** a grant's bands: an empty set is allowed and means "no stricter rule" */
  grantId?: string;
}) {
  const t = useTranslations('procurement.bands');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveMethodBands(grantId);
  const [rows, setRows] = useState<Row[]>(() => set.bands.map(toRow));
  const [serverIssues, setServerIssues] = useState<{ gaps: BandRange[]; overlaps: BandRange[] }>();
  const dirty = JSON.stringify(rows) !== JSON.stringify(set.bands.map(toRow));

  const typing = rows.some(
    (r) => !isAmount(r.minAmount) || !isAmount(r.maxAmount) || !/^\d+$/.test(r.minQuotations)
  );
  const issues = useMemo(() => {
    if (typing) return null;
    if (grantId && rows.length === 0) return { gaps: [], overlaps: [] };
    return validateBands(rows.map(toBand));
  }, [rows, typing, grantId]);
  const shown = serverIssues ?? issues;
  const valid = !typing && issues !== null && !issues.gaps.length && !issues.overlaps.length;

  const amount = (v: string | null) =>
    v === null ? t('noLimit') : formatAmount({ amount: v, currency: set.currency });

  function update(index: number, change: Partial<Row>) {
    setServerIssues(undefined);
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  function addRow() {
    setServerIssues(undefined);
    const last = rows[rows.length - 1];
    setRows([
      ...rows,
      {
        method: last ? 'tender' : 'direct',
        minAmount: last?.maxAmount ?? '',
        maxAmount: '',
        minQuotations: last ? last.minQuotations : '1',
      },
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = methodBandsBody.safeParse({ bands: rows.map(toBand) });
    if (!parsed.success) return;
    try {
      const saved = await save.mutateAsync(parsed.data);
      setRows(saved.bands.map(toRow));
      toast({ description: t('saved') });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'PROCUREMENT_BANDS_INVALID') {
        setServerIssues(err.details as { gaps: BandRange[]; overlaps: BandRange[] });
        return;
      }
      toast({ variant: 'destructive', description: apiError(err) });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {grantId
          ? t('grantIntro', { currency: set.currency })
          : t('intro', { currency: set.currency })}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{t('method')}</TableHead>
              <TableHead>{t('from')}</TableHead>
              <TableHead>{t('upTo')}</TableHead>
              <TableHead className="w-32">{t('minQuotations')}</TableHead>
              {canEdit ? <TableHead className="w-16" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Select
                    value={row.method}
                    onValueChange={(v) => update(i, { method: v as ProcurementMethod })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger aria-label={t('method')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCUREMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {t(`methods.${m}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <MoneyInput
                    value={row.minAmount}
                    onChange={(v) => update(i, { minAmount: v })}
                    currency={set.currency}
                    placeholder="0"
                    aria-label={t('from')}
                    disabled={!canEdit}
                  />
                </TableCell>
                <TableCell>
                  <MoneyInput
                    value={row.maxAmount}
                    onChange={(v) => update(i, { maxAmount: v })}
                    currency={set.currency}
                    placeholder={t('noLimit')}
                    aria-label={t('upTo')}
                    disabled={!canEdit}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    inputMode="numeric"
                    dir="ltr"
                    min={1}
                    value={row.minQuotations}
                    onChange={(e) => update(i, { minQuotations: e.target.value })}
                    aria-label={t('minQuotations')}
                    disabled={!canEdit}
                  />
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('remove')}
                      onClick={() => {
                        setServerIssues(undefined);
                        setRows(rows.filter((_, j) => j !== i));
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{grantId ? t('grantEmpty') : t('empty')}</p>
      ) : null}

      {shown && (shown.gaps.length > 0 || shown.overlaps.length > 0) ? (
        <ul role="alert" className="list-disc space-y-1 ps-5 text-sm text-destructive">
          {shown.gaps.map(([from, to], i) => (
            <li key={`g${i}`}>{t('gap', { from: amount(from), to: amount(to) })}</li>
          ))}
          {shown.overlaps.map(([from, to], i) => (
            <li key={`o${i}`}>{t('overlap', { from: amount(from), to: amount(to) })}</li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty}
              onClick={() => {
                setServerIssues(undefined);
                setRows(set.bands.map(toRow));
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!dirty || !valid || save.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
