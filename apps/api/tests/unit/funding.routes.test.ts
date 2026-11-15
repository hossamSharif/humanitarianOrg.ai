// US2 routers without a database: permission gates, Zod validation, response shapes and the
// multipart import, wired to the real services over in-memory stores.
import { PERMISSIONS, type Permission } from '@ngo/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error';
import { budgetLinesRouter } from '../../src/routes/budget-lines.routes';
import { donorsRouter } from '../../src/routes/donors.routes';
import { exchangeRatesRouter } from '../../src/routes/exchange-rates.routes';
import { grantsRouter } from '../../src/routes/grants.routes';
import { BudgetImportService } from '../../src/services/budget-import.service';
import { BudgetService } from '../../src/services/budget.service';
import { ExchangeRateService } from '../../src/services/exchange-rate.service';
import { GrantService } from '../../src/services/grant.service';
import { MAD_OFFICE_ID, buildContext } from './helpers/builders';
import {
  FakeBudgetLedger,
  FakeDonorStore,
  FakeGrantStore,
  FakeRateStore,
  buildDonor,
  buildGrant,
  buildLine,
  runFakeTx,
} from './helpers/funding-fakes';

let donors: FakeDonorStore;
let grants: FakeGrantStore;
let ledger: FakeBudgetLedger;
let rates: FakeRateStore;

function makeApp(permissions: Permission[]): Express {
  const ctx = buildContext({ permissions: new Set(permissions) });
  const grantService = () => new GrantService({ donors, grants });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use(donorsRouter(grantService));
  app.use(grantsRouter(grantService));
  app.use(
    budgetLinesRouter(
      () => new BudgetService({ grants, lines: ledger, txStore: ledger, runTx: runFakeTx }),
      () => new BudgetImportService({ grants, lines: ledger })
    )
  );
  app.use(exchangeRatesRouter(() => new ExchangeRateService({ rates })));
  app.use(errorHandler);
  return app;
}

const MANAGER: Permission[] = [PERMISSIONS.GRANTS_MANAGE, PERMISSIONS.RATES_MANAGE];
const donor = buildDonor();

beforeEach(() => {
  donors = new FakeDonorStore().seed(donor);
  grants = new FakeGrantStore();
  ledger = new FakeBudgetLedger();
  rates = new FakeRateStore();
});

describe('permissions', () => {
  it('members read; writes need grants:manage / rates:manage', async () => {
    const member = makeApp([PERMISSIONS.PR_READ]);
    expect((await request(member).get('/donors')).status).toBe(200);
    expect((await request(member).get('/grants')).status).toBe(200);
    expect((await request(member).post('/donors').send({ name: 'UNICEF' })).body.code).toBe(
      'FORBIDDEN'
    );
    expect(
      (
        await request(member)
          .post('/exchange-rates')
          .send({ currency: 'USD', rateToBase: '600', rateDate: '2026-11-01', source: 'CBoS' })
      ).status
    ).toBe(403);
  });
});

describe('grants', () => {
  const body = () => ({
    donorId: donor.id,
    code: 'ADRA-2026-01',
    name: 'Madani WASH',
    currency: 'USD',
    totalAmount: '50000.00',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    officeIds: [MAD_OFFICE_ID],
  });

  it('POST validates with the shared schema (money as string, end not before start)', async () => {
    const app = makeApp(MANAGER);
    const numeric = await request(app)
      .post('/grants')
      .send({ ...body(), totalAmount: 50000 });
    expect(numeric.status).toBe(400);
    expect(numeric.body.details).toEqual([{ field: 'totalAmount', message: expect.any(String) }]);

    const period = await request(app)
      .post('/grants')
      .send({ ...body(), endDate: '2025-12-31' });
    expect(period.body.details).toEqual([{ field: 'endDate', message: expect.any(String) }]);
  });

  it('create, then status change asks for confirmation when PRs are pending', async () => {
    const app = makeApp(MANAGER);
    const created = await request(app).post('/grants').send(body());
    expect(created.status).toBe(201);
    grants.pending.set(created.body.id, 2);

    const first = await request(app)
      .post(`/grants/${created.body.id}/status`)
      .send({ status: 'suspended', expectedVersion: 1 });
    expect(first.body).toEqual({ requiresConfirmation: true, pendingPrCount: 2 });

    const confirmed = await request(app)
      .post(`/grants/${created.body.id}/status`)
      .send({ status: 'suspended', expectedVersion: 1, confirmPendingCount: 2 });
    expect(confirmed.body).toMatchObject({
      requiresConfirmation: false,
      grant: { status: 'suspended', version: 2 },
    });
  });

  it('selectableFor=pr requires prDate and officeId', async () => {
    const app = makeApp([]);
    expect((await request(app).get('/grants?selectableFor=pr')).status).toBe(400);
    grants.seed(buildGrant({ code: 'OK' }), buildGrant({ code: 'CLOSED', status: 'closed' }));
    const res = await request(app).get(
      `/grants?selectableFor=pr&prDate=2026-11-10&officeId=${MAD_OFFICE_ID}`
    );
    expect(res.body.data.map((g: { code: string }) => g.code)).toEqual(['OK']);
  });
});

