// Express app with the middleware chain of contracts/rls-and-permissions.md §5:
// requestId → helmet/cors → rateLimit → auth → tenant → idempotency → validate →
// requirePermission → route → service → repository → errorHandler.
// (validate and requirePermission are per route.) Health is public; the session routes run
// without a tenant so a user can pick one.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { idempotency, type IdempotencyStore } from './middleware/idempotency';
import { rateLimits } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { tenantContext, type SessionContextLoader } from './middleware/tenant';
import { healthRouter, tenantRouter } from './routes';
import { sessionRouter } from './routes/session.routes';
import type { SessionService } from './services/session.service';

export interface AppOptions {
  corsOrigins?: string[];
  sessionService?: SessionService;
  loadSessionContext?: SessionContextLoader;
  idempotencyStore?: IdempotencyStore;
  rateLimit?: { perMinute?: number; writesPerMinute?: number };
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: options.corsOrigins ?? [],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Idempotency-Replayed'],
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(healthRouter());
  api.use(...rateLimits(options.rateLimit));
  api.use(authenticate);
  api.use(sessionRouter(options.sessionService));
  api.use(tenantContext(options.loadSessionContext));
  api.use(idempotency(options.idempotencyStore));
  api.use(tenantRouter());

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
