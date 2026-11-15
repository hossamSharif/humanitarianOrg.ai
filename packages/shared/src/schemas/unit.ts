// Units of measure (FR-003): seeded on tenant creation, editable, deactivated — never deleted.
import { z } from 'zod';

export const unitCode = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{1,20}$/, 'Use up to 20 capital letters, digits, - or _');

export const createUnitBody = z.object({
  code: unitCode,
  nameAr: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  isActive: z.boolean().default(true),
});

export type CreateUnitInput = z.output<typeof createUnitBody>;

export const updateUnitBody = z
  .object({
    code: unitCode,
    nameAr: z.string().trim().min(1).max(100),
    nameEn: z.string().trim().min(1).max(100),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');

export type UpdateUnitInput = z.output<typeof updateUnitBody>;

export interface UnitOfMeasure {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}
