// US1 routes without a database: permissions per contracts/rest-api.md, Zod validation and the
// status codes, with the services backed by in-memory stores.
import type { Permission } from '@ngo/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/middleware/error';
import { numberingRouter } from '../../src/routes/numbering.routes';
import { officesRouter } from '../../src/routes/offices.routes';
import { tenantBootstrapRouter, tenantProfileRouter } from '../../src/routes/tenant.routes';
import { unitsRouter } from '../../src/routes/units.routes';
import { NumberingService } from '../../src/services/numbering.service';
import { OfficeService } from '../../src/services/office.service';
import { TenantProfileService, TenantSetupService } from '../../src/services/tenant-setup.service';
import { UnitService } from '../../src/services/unit.service';
import { buildContext, TENANT_ID } from './helpers/builders';
import { InMemoryOfficeStore, InMemoryUnitStore } from './helpers/in-memory-office-store';
import {
  buildTenantRow,
  InMemoryNumberingStore,
  InMemoryTenantProfileStore,
  inMemorySetupDeps,
} from './helpers/in-memory-tenant-store';

function makeApp(permissions: Permission[]): { app: Express; offices: InMemoryOfficeStore } {
  const ctx = buildContext({ permissions: new Set(permissions) });
  const offices = new InMemoryOfficeStore(TENANT_ID);
  const units = new InMemoryUnitStore(TENANT_ID);
  const numbering = new InMemoryNumberingStore();
  numbering.addOffice('MAD');
  const profile = new InMemoryTenantProfileStore(buildTenantRow());

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = 'test';
    req.auth = {
      userId: ctx.userId,
      email: ctx.email,
      claims: ctx.claims,
      accessToken: ctx.accessToken,
    };
    req.ctx = ctx;
    next();
  });
  app.use(tenantBootstrapRouter(new TenantSetupService(inMemorySetupDeps().deps)));
  app.use(tenantProfileRouter(() => new TenantProfileService(ctx, profile)));
  app.use(officesRouter(() => new OfficeService(offices)));
  app.use(unitsRouter(() => new UnitService(units)));
  app.use(numberingRouter(() => new NumberingService(numbering)));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, offices };
}

const admin = () => makeApp(['settings:manage', 'pr:read']);
const member = () => makeApp(['pr:read', 'pr:create']);

describe('POST /tenants', () => {
  it('201 with the new tenant and sessionRefreshRequired', async () => {
    const res = await request(member().app)
      .post('/tenants')
      .send({ nameAr: 'منظمة', nameEn: 'Org' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantId: expect.any(String), sessionRefreshRequired: true });
  });

  it('400 without both names', async () => {
    const res = await request(member().app).post('/tenants').send({ nameEn: 'Org' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ field: 'nameAr', message: expect.any(String) }]);
  });
});

describe('/tenant', () => {
  it('members read; only settings:manage writes', async () => {
    expect((await request(member().app).get('/tenant')).status).toBe(200);
    expect((await request(member().app).patch('/tenant').send({ nameEn: 'X' })).status).toBe(403);
    const res = await request(admin().app).patch('/tenant').send({ nameEn: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('X');
  });

  it('validates ranges and requires at least one field', async () => {
    const { app } = admin();
    for (const body of [
      { maxBackdateDays: 366 },
      { fiscalYearStartMonth: 0 },
      { timezone: 'Nowhere/Land' },
      { baseCurrency: 'usd' },
      {},
    ]) {
      expect((await request(app).patch('/tenant').send(body)).status, JSON.stringify(body)).toBe(
        400
      );
    }
  });

  it('logo upload URL: settings:manage, image types, ≤ 2 MB', async () => {
    const { app } = admin();
    const ok = await request(app)
      .post('/tenant/logo-upload-url')
      .send({ mimeType: 'image/png', sizeBytes: 1024 });
    expect(ok.status).toBe(200);
    expect(ok.body.path).toMatch(new RegExp(`^${TENANT_ID}/logo-`));
    expect(
      (
        await request(app)
          .post('/tenant/logo-upload-url')
          .send({ mimeType: 'application/pdf', sizeBytes: 1024 })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/tenant/logo-upload-url')
          .send({ mimeType: 'image/png', sizeBytes: 3 * 1024 * 1024 })
      ).status
    ).toBe(400);
    expect(
      (
        await request(member().app)
          .post('/tenant/logo-upload-url')
          .send({ mimeType: 'image/png', sizeBytes: 1 })
      ).status
    ).toBe(403);
  });
});

describe('/offices', () => {
  it('creates (201), lists with ?active, patches; members cannot write', async () => {
    const { app } = admin();
    const created = await request(app)
      .post('/offices')
      .send({ code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/offices?active=true&page=1&pageSize=10');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 10, total: 1 });

    const patched = await request(app)
      .patch(`/offices/${created.body.id}`)
      .send({ isActive: false });
    expect(patched.body.isActive).toBe(false);

    expect(
      (
        await request(member().app)
          .post('/offices')
          .send({ code: 'KST', nameAr: 'كوستي', nameEn: 'Kosti' })
      ).status
    ).toBe(403);
  });

  it('400 on a bad code; 409 OFFICE_CODE_IN_USE when the office is used', async () => {
    const { app, offices } = admin();
    expect(
      (await request(app).post('/offices').send({ code: 'm', nameAr: 'م', nameEn: 'M' })).body
        .details[0].field
    ).toBe('code');

    const created = await request(app)
      .post('/offices')
      .send({ code: 'KST', nameAr: 'كوستي', nameEn: 'Kosti' });
    offices.inUse.add(created.body.id);
    const res = await request(app).patch(`/offices/${created.body.id}`).send({ code: 'KOS' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OFFICE_CODE_IN_USE');
  });

  it('has no DELETE route', async () => {
    const res = await request(admin().app).delete('/offices/00000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
  });
});

describe('/units', () => {
  it('creates and deactivates; validates the code', async () => {
    const { app } = admin();
    const created = await request(app)
      .post('/units')
      .send({ code: 'ROLL', nameAr: 'لفة', nameEn: 'Roll' });
    expect(created.status).toBe(201);
    const patched = await request(app).patch(`/units/${created.body.id}`).send({ isActive: false });
    expect(patched.body.isActive).toBe(false);
    expect(
      (await request(app).post('/units').send({ code: 'has space', nameAr: 'س', nameEn: 'X' }))
        .status
    ).toBe(400);
  });
});

describe('/numbering/:docType', () => {
  it('GET returns config + preview; requires settings:manage', async () => {
    const res = await request(admin().app).get('/numbering/PR');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ docType: 'PR', prefix: 'PR', padding: 4 });
    expect(res.body.preview).toMatch(/^PR-MAD-\d{4}-0001$/);
    expect((await request(member().app).get('/numbering/PR')).status).toBe(403);
  });

  it('PUT saves and previews; rejects unknown doc types and bad padding', async () => {
    const { app } = admin();
    const body = {
      prefix: 'RQ',
      includeOffice: false,
      includeYear: true,
      padding: 3,
      separator: '/',
    };
    const res = await request(app).put('/numbering/PR').send(body);
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatch(/^RQ\/\d{4}\/001$/);
    expect((await request(app).put('/numbering/PO').send(body)).status).toBe(400);
    expect(
      (
        await request(app)
          .put('/numbering/PR')
          .send({ ...body, padding: 0 })
      ).status
    ).toBe(400);
  });
});
