'use client';

// Multipart upload for POST /grants/:id/budget-lines/import. The JSON api client cannot send a
// file, so this sends FormData with the same Bearer token, Idempotency-Key and error parsing.
import { IMPORT_MAX_BYTES, isApiError, type ImportResult } from '@ngo/shared';
import { ApiRequestError } from '@/lib/api-client';
import { publicEnv } from '@/lib/env';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export const IMPORT_ACCEPT =
  '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export { IMPORT_MAX_BYTES };

export async function uploadBudgetLines(
  grantId: string,
  mode: 'preview' | 'commit',
  file: File
): Promise<ImportResult> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  const body = new FormData();
  body.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(
      `${publicEnv.apiBaseUrl.replace(/\/$/, '')}/grants/${grantId}/budget-lines/import?mode=${mode}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      }
    );
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network request failed');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as ImportResult;
  if (isApiError(payload)) {
    throw new ApiRequestError(response.status, payload.code, payload.message, payload.details);
  }
  throw new ApiRequestError(response.status, 'INTERNAL_ERROR', `HTTP ${response.status}`);
}
