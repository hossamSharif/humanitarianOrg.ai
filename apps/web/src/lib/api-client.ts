// Fetch wrapper for /api/v1: Bearer token from the Supabase session, one Idempotency-Key per
// logical mutation (kept across retries), and `{ code, message, details }` errors as
// ApiRequestError.
import { isApiError, type ErrorCode } from '@ngo/shared';
import { publicEnv } from './env';
import { getSupabaseBrowserClient } from './supabase/client';

/** Client-side code for a request that never reached the API. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  query?: Record<string, string | number | boolean | readonly string[] | null | undefined>;
  body?: unknown;
  /** Reuse the same key when retrying the same logical mutation. Generated when omitted. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Network failures and 5xx responses are retried with the same key (mutations included). */
  retries?: number;
}

const RETRY_DELAYS_MS = [400, 1500];

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = new URL(`${publicEnv.apiBaseUrl.replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function accessToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiRequest<T>(
  method: Method,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const mutating = method !== 'GET';
  const idempotencyKey = mutating ? (options.idempotencyKey ?? crypto.randomUUID()) : undefined;
  const maxRetries = options.retries ?? 2;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      const token = await accessToken();
      response = await fetch(buildUrl(path, options.query), {
        method,
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (attempt < maxRetries) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }
      throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network request failed');
    }

    if (response.status >= 500 && attempt < maxRetries) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
      continue;
    }

    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return payload as T;

    if (isApiError(payload)) {
      throw new ApiRequestError(response.status, payload.code, payload.message, payload.details);
    }
    throw new ApiRequestError(response.status, 'INTERNAL_ERROR', `HTTP ${response.status}`);
  }
}

/** GET a file (e.g. an Excel export) with the session token; errors as ApiRequestError. */
export async function apiDownload(
  path: string,
  query?: RequestOptions['query']
): Promise<{ blob: Blob; fileName: string | null }> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network request failed');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (isApiError(payload)) {
      throw new ApiRequestError(response.status, payload.code, payload.message, payload.details);
    }
    throw new ApiRequestError(response.status, 'INTERNAL_ERROR', `HTTP ${response.status}`);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await response.blob(), fileName };
}

/** Saves a blob through a temporary link. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'idempotencyKey'>) =>
    apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>('DELETE', path, options),
};
