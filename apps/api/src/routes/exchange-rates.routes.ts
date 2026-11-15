import {
  PERMISSIONS,
  exchangeRateCreate,
  exchangeRateListQuery,
  exchangeRateLookupQuery,
  exchangeRateUpdate,
  idParam,
  type ExchangeRateCreate,
  type ExchangeRateListQuery,
  type ExchangeRateUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import type { z } from 'zod';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { ExchangeRateService } from '../services/exchange-rate.service';
import { handle, type ServiceFactory } from './route-helpers';

/** Manual rates: read and lookup by members, write with rates:manage (FR-015). */
export function exchangeRatesRouter(
  service: ServiceFactory<ExchangeRateService> = ExchangeRateService.forContext
): Router {
  const router = Router();

  router.get(
    '/exchange-rates',
    validate({ query: exchangeRateListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).list(req.query as unknown as ExchangeRateListQuery));
    })
  );

  // before '/exchange-rates/:id' so "lookup" is not taken for an id
  router.get(
    '/exchange-rates/lookup',
    validate({ query: exchangeRateLookupQuery }),
    handle(async (req, res, ctx) => {
      const { currency, date } = req.query as unknown as z.infer<typeof exchangeRateLookupQuery>;
      res.json(await service(ctx).lookup(currency, date));
    })
  );

  router.get(
    '/exchange-rates/:id',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).get(req.params.id!));
    })
  );

  router.post(
    '/exchange-rates',
    requirePermission(PERMISSIONS.RATES_MANAGE),
    validate({ body: exchangeRateCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).create(req.body as ExchangeRateCreate));
    })
  );

  router.patch(
    '/exchange-rates/:id',
    requirePermission(PERMISSIONS.RATES_MANAGE),
    validate({ params: idParam, body: exchangeRateUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).update(req.params.id!, req.body as ExchangeRateUpdate));
    })
  );

  router.delete(
    '/exchange-rates/:id',
    requirePermission(PERMISSIONS.RATES_MANAGE),
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      await service(ctx).remove(req.params.id!);
      res.status(204).end();
    })
  );

  return router;
}
