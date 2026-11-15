// Donor bodies (contracts/rest-api.md "Donors, grants, budget lines, activities, rates").
import { z } from 'zod';
import { listQuery } from './common';

/** Optional free text; an empty string means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const donorCreate = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: optionalText(50),
  contactName: optionalText(200),
  contactEmail: z
    .union([z.literal(''), z.string().trim().email().max(320)])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  contactPhone: optionalText(50),
  notes: optionalText(4000),
});

export const donorUpdate = donorCreate.partial().extend({ isActive: z.boolean().optional() });

export const donorListQuery = listQuery.extend({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type DonorCreate = z.infer<typeof donorCreate>;
export type DonorUpdate = z.infer<typeof donorUpdate>;
export type DonorListQuery = z.infer<typeof donorListQuery>;

export interface Donor {
  id: string;
  name: string;
  shortName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}
