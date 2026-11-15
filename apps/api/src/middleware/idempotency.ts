// Idempotency-Key for every mutation (contracts/rest-api.md). Same key + same request → the stored
// response is replayed; same key + different request → 409 IDEMPOTENCY_KEY_REUSED. Keys are scoped
// to (tenant, user) and kept for 24 h. Requires the tenant context.
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { withTenantTx, type TxContext } from '../db/tx';
import type { RequestContext } from '../types/context';
import { AppError } from './error';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_FORMAT = /^[A-Za-z0-9_-]{1,255}$/;
const PURGE_PROBABILITY = 0.01;

export interface StoredResponse {
  requestHash: string;
  statusCode: number;
  body: unknown;
}

export interface IdempotencyStore {
  find(ctx: RequestContext, key: string): Promise<StoredResponse | null>;
  save(ctx: RequestContext, key: string, response: StoredResponse): Promise<void>;
  purgeExpired(ctx: RequestContext): Promise<void>;
}

const txContext = (ctx: RequestContext): TxContext => ({
  claims: ctx.claims,
  requestId: ctx.requestId,
});

export const dbIdempotencyStore: IdempotencyStore = {
  find: (ctx, key) =>
    withTenantTx(txContext(ctx), async ({ sql }) => {
      const [row] = await sql<
        { request_hash: string; status_code: number; response_json: unknown }[]
      >`
        select request_hash, status_code, response_json
        from public.idempotency_key
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId} and key = ${key}
          and created_at > now() - interval '24 hours'`;
      return row
        ? { requestHash: row.request_hash, statusCode: row.status_code, body: row.response_json }
        : null;
    }),

  save: (ctx, key, response) =>
    withTenantTx(txContext(ctx), async ({ sql }) => {
      await sql`
        insert into public.idempotency_key
          (tenant_id, user_id, key, request_hash, status_code, response_json)
        values (${ctx.tenantId}, ${ctx.userId}, ${key}, ${response.requestHash},
                ${response.statusCode}, ${sql.json((response.body ?? null) as never)})
        on conflict (tenant_id, user_id, key) do nothing`;
    }),

  purgeExpired: (ctx) =>
    withTenantTx(txContext(ctx), async ({ sql }) => {
      await sql`
        delete from public.idempotency_key
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}
          and created_at < now() - interval '24 hours'`;
    }),
};

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

export function idempotency(store: IdempotencyStore = dbIdempotencyStore): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!MUTATING.has(req.method) || !key) {
      next();
      return;
    }

    try {
      if (!KEY_FORMAT.test(key)) {
        throw new AppError('VALIDATION_ERROR', 'Invalid Idempotency-Key', [
          { field: 'Idempotency-Key', message: 'invalid_format' },
        ]);
      }
      const ctx = req.ctx;
      if (!ctx) throw new AppError('FORBIDDEN', 'No tenant context');

      const hash = requestHash(req.method, req.originalUrl, req.body);
      const stored = await store.find(ctx, key);
      if (stored) {
        if (stored.requestHash !== hash) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency-Key was already used for a different request'
          );
        }
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(stored.statusCode).json(stored.body);
        return;
      }

      // Capture the response body; store it once the response is sent. Server errors and rate
      // limits are not stored so a retry with the same key can still succeed.
      const json = res.json.bind(res);
      res.json = (body: unknown) => {
        res.locals.idempotencyBody = body;
        return json(body);
      };
      res.on('finish', () => {
        if (res.statusCode >= 500 || res.statusCode === 429) return;
        store
          .save(ctx, key, {
            requestHash: hash,
            statusCode: res.statusCode,
            body: res.locals.idempotencyBody ?? null,
          })
          .catch((err: unknown) => console.error(`[${ctx.requestId}] idempotency save`, err));
        if (Math.random() < PURGE_PROBABILITY) {
          store.purgeExpired(ctx).catch(() => {});
        }
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}
