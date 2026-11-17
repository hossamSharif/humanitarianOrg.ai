'use client';

// Evaluation criteria (002 US3, FR-017): essential (pass/fail) and weighted criteria per stage,
// with each stage's running total; issuing is refused unless every stage totals 100 (US3-2).
import {
  CRITERION_KINDS,
  CRITERION_STAGES,
  Decimal,
  type CriterionKind,
  type CriterionStage,
  type SourcingCriterionInput,
  type SourcingCriterionView,
  type SourcingEventDetail,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  toast,
} from '@ngo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useUpdateRfq } from './api';

interface Row {
  key: string;
  stage: CriterionStage;
  kind: CriterionKind;
  code: string;
  nameAr: string;
  nameEn: string;
  weightPct: string;
  isPrice: boolean;
}

const toRow = (c: SourcingCriterionView): Row => ({
  key: c.id,
  stage: c.stage,
  kind: c.kind,
  code: c.code,
  nameAr: c.nameAr,
  nameEn: c.nameEn,
  weightPct: c.weightPct ?? '',
  isPrice: c.isPrice,
});

/** Σ weighted criteria per stage; non-numbers count as 0. */
export function stageTotals(
  rows: readonly { stage: string; kind: string; weightPct: string | null }[]
) {
  const totals = new Map<string, Decimal>();
  for (const r of rows) {
    if (r.kind !== 'weighted') continue;
    const w = /^\d+(\.\d+)?$/.test(r.weightPct ?? '') ? new Decimal(r.weightPct!) : new Decimal(0);
    totals.set(r.stage, (totals.get(r.stage) ?? new Decimal(0)).plus(w));
  }
  return totals;
}

export function CriteriaEditor({
  event,
  editable,
}: {
  event: SourcingEventDetail;
  editable: boolean;
}) {
  const t = useTranslations('sourcing.criteria');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const update = useUpdateRfq(event.id);
  const [rows, setRows] = useState<Row[]>(() => event.criteria.map(toRow));

  useEffect(() => {
    setRows(event.criteria.map(toRow));
  }, [event.criteria]);

  const totals = stageTotals(rows);
  const patch = (key: string, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const save = () => {
    const criteria: SourcingCriterionInput[] = rows.map((r) => ({
      stage: r.stage,
      kind: r.kind,
      code: r.code,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      weightPct: r.kind === 'weighted' ? r.weightPct : null,
      isPrice: r.kind === 'weighted' && r.isPrice,
    }));
    update.mutate(
      { expectedVersion: event.version, criteria },
      { onSuccess: () => toast({ description: t('saved') }) }
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {[...totals].map(([stage, total]) => (
            <Badge
              key={stage}
              variant={total.eq(100) ? 'secondary' : 'destructive'}
              aria-live="polite"
            >
              {t('stageTotal', { stage: t(`stages.${stage}`), total: total.toFixed(2) })}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t('stage')}</TableHead>
                <TableHead className="w-32">{t('kind')}</TableHead>
                <TableHead className="w-28">{t('code')}</TableHead>
                <TableHead>{t('nameAr')}</TableHead>
                <TableHead>{t('nameEn')}</TableHead>
                <TableHead className="w-24 text-end">{t('weight')}</TableHead>
                <TableHead className="w-20">{t('price')}</TableHead>
                {editable ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) =>
                editable ? (
                  <TableRow key={r.key}>
                    <TableCell>
                      <Select
                        value={r.stage}
                        onValueChange={(v) => patch(r.key, { stage: v as CriterionStage })}
                      >
                        <SelectTrigger aria-label={t('stage')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CRITERION_STAGES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {t(`stages.${s}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.kind}
                        onValueChange={(v) =>
                          patch(r.key, {
                            kind: v as CriterionKind,
                            isPrice: v === 'weighted' && r.isPrice,
                          })
                        }
                      >
                        <SelectTrigger aria-label={t('kind')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CRITERION_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {t(`kinds.${k}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="ltr"
                        aria-label={t('code')}
                        value={r.code}
                        onChange={(e) =>
                          patch(r.key, {
                            code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="rtl"
                        aria-label={t('nameAr')}
                        value={r.nameAr}
                        onChange={(e) => patch(r.key, { nameAr: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="ltr"
                        aria-label={t('nameEn')}
                        value={r.nameEn}
                        onChange={(e) => patch(r.key, { nameEn: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        className="text-end"
                        aria-label={t('weight')}
                        disabled={r.kind !== 'weighted'}
                        value={r.kind === 'weighted' ? r.weightPct : ''}
                        onChange={(e) =>
                          patch(r.key, { weightPct: e.target.value.replace(/[^\d.]/g, '') })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        aria-label={t('price')}
                        checked={r.isPrice}
                        disabled={r.kind !== 'weighted'}
                        onCheckedChange={(v) => patch(r.key, { isPrice: v === true })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('remove')}
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={r.key}>
                    <TableCell>{t(`stages.${r.stage}`)}</TableCell>
                    <TableCell>{t(`kinds.${r.kind}`)}</TableCell>
                    <TableCell dir="ltr">{r.code}</TableCell>
                    <TableCell colSpan={2}>{localized(r)}</TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {r.kind === 'weighted' ? `${r.weightPct}%` : '—'}
                    </TableCell>
                    <TableCell>{r.isPrice ? t('priceYes') : ''}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        </div>
        {update.error ? <ErrorText>{apiError(update.error)}</ErrorText> : null}
        {editable ? (
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  {
                    key: crypto.randomUUID(),
                    stage: 'single',
                    kind: 'weighted',
                    code: '',
                    nameAr: '',
                    nameEn: '',
                    weightPct: '',
                    isPrice: false,
                  },
                ])
              }
            >
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('add')}
            </Button>
            <Button onClick={save} disabled={update.isPending}>
              {tc('save')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
