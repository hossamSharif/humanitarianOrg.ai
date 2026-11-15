// Route-level validation with the shared Zod schemas. Parsed values replace the raw ones, so
// handlers read coerced/defaulted data (e.g. pagination) from req.query / req.params / req.body.
import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { zodToAppError } from './error';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(zodToAppError(result.error, part === 'body' ? undefined : part));
        return;
      }
      if (part === 'query') {
        // req.query is a getter in Express 5 and may be frozen by some parsers; redefine it.
        Object.defineProperty(req, 'query', { value: result.data, writable: true });
      } else {
        req[part] = result.data;
      }
    }
    next();
  };
}
