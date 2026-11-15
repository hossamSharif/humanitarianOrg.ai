// Manual exchange rates (FR-015): 1 unit of `currency` = rateToBase × tenant base currency.
import { z } from 'zod';
import { currencyCode, isoDate, listQuery, rateString } from './common';

export const exchangeRateCreate = z.object({
  currency: currencyCode,
  rateToBase: rateString,
  rateDate: isoDate,
  source: z.string().trim().min(1).max(300),
});

export const exchangeRateUpdate = exchangeRateCreate.partial();

export const exchangeRateListQuery = listQuery.extend({
  currency: currencyCode.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const exchangeRateLookupQuery = z.object({ currency: currencyCode, date: isoDate });

export type ExchangeRateCreate = z.infer<typeof exchangeRateCreate>;
export type ExchangeRateUpdate = z.infer<typeof exchangeRateUpdate>;
export type ExchangeRateListQuery = z.infer<typeof exchangeRateListQuery>;

export interface ExchangeRate {
  id: string;
  currency: string;
  rateToBase: string;
  rateDate: string;
  source: string;
  createdAt: string;
  /** used by a PR: read-only, corrections are new rows */
  inUse: boolean;
}

/** Rate applied to a document; the base currency resolves to rate 1 with source 'base'. */
export interface ResolvedRate {
  currency: string;
  rateToBase: string;
  rateDate: string;
  source: string;
  exchangeRateId: string | null;
}
