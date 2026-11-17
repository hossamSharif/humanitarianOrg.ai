'use client';

import { PERMISSIONS_002 } from '@ngo/shared';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@ngo/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  useCategories,
  useDeductionTypes,
  useMethodBands,
  useProcurementSettings,
} from '@/features/procurement-settings/api';
import { BandsEditor } from '@/features/procurement-settings/bands-editor';
import { CategoriesTable } from '@/features/procurement-settings/categories-table';
import { DeductionsTable } from '@/features/procurement-settings/deductions-table';
import { ProcurementSettingsForm } from '@/features/procurement-settings/settings-form';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';

function Loaded<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  if (query.isPending) return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  if (query.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {apiError(query.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

/** Procurement configuration (002 US1): settings, method bands, deductions, categories. */
export default function ProcurementSettingsPage() {
  const t = useTranslations('procurement');
  const tErrors = useTranslations('errors');
  const can = useHasPermission();
  const canRead = can(PERMISSIONS_002.PROCUREMENT_READ, PERMISSIONS_002.PROCUREMENT_CONFIGURE);
  const canConfigure = can(PERMISSIONS_002.PROCUREMENT_CONFIGURE);
  const canManageAccounts = can(PERMISSIONS_002.ACCOUNTS_MANAGE);

  const settings = useProcurementSettings();
  const bands = useMethodBands();
  const deductions = useDeductionTypes();
  const paymentCategories = useCategories('payment');
  const supplierCategories = useCategories('supplier');

  if (!canRead) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {tErrors('FORBIDDEN')}
      </p>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="general">{t('tabs.general')}</TabsTrigger>
          <TabsTrigger value="bands">{t('tabs.bands')}</TabsTrigger>
          <TabsTrigger value="deductions">{t('tabs.deductions')}</TabsTrigger>
          <TabsTrigger value="payment-categories">{t('tabs.paymentCategories')}</TabsTrigger>
          <TabsTrigger value="supplier-categories">{t('tabs.supplierCategories')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="pt-4">
          <Loaded query={settings}>
            {(data) => (
              <ProcurementSettingsForm key={data.version} settings={data} canEdit={canConfigure} />
            )}
          </Loaded>
        </TabsContent>

        <TabsContent value="bands" className="pt-4">
          <Loaded query={bands}>
            {(data) => (
              <BandsEditor key={JSON.stringify(data.bands)} set={data} canEdit={canConfigure} />
            )}
          </Loaded>
        </TabsContent>

        <TabsContent value="deductions" className="pt-4">
          <Loaded query={deductions}>
            {(data) => <DeductionsTable deductions={data.data} canEdit={canManageAccounts} />}
          </Loaded>
        </TabsContent>

        <TabsContent value="payment-categories" className="pt-4">
          <Loaded query={paymentCategories}>
            {(data) => (
              <CategoriesTable kind="payment" categories={data.data} canEdit={canConfigure} />
            )}
          </Loaded>
        </TabsContent>

        <TabsContent value="supplier-categories" className="pt-4">
          <Loaded query={supplierCategories}>
            {(data) => (
              <CategoriesTable kind="supplier" categories={data.data} canEdit={canConfigure} />
            )}
          </Loaded>
        </TabsContent>
      </Tabs>
    </div>
  );
}
