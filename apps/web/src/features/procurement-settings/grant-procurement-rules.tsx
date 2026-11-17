'use client';

import { useTranslations } from 'next-intl';
import { useApiError } from '@/lib/use-api-error';
import { useMethodBands } from './api';
import { BandsEditor } from './bands-editor';

/** A grant's stricter procurement bands (FR-003); empty = the organization's bands apply. */
export function GrantProcurementRules({ grantId }: { grantId: string }) {
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const bands = useMethodBands(grantId);

  if (bands.isPending) return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  if (bands.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiError(bands.error)}
      </p>
    );
  }
  return (
    <BandsEditor
      key={JSON.stringify(bands.data.bands)}
      set={bands.data}
      grantId={grantId}
      canEdit
    />
  );
}
