// Shared Zod building blocks (contracts/rest-api.md "Conventions"). Money and rates travel as
// decimal strings; dates as ISO YYYY-MM-DD.
import { z } from 'zod';

/** Non-negative decimal with at most 2 decimal places: '870710.00', '0', '12.5'. */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Must be a non-negative amount with at most 2 decimals');

/** Positive decimal with at most 6 decimal places: '600', '0.001667'. */
export const rateString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Must be a rate with at most 6 decimals')
  .refine((v) => /[1-9]/.test(v), 'Must be greater than zero');

/** Real calendar date in ISO form. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD form')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Must be a real calendar date');

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code');

export const uuid = z.string().uuid();

export const money = z.object({ amount: moneyString, currency: currencyCode });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type Pagination = z.infer<typeof pagination>;

export const sortDirection = z.enum(['asc', 'desc']);

/** `?sort=field:asc|desc` → { field, direction }. */
export const sort = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*:(asc|desc)$/, 'Must look like field:asc or field:desc')
  .transform((v) => {
    const [field, direction] = v.split(':') as [string, 'asc' | 'desc'];
    return { field, direction };
  });

export type Sort = z.output<typeof sort>;

export const listQuery = pagination.extend({ sort: sort.optional() });

export function listResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export interface ListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const expectedVersion = z.number().int().min(1);

/** Reason / comment for reject, return, cancel, reassign. */
export const reason = z.string().trim().min(1, 'A reason is required').max(2000);

export const idParam = z.object({ id: uuid });
