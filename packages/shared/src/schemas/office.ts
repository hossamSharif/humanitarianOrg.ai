// Offices / locations (FR-002). The code is part of PR numbers and becomes immutable once a PR
// references the office (409 OFFICE_CODE_IN_USE).
import { z } from 'zod';
import { optionalText } from './tenant';

export const OFFICE_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

export const officeCode = z
  .string()
  .trim()
  .regex(OFFICE_CODE_PATTERN, 'Use 2-10 capital letters or digits');

export const createOfficeBody = z.object({
  code: officeCode,
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  address: optionalText(),
  phone: optionalText(50),
  isActive: z.boolean().default(true),
});

export type CreateOfficeInput = z.output<typeof createOfficeBody>;

export const updateOfficeBody = z
  .object({
    code: officeCode,
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200),
    address: optionalText(),
    phone: optionalText(50),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');

export type UpdateOfficeInput = z.output<typeof updateOfficeBody>;

/** `?active=true|false` */
export const activeFilterQuery = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export interface Office {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  /** true once a PR references the office: the code can no longer change */
  codeLocked: boolean;
}
