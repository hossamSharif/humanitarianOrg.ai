'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiRequestError } from './api-client';

/** Localized message for any error thrown by the API client (rendered by `errors.<code>`). */
export function useApiError() {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown): string => {
      const code = error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR';
      return t.has(code) ? t(code) : t('INTERNAL_ERROR');
    },
    [t]
  );
}
