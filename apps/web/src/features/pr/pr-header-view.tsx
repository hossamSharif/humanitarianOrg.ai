'use client';

// Read-only PR header: dates as DD/MM/YYYY, offices, grant, activity, and — once submitted — the
// locked grant and DoA amounts with the rate, date and source they used (FR-028).
import { formatAmount, formatDate, type PrDetail } from '@ngo/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useOffices } from '@/features/grants/api';
import { useGrantActivities, usePrGrant } from './api';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? '—'}</dd>
    </div>
  );
}

export function PrHeaderView({ pr }: { pr: PrDetail }) {
  const t = useTranslations('pr.form');
  const tv = useTranslations('pr.view');
  const locale = useLocale();
  const offices = useOffices();
  const grant = usePrGrant(pr.grantId);
  const activities = useGrantActivities(pr.grantId);

  const office = (id: string | null) => {
    const o = offices.data?.find((x) => x.id === id);
    return o ? `${o.code} · ${locale === 'ar' ? o.nameAr : o.nameEn}` : null;
  };
  const activity = activities.data?.find((a) => a.id === pr.activityId);

  return (
    <section aria-labelledby="pr-header-view" className="space-y-4 rounded-lg border bg-card p-4">
      <h2 id="pr-header-view" className="text-lg font-semibold">
        {t('headerTitle')}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item label={t('prDate')}>{formatDate(pr.prDate) || null}</Item>
        <Item label={t('requestingOffice')}>{office(pr.requestingOfficeId)}</Item>
        <Item label={t('grant')}>
          {grant.data ? `${grant.data.code} · ${grant.data.name}` : null}
        </Item>
        <Item label={t('deliverTo')}>{office(pr.deliverToOfficeId)}</Item>
        <Item label={t('deliveryAddress')}>{pr.deliveryAddress}</Item>
        <Item label={t('contactName')}>{pr.contactName}</Item>
        <Item label={t('contactPhone')}>
          {pr.contactPhone ? <span dir="ltr">{pr.contactPhone}</span> : null}
        </Item>
        <Item label={t('requiredBy')}>{formatDate(pr.requiredByDate) || null}</Item>
        <Item label={t('prType')}>{pr.prType ? t(`types.${pr.prType}`) : null}</Item>
        <Item label={t('activity')}>{activity ? `${activity.code} · ${activity.name}` : null}</Item>
        <Item label={tv('requester')}>
          {pr.requesterName
            ? `${pr.requesterName}${pr.requesterPosition ? ` — ${pr.requesterPosition}` : ''}`
            : null}
        </Item>
        <div className="sm:col-span-2 lg:col-span-3">
          <Item label={t('purpose')}>
            {pr.purpose ? <span className="whitespace-pre-line">{pr.purpose}</span> : null}
          </Item>
        </div>
      </dl>

      {pr.totalGrantCurrency && pr.grantCurrency ? (
        <dl className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <Item label={tv('totalGrantCurrency')}>
            <span dir="ltr" className="font-semibold tabular-nums">
              {formatAmount({ amount: pr.totalGrantCurrency, currency: pr.grantCurrency })}
            </span>
            {pr.grantRateToBase && pr.grantRateSource !== 'base' ? (
              <span className="block text-xs text-muted-foreground">
                {tv('rateUsed', {
                  rate: pr.grantRateToBase,
                  date: formatDate(pr.grantRateDate),
                  source: pr.grantRateSource ?? '',
                })}
              </span>
            ) : null}
          </Item>
          {pr.doaAmount && pr.doaCurrency ? (
            <Item label={tv('doaAmount')}>
              <span dir="ltr" className="tabular-nums">
                {formatAmount({ amount: pr.doaAmount, currency: pr.doaCurrency })}
              </span>
            </Item>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
