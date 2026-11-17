'use client';

// The comparison (002 US5-1): each offer's total in its currency and in the event currency at
// the opening-date rates shown, the computed price points, criteria points, weighted total and
// rank. Prices stay hidden for an undeclared or conflicted committee member (US5-5).
import { formatAmount, type BidAnalysisDetail } from '@ngo/shared';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { formatDate } from '@ngo/shared';
import { useLocalizedName } from '@/features/grants/shared';

export function ComparisonTable({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.comparison');
  const localized = useLocalizedName();
  const nonPrice = analysis.criteria.filter((c) => c.kind === 'weighted' && !c.isPrice);
  const offerName = (id: string) => {
    const o = analysis.offers.find((x) => x.offerId === id);
    return o ? localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn }) : '—';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!analysis.pricesVisible ? (
          <p role="status" className="rounded-md border p-3 text-sm">
            {t('hidden')}
          </p>
        ) : null}
        {analysis.comparisonRates.length > 0 ? (
          <p className="text-xs text-muted-foreground" dir="auto">
            {t('rates')}{' '}
            {analysis.comparisonRates
              .map((r) => `${r.currency} ${r.rateToBase} (${formatDate(r.rateDate)}, ${r.source})`)
              .join(' · ')}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t('rank')}</TableHead>
                <TableHead>{t('supplier')}</TableHead>
                <TableHead className="text-end">{t('total')}</TableHead>
                <TableHead className="text-end">
                  {t('totalEvent', { currency: analysis.eventCurrency })}
                </TableHead>
                <TableHead className="text-end">{t('pricePoints')}</TableHead>
                {nonPrice.map((c) => (
                  <TableHead key={c.id} className="text-end">
                    {t('criterionHead', { name: localized(c), weight: c.weightPct ?? '' })}
                  </TableHead>
                ))}
                <TableHead className="text-end">{t('weightedTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.results.map((r) => {
                const offer = analysis.offers.find((o) => o.offerId === r.offerId);
                return (
                  <TableRow key={r.offerId} className={r.rank === 1 ? 'bg-muted/40' : undefined}>
                    <TableCell className="tabular-nums">{r.rank ?? '—'}</TableCell>
                    <TableCell>
                      <span className="font-medium">{offerName(r.offerId)}</span>
                      {r.disqualified ? (
                        <Badge variant="destructive" className="ms-2">
                          {t('disqualified')}
                        </Badge>
                      ) : null}
                      {r.disqualificationReason ? (
                        <span className="block text-xs text-muted-foreground">
                          {r.disqualificationReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {r.totalOfferCurrency && offer?.currency
                        ? formatAmount({ amount: r.totalOfferCurrency, currency: offer.currency })
                        : '—'}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {r.totalEventCurrency
                        ? formatAmount({
                            amount: r.totalEventCurrency,
                            currency: analysis.eventCurrency,
                          })
                        : '—'}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {r.pricePoints ?? '—'}
                    </TableCell>
                    {nonPrice.map((c) => (
                      <TableCell key={c.id} dir="ltr" className="text-end tabular-nums">
                        {r.criteriaPoints[c.id] ?? '—'}
                      </TableCell>
                    ))}
                    <TableCell dir="ltr" className="text-end font-semibold tabular-nums">
                      {r.weightedTotal ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {analysis.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}
        {analysis.lineResults.length > 0 ? (
          <div className="space-y-2">
            <h3 className="font-semibold">{t('perLine')}</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{t('supplier')}</TableHead>
                    <TableHead className="text-end">{t('lineTotal')}</TableHead>
                    <TableHead className="text-end">{t('weightedTotal')}</TableHead>
                    <TableHead className="w-12">{t('rank')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.lineResults.map((r) => (
                    <TableRow key={`${r.sourcingLineId}-${r.offerId}`}>
                      <TableCell className="tabular-nums">
                        {analysis.lines.find((l) => l.id === r.sourcingLineId)?.lineNo}
                      </TableCell>
                      <TableCell>{offerName(r.offerId)}</TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {r.totalEventCurrency ?? '—'}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end tabular-nums">
                        {r.weightedTotal ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">{r.rank ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
