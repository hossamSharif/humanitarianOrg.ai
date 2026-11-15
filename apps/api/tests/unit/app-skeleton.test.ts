// The middleware chain without a database: token verification, tenant context, permissions,
// validation, idempotency and the error shape are exercised through a throwaway router.
import { PERMISSIONS } from '@ngo/shared';
import { Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { setTokenVerifier } from '../../src/middleware/auth';
import { AppError, fromPostgresError } from '../../src/middleware/error';
import type { IdempotencyStore, StoredResponse } from '../../src/middleware/idempotency';
import { requirePermission } from '../../src/middleware/permission';
import type { SessionContextLoader } from '../../src/middleware/tenant';
import { validate } from '../../src/middleware/validate';
import * as routes from '../../src/routes';
import { createApp } from '../../src/app';
import { TENANT_ID } from './helpers/builders';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function memoryStore(): IdempotencyStore & { saved: Map<string, StoredResponse> } {
  const saved = new Map<string, StoredResponse>();
  return {
    saved,
    find: async (ctx, key) => saved.get(`${ctx.tenantId}:${ctx.userId}:${key}`) ?? null,
    save: async (ctx, key, response) => {
      saved.set(`${ctx.tenantId}:${ctx.userId}:${key}`, response);
    },
    purgeExpired: async () => {},
  };
}

let counter = 0;
function testRouter(): Router {
  const router = Router();
  router.get('/things', requirePermission(PERMISSIONS.PR_READ), (_req, res) => {
    res.json({ data: [], page: 1, pageSize: 50, total: 0 });
  });
  router.post(
    '/things',
    requirePermission(PERMISSIONS.PR_CREATE),
    validate({ body: z.object({ name: z.string().min(1) }) }),
    (req, res) => {
      counter += 1;
      res.status(201).json({ id: `thing-${counter}`, name: req.body.name });
    }
  );
  router.get('/boom', () => {
    throw new Error('unexpected');
  });
  router.get('/budget', () => {
    throw Object.assign(new Error('BUDGET_EXCEEDED'), {
      code: 'P0001',
      detail: 'budget_line_id=x',
    });
  });
  return router;
}

const loadContext: SessionContextLoader = async (claims) => {
  const meta = claims.app_metadata as { tenant_id?: string } | undefined;
  if (meta?.tenant_id !== TENANT_ID) return null;
  return {
    membershipId: 'm-1',
    tenantId: TENANT_ID,
    orgWideAccess: false,
    permissions: ['pr:read', 'pr:create', 'not:a_permission'],
    officeIds: ['office-1'],
  };
};

function makeApp(store = memoryStore()) {
  vi.spyOn(routes, 'tenantRouter').mockReturnValue(testRouter());
  return {
    app: createApp({ loadSessionContext: loadContext, idempotencyStore: store }),
    store,
  };
}

beforeEach(() => {
  counter = 0;
  setTokenVerifier(async (token) => {
    if (token === 'good') {
      return { sub: USER_ID, role: 'authenticated', app_metadata: { tenant_id: TENANT_ID } };
    }
    if (token === 'no-tenant') return { sub: USER_ID, role: 'authenticated', app_metadata: {} };
    if (token === 'anon') return { role: 'anon' };
    throw new Error('bad token');
  });
});

afterEach(() => {
  setTokenVerifier(undefined);
  vi.restoreAllMocks();
});

describe('health and request id', () => {
  it('GET /health is public and returns status and version', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', version: expect.any(String) });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed X-Request-Id', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('authentication and tenant context', () => {
  it('401 without a token, with the standard error shape', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/things');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
  });

  it('401 for an invalid token and for a non-user (anon) token', async () => {
    const { app } = makeApp();
    for (const token of ['garbage', 'anon']) {
      const res = await request(app).get('/api/v1/things').set('Authorization', `Bearer ${token}`);
      expect(res.status, token).toBe(401);
    }
  });

  it('403 FORBIDDEN when the token has no active tenant', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/things').set('Authorization', 'Bearer no-tenant');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('passes with a tenant and the permission; unknown permission codes are dropped', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/things').set('Authorization', 'Bearer good');
    expect(res.status).toBe(200);
  });

  it('unknown routes are 404 NOT_FOUND in the standard shape', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/nope').set('Authorization', 'Bearer good');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('validation and errors', () => {
  it('400 VALIDATION_ERROR with field details', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/things')
      .set('Authorization', 'Bearer good')
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'name', message: expect.any(String) }],
    });
  });

  it('malformed JSON is a VALIDATION_ERROR, not a 500', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/things')
      .set('Authorization', 'Bearer good')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('unexpected errors become 500 INTERNAL_ERROR without leaking the message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/boom').set('Authorization', 'Bearer good');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  it('trigger errors named after an error code map to that code', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/budget').set('Authorization', 'Bearer good');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BUDGET_EXCEEDED');
  });

  it('maps common SQLSTATEs', () => {
    expect(
      fromPostgresError({ code: '42501', message: 'new row violates row-level security policy' })
        ?.code
    ).toBe('FORBIDDEN');
    expect(
      fromPostgresError({
        code: '23505',
        message: 'dup',
        constraint_name: 'office_tenant_id_code_key',
      })
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'office_tenant_id_code_key', message: 'already_exists' }],
    });
    expect(fromPostgresError({ code: 'P0001', message: 'OFFICE_CODE_IN_USE' })?.status).toBe(409);
    expect(fromPostgresError(new AppError('NOT_FOUND', 'x'))).toBeNull();
  });
});

describe('idempotency', () => {
  it('replays the stored response for the same key and body', async () => {
    const { app, store } = makeApp();
    const send = () =>
      request(app)
        .post('/api/v1/things')
        .set('Authorization', 'Bearer good')
        .set('Idempotency-Key', 'key-1')
        .send({ name: 'Kits' });

    const first = await send();
    expect(first.status).toBe(201);
    await vi.waitFor(() => expect(store.saved.size).toBe(1));

    const second = await send();
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(counter).toBe(1);
  });

  it('409 IDEMPOTENCY_KEY_REUSED for the same key with a different body', async () => {
    const { app, store } = makeApp();
    await request(app)
      .post('/api/v1/things')
      .set('Authorization', 'Bearer good')
      .set('Idempotency-Key', 'key-2')
      .send({ name: 'Kits' });
    await vi.waitFor(() => expect(store.saved.size).toBe(1));

    const res = await request(app)
      .post('/api/v1/things')
      .set('Authorization', 'Bearer good')
      .set('Idempotency-Key', 'key-2')
      .send({ name: 'Tents' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not store server errors, so a retry can succeed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, store } = makeApp();
    const res = await request(app)
      .get('/api/v1/boom')
      .set('Authorization', 'Bearer good')
      .set('Idempotency-Key', 'key-3');
    expect(res.status).toBe(500);
    expect(store.saved.size).toBe(0);
  });

  it('rejects malformed keys', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/things')
      .set('Authorization', 'Bearer good')
      .set('Idempotency-Key', 'has spaces!')
      .send({ name: 'Kits' });
    expect(res.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('429 RATE_LIMITED past the write budget', async () => {
    vi.spyOn(routes, 'tenantRouter').mockReturnValue(testRouter());
    const app = createApp({
      loadSessionContext: loadContext,
      idempotencyStore: memoryStore(),
      rateLimit: { writesPerMinute: 2 },
    });
    const post = () =>
      request(app).post('/api/v1/things').set('Authorization', 'Bearer good').send({ name: 'x' });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');
  });
});
