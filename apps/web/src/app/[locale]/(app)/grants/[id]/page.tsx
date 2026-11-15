'use client';

import { PERMISSIONS, formatDate } from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivitiesTable } from '@/features/grants/activities-table';
import { useDonors, useGrant, useOffices } from '@/features/grants/api';
import { BudgetLinesTable } from '@/features/grants/budget-lines-table';
import { GrantForm } from '@/features/grants/grant-form';
import { GrantStatusDialog } from '@/features/grants/grant-status-dialog';
import {
  Amount,
  ErrorText,
  GrantStatusBadge,
  WarningBanner,
  useLocalizedName,
} from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function GrantDetailPage({ params }: { params: { id: string } }) {
  const t = useTranslations('grants');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const can = useHasPermission();
  const { data: grant, error, isPending } = useGrant(params.id);
  const donors = useDonors();
  const offices = useOffices();
  const [editing, setEditing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const donor = useMemo(
    () => donors.data?.data.find((d) => d.id === grant?.donorId),
    [donors.data, grant?.donorId]
  );
  const officeLabels = useMemo(() => {
    const byId = new Map((offices.data ?? []).map((o) => [o.id, o]));
    return (grant?.officeIds ?? []).map((id) => {
      const o = byId.get(id);
      return o ? `${o.code} · ${localized(o)}` : id;
    });
  }, [offices.data, grant?.officeIds, localized]);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !grant) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const canManage = can(PERMISSIONS.GRANTS_MANAGE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/grants" className="text-sm text-muted-foreground hover:underline">
            {t('backToList')}
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            <span dir="ltr">{grant.code}</span>
            <GrantStatusBadge status={grant.status} />
          </h1>
          <p className="text-muted-foreground">{grant.name}</p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setChangingStatus(true)}>
              {t('changeStatus')}
            </Button>
            <Button onClick={() => setEditing(true)}>{t('edit')}</Button>
          </div>
        ) : null}
      </div>

      {grant.hasDifference ? (
        <WarningBanner>
          {t('differenceWarning')} <Amount value={grant.difference} currency={grant.currency} />
        </WarningBanner>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Item label={t('donor')}>{donor?.name ?? '—'}</Item>
            <Item label={t('currency')}>{grant.currency}</Item>
            <Item label={t('totalAmount')}>
              <Amount value={grant.totalAmount} currency={grant.currency} />
            </Item>
            <Item label={t('budgetLinesTotal')}>
              <Amount value={grant.budgetLinesTotal} currency={grant.currency} />
            </Item>
            <Item label={t('period')}>
              <span dir="ltr" className="tabular-nums">
                {formatDate(grant.startDate)} – {formatDate(grant.endDate)}
              </span>
            </Item>
            <Item label={t('offices')}>
              <span className="flex flex-wrap gap-1">
                {officeLabels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </span>
            </Item>
            <Item label={t('pendingPrs')}>
              <span className="tabular-nums">{grant.pendingPrCount}</span>
            </Item>
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="budget-lines">
        <TabsList>
          <TabsTrigger value="budget-lines">{t('tabs.budgetLines')}</TabsTrigger>
          <TabsTrigger value="activities">{t('tabs.activities')}</TabsTrigger>
        </TabsList>
        <TabsContent value="budget-lines" className="space-y-2">
          <div className="flex justify-end">
            <Link
              href={`/grants/${grant.id}/budget-lines`}
              className="text-sm text-primary hover:underline"
            >
              {t('openBudgetLines')}
            </Link>
          </div>
          <BudgetLinesTable grantId={grant.id} />
        </TabsContent>
        <TabsContent value="activities">
          <ActivitiesTable grantId={grant.id} />
        </TabsContent>
      </Tabs>

      <GrantForm
        open={editing}
        onOpenChange={setEditing}
        grant={grant}
        currencyLocked={grant.currencyLocked}
      />
      <GrantStatusDialog open={changingStatus} onOpenChange={setChangingStatus} grant={grant} />
    </div>
  );
}