describe('budget lines', () => {
  it('GET returns decimal-string figures and the summary', async () => {
    const grant = buildGrant({ totalAmount: '12000.00' });
    grants.seed(grant);
    const line = buildLine({ grantId: grant.id, budgetAmount: '10000.00' });
    ledger.seedLines(line);
    ledger.hold(line.id, '2500.00');

    const res = await request(makeApp([])).get(`/grants/${grant.id}/budget-lines`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      budget: '10000.00',
      reserved: '2500.00',
      committed: '0.00',
      actual: '0.00',
      available: '7500.00',
      pctUsed: '25.00',
    });
    expect(res.body.summary).toMatchObject({ difference: '2000.00', hasDifference: true });
  });

  it('PATCH below usage → 422 BUDGET_BELOW_USAGE with the minimum', async () => {
    const grant = buildGrant();
    grants.seed(grant);
    const line = buildLine({ grantId: grant.id });
    ledger.seedLines(line);
    ledger.hold(line.id, '4000.00', 'committed');
    const res = await request(makeApp(MANAGER))
      .patch(`/budget-lines/${line.id}`)
      .send({ budgetAmount: '3000.00', expectedVersion: 1 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'BUDGET_BELOW_USAGE', details: { minimum: '4000.00' } });
  });

  it('multipart import: preview reports, commit creates valid rows only', async () => {
    const grant = buildGrant();
    grants.seed(grant);
    const app = makeApp(MANAGER);
    const csv = Buffer.from(
      'code,description,category,amount\n2.2.31,Training,services,1500\nX,Bad,toys,1\n'
    );

    const preview = await request(app)
      .post(`/grants/${grant.id}/budget-lines/import?mode=preview`)
      .attach('file', csv, { filename: 'lines.csv', contentType: 'text/csv' });
    expect(preview.status).toBe(200);
    expect(preview.body.validRows).toHaveLength(1);
    expect(preview.body.invalidRows[0].errors).toEqual([
      { column: 'category', code: 'invalid_category' },
    ]);
    expect(ledger.lines.size).toBe(0);

    const commit = await request(app)
      .post(`/grants/${grant.id}/budget-lines/import?mode=commit`)
      .attach('file', csv, { filename: 'lines.csv', contentType: 'text/csv' });
    expect(commit.status).toBe(201);
    expect(commit.body.created).toBe(1);
    expect([...ledger.lines.values()].map((l) => l.code)).toEqual(['2.2.31']);
  });

  it('import without a file or with a bad mode → 400', async () => {
    const grant = buildGrant();
    grants.seed(grant);
    const app = makeApp(MANAGER);
    const noFile = await request(app).post(`/grants/${grant.id}/budget-lines/import?mode=preview`);
    expect(noFile.body).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'file' }] });
    expect(
      (await request(app).post(`/grants/${grant.id}/budget-lines/import?mode=go`)).status
    ).toBe(400);
  });
});

describe('exchange rates', () => {
  it('lookup is not mistaken for an id; in-use rates refuse DELETE with 409', async () => {
    rates.add({ rateDate: '2026-11-01', rateToBase: '600' });
    const used = rates.add({ rateDate: '2026-10-01', inUse: true });
    const app = makeApp(MANAGER);

    const lookup = await request(app).get('/exchange-rates/lookup?currency=USD&date=2026-11-10');
    expect(lookup.body).toMatchObject({ rateToBase: '600', rateDate: '2026-11-01' });

    const del = await request(app).delete(`/exchange-rates/${used.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('EXCHANGE_RATE_IN_USE');
  });
});
