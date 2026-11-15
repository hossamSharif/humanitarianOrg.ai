// Organization profile (US1, FR-001; data-model §1 tenant). Bilingual names are required;
// contact fields are optional and an empty string clears them.
import { z } from 'zod';
import { isValidTimeZone } from '../format/date';
import { currencyCode } from './common';

/** Optional free text: trimmed, '' → null so a form can clear the field. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const timeZone = z
  .string()
  .trim()
  .refine(isValidTimeZone, 'Must be an IANA timezone such as Africa/Khartoum');

const profileFields = {
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  address: optionalText(),
  phone: optionalText(50),
  email: z
    .union([z.literal(''), z.string().trim().email().max(320)])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  website: optionalText(300),
  baseCurrency: currencyCode,
  doaReferenceCurrency: currencyCode,
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  timezone: timeZone,
  maxBackdateDays: z.number().int().min(0).max(365),
};

/** POST /tenants — the creator becomes Organization Admin. */
export const createTenantBody = z.object({
  ...profileFields,
  baseCurrency: profileFields.baseCurrency.default('SDG'),
  doaReferenceCurrency: profileFields.doaReferenceCurrency.default('USD'),
  fiscalYearStartMonth: profileFields.fiscalYearStartMonth.default(1),
  timezone: profileFields.timezone.default('Africa/Khartoum'),
  maxBackdateDays: profileFields.maxBackdateDays.default(30),
  /** the creator's own names on the membership; default to the e-mail address */
  adminFullNameAr: z.string().trim().min(1).max(200).optional(),
  adminFullNameEn: z.string().trim().min(1).max(200).optional(),
  adminPositionTitle: optionalText(200),
});

export type CreateTenantInput = z.output<typeof createTenantBody>;

/** PATCH /tenant — only the sent fields change. `logoPath` comes from POST /tenant/logo-upload-url. */
export const updateTenantBody = z
  .object({
    ...profileFields,
    logoPath: z.string().trim().min(1).max(300).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');

export type UpdateTenantInput = z.output<typeof updateTenantBody>;

export interface TenantProfile {
  id: string;
  nameAr: string;
  nameEn: string;
  logoPath: string | null;
  /** short-lived signed URL for showing the current logo */
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  baseCurrency: string;
  doaReferenceCurrency: string;
  fiscalYearStartMonth: number;
  timezone: string;
  maxBackdateDays: number;
  /** false once any PR has been submitted (the base currency is then fixed) */
  baseCurrencyEditable: boolean;
}

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const logoUploadBody = z.object({
  mimeType: z.enum(LOGO_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(LOGO_MAX_BYTES),
});

export type LogoUploadInput = z.output<typeof logoUploadBody>;

export interface LogoUploadUrl {
  /** send back as `logoPath` in PATCH /tenant once the upload succeeded */
  path: string;
  signedUrl: string;
  token: string;
}

export interface CreatedTenant {
  tenantId: string;
  membershipId: string;
  /** the active organization changed: the client must refresh its session */
  sessionRefreshRequired: true;
}
