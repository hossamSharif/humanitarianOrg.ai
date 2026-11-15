// Manual exchange rates (FR-015, research R7). A rate used by any PR is read-only — corrections
// are new rows — and the base currency never takes a rate: it resolves to 1 with source 'base'.
import type {
  ExchangeRate,
  ExchangeRateCreate,
  ExchangeRateListQuery,
  ExchangeRateUpdate,
  ListResponse,
  ResolvedRate,
} from '@ngo/shared';
import type { TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  ExchangeRateRepository,
  type ExchangeRateStore,
  type RateRow,
} from '../repositories/exchange-rate.repository';
import type { RequestContext } from '../types/context';

export interface ExchangeRateDeps {
  rates: ExchangeRateStore;
}

function baseRate(currency: string, date: string): ResolvedRate {
  return { currency, rateToBase: '1', rateDate: date, source: 'base', exchangeRateId: null };
}

function toResolved(row: RateRow): ResolvedRate {
  return {
    currency: row.currency,
    rateToBase: row.rateToBase,
    rateDate: row.rateDate,
    source: row.source,
    exchangeRateId: row.id,
  };
}

export class ExchangeRateService {
  constructor(private readonly deps: ExchangeRateDeps) {}

  static forContext(ctx: RequestContext): ExchangeRateService {
    return new ExchangeRateService({ rates: new ExchangeRateRepository(ctx) });
  }

  async list(query: ExchangeRateListQuery): Promise<ListResponse<ExchangeRate>> {
    const { page, pageSize, sort, currency, from, to } = query;
    const result = await this.deps.rates.list({ currency, from, to }, { page, pageSize }, sort);
    const inUse = await this.deps.rates.inUseIds(result.data.map((r) => r.id));
    return { ...result, data: result.data.map((r) => ({ ...r, inUse: inUse.has(r.id) })) };
  }

  async get(id: string): Promise<ExchangeRate> {
    const row = await this.getRow(id);
    const inUse = await this.deps.rates.inUseIds([id]);
    return { ...row, inUse: inUse.has(id) };
  }

  async create(input: ExchangeRateCreate): Promise<ExchangeRate> {
    await this.assertNotBase(input.currency);
    const row = await this.deps.rates.insert(input);
    return { ...row, inUse: false };
  }

  async update(id: string, input: ExchangeRateUpdate): Promise<ExchangeRate> {
    await this.getRow(id);
    await this.assertNotInUse(id);
    if (input.currency) await this.assertNotBase(input.currency);
    const row = await this.deps.rates.update(id, input);
    return { ...row, inUse: false };
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    await this.assertNotInUse(id);
    await this.deps.rates.delete(id);
  }

  /** GET /exchange-rates/lookup: the rate a document dated `date` would use, or 404. */
  async lookup(currency: string, date: string): Promise<ResolvedRate> {
    if (currency === (await this.deps.rates.baseCurrency())) return baseRate(currency, date);
    const row = await this.deps.rates.latestOnOrBefore(currency, date);
    if (!row) throw new AppError('NOT_FOUND', `No ${currency} rate on or before ${date}`);
    return toResolved(row);
  }

  /** Inside a PR command: the rate to copy onto the document, or 422 EXCHANGE_RATE_MISSING. */
  async resolveRate(tx: TenantTx, currency: string, date: string): Promise<ResolvedRate> {
    const rates = await this.resolveRates(tx, [currency], date);
    return rates.get(currency)!;
  }

  /** Every currency at once, so the error names all missing currencies. */
  async resolveRates(
    tx: TenantTx,
    currencies: readonly string[],
    date: string
  ): Promise<Map<string, ResolvedRate>> {
    const base = await this.deps.rates.baseCurrency(tx);
    const resolved = new Map<string, ResolvedRate>();
    const missing: string[] = [];
    for (const currency of new Set(currencies)) {
      if (currency === base) {
        resolved.set(currency, baseRate(currency, date));
        continue;
      }
      const row = await this.deps.rates.latestOnOrBefore(currency, date, tx);
      if (row) resolved.set(currency, toResolved(row));
      else missing.push(currency);
    }
    if (missing.length) {
      throw new AppError('EXCHANGE_RATE_MISSING', `No exchange rate for ${missing.join(', ')}`, {
        currencies: missing,
        date,
      });
    }
    return resolved;
  }

  private async getRow(id: string): Promise<RateRow> {
    const row = await this.deps.rates.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'exchange_rate not found');
    return row;
  }

  private async assertNotInUse(id: string): Promise<void> {
    const inUse = await this.deps.rates.inUseIds([id]);
    if (inUse.has(id)) {
      throw new AppError(
        'EXCHANGE_RATE_IN_USE',
        'The rate is used by a purchase requisition; enter a corrected rate instead'
      );
    }
  }

  private async assertNotBase(currency: string): Promise<void> {
    if (currency === (await this.deps.rates.baseCurrency())) {
      throw new AppError(
        'EXCHANGE_RATE_BASE_CURRENCY',
        'The base currency has an implied rate of 1 and takes no exchange rate'
      );
    }
  }
}
