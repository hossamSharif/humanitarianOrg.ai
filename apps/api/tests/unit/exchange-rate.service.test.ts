// T066 — exchange rates (FR-015): lookup by latest date then latest entry, in-use rates locked,
// missing rates, and the base currency's implied rate of 1.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { ExchangeRateService } from '../../src/services/exchange-rate.service';
import { FAKE_TX, FakeRateStore } from './helpers/funding-fakes';

let rates: FakeRateStore;
let service: ExchangeRateService;

beforeEach(() => {
  rates = new FakeRateStore();
  service = new ExchangeRateService({ rates });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe('lookup', () => {
  it('uses the latest rate_date on or before the document date', async () => {
    rates.add({ rateDate: '2026-10-01', rateToBase: '580' });
    const nov5 = rates.add({ rateDate: '2026-11-05', rateToBase: '600' });
    rates.add({ rateDate: '2026-11-20', rateToBase: '650' });

    expect(await service.lookup('USD', '2026-11-10')).toEqual({
      currency: 'USD',
      rateToBase: '600',
      rateDate: '2026-11-05',
      source: 'Central Bank of Sudan',
      exchangeRateId: nov5.id,
    });
  });

  it('a rate dated exactly on the document date applies', async () => {
    const r = rates.add({ rateDate: '2026-11-10' });
    expect((await service.lookup('USD', '2026-11-10')).exchangeRateId).toBe(r.id);
  });

  it('several rates on the same date: the latest entered wins', async () => {
    rates.add({ rateDate: '2026-11-05', rateToBase: '600' });
    const correction = rates.add({ rateDate: '2026-11-05', rateToBase: '605.5', source: 'fix' });
    expect(await service.lookup('USD', '2026-11-10')).toMatchObject({
      rateToBase: '605.5',
      exchangeRateId: correction.id,
    });
  });

  it('only the requested currency is considered', async () => {
    rates.add({ currency: 'EUR', rateDate: '2026-11-05', rateToBase: '650' });
    await expectAppError(service.lookup('USD', '2026-11-10'), 'NOT_FOUND');
  });

  it('the base currency resolves to rate 1 with source "base"', async () => {
    expect(await service.lookup('SDG', '2026-11-10')).toEqual({
      currency: 'SDG',
      rateToBase: '1',
      rateDate: '2026-11-10',
      source: 'base',
      exchangeRateId: null,
    });
  });
});

describe('resolveRate inside a PR command', () => {
  it('none on or before the date → EXCHANGE_RATE_MISSING with { currencies, date }', async () => {
    rates.add({ rateDate: '2026-11-20' });
    const error = await expectAppError(
      service.resolveRate(FAKE_TX, 'USD', '2026-11-10'),
      'EXCHANGE_RATE_MISSING'
    );
    expect(error.details).toEqual({ currencies: ['USD'], date: '2026-11-10' });
  });

  it('names every missing currency at once; base and found ones resolve', async () => {
    rates.add({ currency: 'USD', rateDate: '2026-11-01' });
    const error = await expectAppError(
      service.resolveRates(FAKE_TX, ['SDG', 'USD', 'EUR', 'GBP', 'EUR'], '2026-11-10'),
      'EXCHANGE_RATE_MISSING'
    );
    expect(error.details).toEqual({ currencies: ['EUR', 'GBP'], date: '2026-11-10' });

    const resolved = await service.resolveRates(FAKE_TX, ['SDG', 'USD'], '2026-11-10');
    expect(resolved.get('SDG')).toMatchObject({ rateToBase: '1', source: 'base' });
    expect(resolved.get('USD')).toMatchObject({ rateToBase: '600' });
  });
});

describe('create / update / delete', () => {
  it('a rate for the base currency is rejected', async () => {
    await expectAppError(
      service.create({ currency: 'SDG', rateToBase: '1', rateDate: '2026-11-01', source: 'x' }),
      'EXCHANGE_RATE_BASE_CURRENCY'
    );
    const r = rates.add();
    await expectAppError(service.update(r.id, { currency: 'SDG' }), 'EXCHANGE_RATE_BASE_CURRENCY');
  });

  it('a rate used by a PR cannot be edited or deleted → EXCHANGE_RATE_IN_USE', async () => {
    const used = rates.add({ inUse: true });
    await expectAppError(service.update(used.id, { rateToBase: '610' }), 'EXCHANGE_RATE_IN_USE');
    await expectAppError(service.remove(used.id), 'EXCHANGE_RATE_IN_USE');
    expect(rates.rows.find((r) => r.id === used.id)?.rateToBase).toBe('600');
  });

  it('unused rates may be edited and deleted', async () => {
    const r = rates.add();
    expect(await service.update(r.id, { rateToBase: '610.25' })).toMatchObject({
      rateToBase: '610.25',
      inUse: false,
    });
    await service.remove(r.id);
    expect(rates.rows).toHaveLength(0);
  });

  it('a correction is a new row; the list flags in-use rows', async () => {
    const used = rates.add({ rateDate: '2026-11-05', inUse: true });
    const created = await service.create({
      currency: 'USD',
      rateToBase: '601',
      rateDate: '2026-11-05',
      source: 'Correction',
    });
    const list = await service.list({ page: 1, pageSize: 50 });
    expect(list.total).toBe(2);
    expect(list.data.map((r) => [r.id, r.inUse])).toEqual([
      [created.id, false],
      [used.id, true],
    ]);
  });

  it('unknown id → NOT_FOUND', async () => {
    await expectAppError(service.remove(randomUUID()), 'NOT_FOUND');
  });
});
