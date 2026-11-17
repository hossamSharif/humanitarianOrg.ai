'use client';

// The procurement method the RFQ's lines require (002 US3-1, research D4): the estimated value
// from the PRs' locked rates, the tenant and grant bands used, the required method and minimum
// quotations, and the chosen method. The snapshot never follows later configuration edits.
import { METHOD_RANK, type MethodBand, type SourcingEventDetail } from '@ngo/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { Amount, WarningBanner } from '@/features/grants/shared';

function BandText({ band, currency }: { band: MethodBand; currency: string }) {
  const t = useTranslations('sourcing.method');
  const tm = useTranslations('sourcing.methods');
  return (
    <span>
      {tm(band.method)} ·{' '}
      <span dir="ltr" className="tabular-nums">
        {t('range', {
          min: band.minAmount ?? '0',
          max: band.maxAmount ?? '∞',
          currency,
        })}
      </span>{' '}
      · {t('minQuotations', { count: band.minQuotations })}
    </span>
  );
}

export function MethodPanel({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.method');
  const tm = useTranslations('sourcing.methods');
  const { method } = event;
  const below = METHOD_RANK[method.chosenMethod] < METHOD_RANK[method.requiredMethod];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('estimatedValue')}</dt>
            <dd className="font-medium">
              <Amount value={method.estimatedValue} currency={method.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('required')}</dt>
            <dd className="font-medium">
              {tm(method.requiredMethod)} ·{' '}
              {t('minQuotations', { count: method.requiredMinQuotations })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('chosen')}</dt>
            <dd className="font-medium">{tm(method.chosenMethod)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('tenantBand')}</dt>
            <dd>
              <BandText band={method.bandsUsed.tenant} currency={method.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('grantBand')}</dt>
            <dd>
              {method.bandsUsed.grant ? (
                <BandText band={method.bandsUsed.grant} currency={method.currency} />
              ) : (
                t('noGrantRule')
              )}
            </dd>
          </div>
        </dl>
        {below ? <WarningBanner>{t('belowRequired')}</WarningBanner> : null}
        {event.splittingWarning ? (
          <WarningBanner>
            {t('splitting', {
              count: event.splittingWarning.prIds.length,
              total: event.splittingWarning.total,
              max: event.splittingWarning.bandMax,
              currency: method.currency,
            })}
            {event.splittingAcknowledged ? ` ${t('splittingAcknowledged')}` : null}
          </WarningBanner>
        ) : null}
      </CardContent>
    </Card>
  );
}
