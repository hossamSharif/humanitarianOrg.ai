'use client';

// The recommendation (002 US5-3, FR-027): the highest total by default; another offer — or,
// when the RFQ allows it, one offer per line — needs a justification tied to at least one
// published criterion before the committee can sign. Shows the resulting award lines.
import { formatAmount, type BidAnalysisDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Textarea,
  toast,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Amount, ErrorText, WarningBanner, useLocalizedName } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useRecommend } from './api';

export function RecommendationForm({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.recommendation');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const recommend = useRecommend(analysis.id);
  const editable = analysis.availableActions.includes('recommend');
  const competing = analysis.offers.filter((o) => o.status !== 'disqualified');
  const initialSplit = analysis.recommendedOfferId === null && analysis.awardLines.length > 0;

  const [split, setSplit] = useState(initialSplit);
  const [offerId, setOfferId] = useState(
    analysis.recommendedOfferId ?? analysis.highestOfferId ?? ''
  );
  const [perLine, setPerLine] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState(analysis.justification ?? '');
  const [criteria, setCriteria] = useState<string[]>(analysis.justificationCriterionIds);

  useEffect(() => {
    setSplit(analysis.recommendedOfferId === null && analysis.awardLines.length > 0);
    setOfferId(analysis.recommendedOfferId ?? analysis.highestOfferId ?? '');
    setPerLine(Object.fromEntries(analysis.awardLines.map((a) => [a.sourcingLineId, a.offerId])));
    setJustification(analysis.justification ?? '');
    setCriteria(analysis.justificationCriterionIds);
  }, [analysis]);

  const name = (id: string) => {
    const o = analysis.offers.find((x) => x.offerId === id);
    return o ? localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn }) : '—';
  };
  const notHighest = !split && offerId !== '' && offerId !== analysis.highestOfferId;

  const submit = () =>
    recommend.mutate(
      {
        expectedVersion: analysis.version,
        ...(split
          ? {
              lines: analysis.lines
                .filter((l) => perLine[l.id])
                .map((l) => ({ sourcingLineId: l.id, offerId: perLine[l.id]! })),
            }
          : { offerId }),
        ...(justification.trim() ? { justification: justification.trim() } : {}),
        justificationCriterionIds: criteria,
      },
      { onSuccess: () => toast({ description: t('saved') }) }
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable ? (
          <>
            {analysis.splitAwardAllowed ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rec-split"
                  checked={split}
                  onCheckedChange={(v) => setSplit(v === true)}
                />
                <Label htmlFor="rec-split">{t('split')}</Label>
              </div>
            ) : null}
            {split ? (
              <div className="space-y-2">
                {analysis.lines.map((l) => (
                  <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_16rem]">
                    <span className="text-sm">
                      {l.lineNo}. {l.description ?? '—'}
                    </span>
                    <Select
                      value={perLine[l.id] ?? ''}
                      onValueChange={(v) => setPerLine((cur) => ({ ...cur, [l.id]: v }))}
                    >
                      <SelectTrigger aria-label={t('lineOffer', { line: l.lineNo })}>
                        <SelectValue placeholder={t('chooseOffer')} />
                      </SelectTrigger>
                      <SelectContent>
                        {competing.map((o) => (
                          <SelectItem key={o.offerId} value={o.offerId}>
                            {name(o.offerId)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="rec-offer">{t('offer')}</Label>
                <Select value={offerId} onValueChange={setOfferId}>
                  <SelectTrigger id="rec-offer">
                    <SelectValue placeholder={t('chooseOffer')} />
                  </SelectTrigger>
                  <SelectContent>
                    {competing.map((o) => (
                      <SelectItem key={o.offerId} value={o.offerId}>
                        {name(o.offerId)}
                        {o.offerId === analysis.highestOfferId ? ` — ${t('highest')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {notHighest ? <WarningBanner>{t('notHighest')}</WarningBanner> : null}
            <div className="space-y-1.5">
              <Label htmlFor="rec-justification">{t('justification')}</Label>
              <Textarea
                id="rec-justification"
                dir="auto"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('criteria')}</legend>
              {analysis.criteria.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`rec-c-${c.id}`}
                    checked={criteria.includes(c.id)}
                    onCheckedChange={(v) =>
                      setCriteria((cur) =>
                        v === true ? [...cur, c.id] : cur.filter((x) => x !== c.id)
                      )
                    }
                  />
                  <Label htmlFor={`rec-c-${c.id}`}>{localized(c)}</Label>
                </div>
              ))}
            </fieldset>
            {recommend.error ? <ErrorText>{apiError(recommend.error)}</ErrorText> : null}
            <div className="flex justify-end">
              <Button disabled={recommend.isPending || (!split && !offerId)} onClick={submit}>
                {tc('save')}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-1 text-sm">
            <p>
              {analysis.recommendedOfferId
                ? t('recommended', { name: name(analysis.recommendedOfferId) })
                : analysis.awardLines.length
                  ? t('recommendedSplit')
                  : t('none')}
            </p>
            {analysis.justification ? (
              <p className="text-muted-foreground">{analysis.justification}</p>
            ) : null}
          </div>
        )}

        {analysis.awardLines.length > 0 ? (
          <div className="space-y-2">
            <h3 className="font-semibold">{t('awardLines')}</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{t('line')}</TableHead>
                    <TableHead>{t('supplier')}</TableHead>
                    <TableHead className="text-end">{t('quantity')}</TableHead>
                    <TableHead className="text-end">{t('unitPrice')}</TableHead>
                    <TableHead className="text-end">{t('amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.awardLines.map((a) => (
                    <TableRow key={a.sourcingLineId}>
                      <TableCell className="tabular-nums">{a.lineNo}</TableCell>
                      <TableCell>{a.description ?? '—'}</TableCell>
                      <TableCell>{name(a.offerId)}</TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {a.quantity}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {formatAmount({ amount: a.unitPrice, currency: a.currency })}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {formatAmount({ amount: a.amount, currency: a.currency })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {analysis.awardedAmount ? (
              <p className="text-end text-sm font-semibold">
                {t('awardedTotal')}{' '}
                <Amount value={analysis.awardedAmount} currency={analysis.eventCurrency} />
                {analysis.awardedAmountDoa && analysis.doaCurrency ? (
                  <>
                    {' · '}
                    <Amount value={analysis.awardedAmountDoa} currency={analysis.doaCurrency} />
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
