'use client';

// Quotation analysis page (002 US5): the committee and declarations, the comparison, the
// caller's scores, the recommendation, committee signatures, submission into the AWARD route
// and its approval steps (shared document actions), the unsuccessful notices and the history.
import { formatDate, type BidAnalysisDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { INVITATION_CHANNELS } from '@ngo/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionsPanel } from '@/features/documents/actions-panel';
import { useSubmitDoc } from '@/features/documents/api';
import { DocHistoryTimeline } from '@/features/documents/history-timeline';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { StepsView } from '@/features/documents/steps-view';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useAnalysis, useRecordNotices, useSignAnalysis } from './api';
import { CommitteePanel } from './committee-panel';
import { ComparisonTable } from './comparison-table';
import { RecommendationForm } from './recommendation-form';
import { ScoringGrid } from './scoring-grid';

function SignAndSubmit({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.actions');
  const apiError = useApiError();
  const sign = useSignAnalysis(analysis.id);
  const submit = useSubmitDoc('bid-analyses', analysis.id);
  const can = (a: string) => analysis.availableActions.includes(a);
  return (
    <>
      {can('sign') ? (
        <Button
          disabled={sign.isPending}
          onClick={() => sign.mutate({ expectedVersion: analysis.version })}
        >
          {t('sign')}
        </Button>
      ) : null}
      {can('submit') ? (
        <Button
          variant="outline"
          disabled={submit.isPending}
          onClick={() => submit.mutate(analysis.version)}
        >
          {t('submit')}
        </Button>
      ) : null}
      {sign.error ? <ErrorText>{apiError(sign.error)}</ErrorText> : null}
      {submit.error ? <ErrorText>{apiError(submit.error)}</ErrorText> : null}
    </>
  );
}

function NoticesPanel({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.notices');
  const ti = useTranslations('sourcing.invitations.channels');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const record = useRecordNotices(analysis.id);
  const [values, setValues] = useState<Record<string, { date: string | null; channel: string }>>(
    {}
  );
  if (analysis.notices.length === 0) return null;
  const editable = analysis.availableActions.includes('notices');
  const name = (offerId: string) => {
    const o = analysis.offers.find((x) => x.offerId === offerId);
    return o ? localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn }) : '—';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {analysis.notices.map((n) => {
          const v = values[n.offerId] ?? { date: n.notifiedOn, channel: n.channel ?? 'email' };
          return (
            <div
              key={n.offerId}
              className="grid items-center gap-2 sm:grid-cols-[1fr_10rem_12rem_auto]"
            >
              <span className="font-medium">{name(n.offerId)}</span>
              {editable ? (
                <>
                  <DateInput
                    aria-label={t('notifiedOn')}
                    value={v.date}
                    onChange={(d) =>
                      setValues((cur) => ({ ...cur, [n.offerId]: { ...v, date: d } }))
                    }
                  />
                  <Select
                    value={v.channel}
                    onValueChange={(c) =>
                      setValues((cur) => ({ ...cur, [n.offerId]: { ...v, channel: c } }))
                    }
                  >
                    <SelectTrigger aria-label={t('channel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVITATION_CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {ti(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={!v.date || record.isPending}
                    onClick={() =>
                      record.mutate({
                        notices: [
                          {
                            offerId: n.offerId,
                            notifiedOn: v.date!,
                            channel: v.channel as (typeof INVITATION_CHANNELS)[number],
                          },
                        ],
                      })
                    }
                  >
                    {t('record')}
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground sm:col-span-3">
                  {n.notifiedOn
                    ? `${formatDate(n.notifiedOn)} · ${n.channel ? ti(n.channel) : ''}`
                    : t('pending')}
                </span>
              )}
            </div>
          );
        })}
        {record.error ? <ErrorText>{apiError(record.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

export function AnalysisDetail({ id }: { id: string }) {
  const t = useTranslations('analysis');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const { data: analysis, error, isPending } = useAnalysis(id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !analysis)
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {analysis.number ?? t('draftNumber')}
            </h1>
            <DocStatusBadge status={analysis.status} namespace="analysis.status" />
          </div>
          <p className="text-muted-foreground">
            <Link
              href={`/procurement/rfqs/${analysis.sourcingEventId}`}
              className="hover:underline"
            >
              <span dir="ltr">{analysis.eventNumber}</span> · {analysis.eventTitle}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionsPanel
            slug="bid-analyses"
            doc={{
              ...analysis,
              currentStepOrder:
                analysis.steps.find((s) => s.status === 'pending')?.stepOrder ?? null,
            }}
          >
            <SignAndSubmit analysis={analysis} />
          </ActionsPanel>
        </div>
      </div>

      {analysis.validOfferCount < analysis.requiredMinQuotations ? (
        <p role="status" className="rounded-md border border-destructive/40 p-3 text-sm">
          {t('tooFewOffers', {
            count: analysis.validOfferCount,
            required: analysis.requiredMinQuotations,
          })}
          {analysis.waiverId ? ` ${t('waiverCovers')}` : ''}
        </p>
      ) : null}

      <CommitteePanel analysis={analysis} />
      <ComparisonTable analysis={analysis} />
      <ScoringGrid analysis={analysis} />
      <RecommendationForm analysis={analysis} />

      {analysis.steps.length > 0 ? (
        <StepsView
          cycle={Math.max(...analysis.steps.map((s) => s.cycle))}
          steps={analysis.steps}
          signatures={[]}
        />
      ) : null}
      <NoticesPanel analysis={analysis} />
      <DocHistoryTimeline slug="bid-analyses" id={analysis.id} />
    </div>
  );
}
