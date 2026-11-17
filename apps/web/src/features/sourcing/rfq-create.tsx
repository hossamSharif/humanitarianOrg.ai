'use client';

// New RFQ (002 US3): pick approved, not-sourced PR lines of one grant and office, give a title,
// create the draft. Once a line is picked only lines of the same grant and office stay
// selectable (US3-5); the API checks again (MIXED_GRANTS, PR_LINE_ALREADY_SOURCING).
import { formatAmount, formatDate, type SourceablePrLine } from '@ngo/shared';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ErrorText } from '@/features/grants/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useCreateRfq, useSourceablePrLines } from './api';

export function RfqCreate() {
  const t = useTranslations('sourcing.create');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<SourceablePrLine[]>([]);
  const lines = useSourceablePrLines({ q });
  const create = useCreateRfq();

  const anchor = selected[0] ?? null;
  const compatible = (l: SourceablePrLine) =>
    !anchor || (l.grantId === anchor.grantId && l.officeId === anchor.officeId);
  const isSelected = (l: SourceablePrLine) => selected.some((s) => s.id === l.id);
  const toggle = (l: SourceablePrLine, on: boolean) =>
    setSelected((cur) => (on ? [...cur, l] : cur.filter((s) => s.id !== l.id)));

  // grouped by PR so whole requisitions are easy to pick
  const groups = useMemo(() => {
    const byPr = new Map<string, SourceablePrLine[]>();
    for (const l of lines.data?.data ?? []) byPr.set(l.prId, [...(byPr.get(l.prId) ?? []), l]);
    return [...byPr.values()];
  }, [lines.data]);

  const submit = () =>
    create.mutate(
      { prLineIds: selected.map((l) => l.id), title: title.trim() },
      { onSuccess: (event) => router.push(`/procurement/rfqs/${event.id}`) }
    );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rfq-title">{t('rfqTitle')}</Label>
          <Input
            id="rfq-title"
            dir="auto"
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rfq-line-search">{t('search')}</Label>
          <Input id="rfq-line-search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {anchor ? (
        <p className="text-sm text-muted-foreground">
          {t('oneGrant', { grant: anchor.grantCode, count: selected.length })}
        </p>
      ) : null}

      {lines.error ? <ErrorText>{apiError(lines.error)}</ErrorText> : null}
      {lines.isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
      {lines.data && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}

      {groups.map((group) => {
        const head = group[0]!;
        const allOn = group.every(isSelected);
        const groupEnabled = compatible(head);
        return (
          <section key={head.prId} className="rounded-md border" aria-label={head.prNumber ?? ''}>
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3 text-sm">
              <Checkbox
                id={`pr-${head.prId}`}
                checked={allOn}
                disabled={!groupEnabled}
                onCheckedChange={(v) =>
                  setSelected((cur) =>
                    v === true
                      ? [...cur, ...group.filter((l) => !cur.some((c) => c.id === l.id))]
                      : cur.filter((c) => c.prId !== head.prId)
                  )
                }
                aria-label={t('selectPr', { number: head.prNumber ?? '' })}
              />
              <span dir="ltr" className="font-medium">
                {head.prNumber}
              </span>
              <span dir="ltr" className="text-muted-foreground">
                {formatDate(head.prDate)} · {head.grantCode}
              </span>
              {!groupEnabled ? (
                <span className="text-xs text-muted-foreground">{t('otherGrant')}</span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{t('description')}</TableHead>
                    <TableHead className="w-28 text-end">{t('quantity')}</TableHead>
                    <TableHead className="w-20">{t('unit')}</TableHead>
                    <TableHead className="w-40 text-end">{t('estimate')}</TableHead>
                    <TableHead className="w-28">{t('budgetLine')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Checkbox
                          checked={isSelected(l)}
                          disabled={!compatible(l)}
                          onCheckedChange={(v) => toggle(l, v === true)}
                          aria-label={t('selectLine', { line: l.lineNo })}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                      <TableCell>
                        <span className="font-medium">{l.description ?? '—'}</span>
                        {l.specifications ? (
                          <span className="block whitespace-pre-line text-xs text-muted-foreground">
                            {l.specifications}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {l.quantity}
                      </TableCell>
                      <TableCell>{l.unitCode ?? '—'}</TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {formatAmount({ amount: l.lineTotal, currency: l.currency })}
                      </TableCell>
                      <TableCell dir="ltr">{l.budgetLineCode ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/procurement/rfqs">{tc('cancel')}</Link>
        </Button>
        <Button
          disabled={selected.length === 0 || title.trim() === '' || create.isPending}
          onClick={submit}
        >
          {t('create', { count: selected.length })}
        </Button>
      </div>
    </div>
  );
}
