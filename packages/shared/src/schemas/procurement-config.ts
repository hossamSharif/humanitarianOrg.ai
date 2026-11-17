// Procurement configuration (002 US1, contracts/rest-api.md "Procurement configuration"):
// settings, method bands (tenant and per grant), deduction types, payment and supplier
// categories, and the method resolution preview. Bodies are `.strict()`.
import { z } from 'zod';
import {
  PROCUREMENT_METHODS,
  type MethodBand,
  type ProcurementMethod,
} from '../procurement/method';
import { expectedVersion, moneyString, uuid } from './common';

/** 0–100 with at most 2 decimals: '0', '5', '12.50'. */
export const percentString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a percentage with at most 2 decimals')
  .refine((v) => Number(v) <= 100, 'Must be between 0 and 100');

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export const procurementSettingsBody = z
  .object({
    invoicePriceTolerancePct: percentString,
    invoiceQtyTolerancePct: percentString,
    grnOverDeliveryTolerancePct: percentString,
    committeeMinSize: z.number().int().min(2).max(20),
    revettingMonths: z.number().int().min(1).max(120),
    guaranteeWarningDays: z.number().int().min(1).max(365),
    advanceOverdueDays: z.number().int().min(0).max(365),
    requirePoAcknowledgement: z.boolean(),
    splittingWindowDays: z.number().int().min(0).max(365),
    expectedVersion,
  })
  .strict();

export type ProcurementSettingsInput = z.output<typeof procurementSettingsBody>;

export interface ProcurementSettings extends Omit<ProcurementSettingsInput, 'expectedVersion'> {
  version: number;
}

// ---------------------------------------------------------------------------------------------
// Method bands
// ---------------------------------------------------------------------------------------------

export const procurementMethod = z.enum(PROCUREMENT_METHODS);

const optionalAmount = z
  .union([moneyString, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const methodBandInput = z
  .object({
    method: procurementMethod,
    minAmount: optionalAmount,
    maxAmount: optionalAmount,
    minQuotations: z.number().int().min(1).max(20),
  })
  .strict();

/** Full replace. The tenant set must not be empty; an empty grant set removes the grant rule. */
export const methodBandsBody = z.object({ bands: z.array(methodBandInput).max(20) }).strict();

export type MethodBandsInput = z.output<typeof methodBandsBody>;

export interface MethodBandSet {
  /** DoA reference currency of the amounts */
  currency: string;
  bands: MethodBand[];
}

// ---------------------------------------------------------------------------------------------
// Resolve method
// ---------------------------------------------------------------------------------------------

export const resolveMethodBody = z.object({ prLineIds: z.array(uuid).min(1).max(500) }).strict();

export type ResolveMethodInput = z.output<typeof resolveMethodBody>;

export interface ResolveMethodResponse {
  estimatedValue: string;
  currency: string;
  requiredMethod: ProcurementMethod;
  minQuotations: number;
  bandsUsed: { tenant: MethodBand; grant: MethodBand | null };
  /** present when combined related PRs exceed the band (research D4, FR-053); never a block */
  splittingWarning?: { prIds: string[]; total: string; bandMax: string };
}

// ---------------------------------------------------------------------------------------------
// Deduction types
// ---------------------------------------------------------------------------------------------

export const DEDUCTION_APPLIES_TO = ['goods', 'services', 'both'] as const;
export type DeductionAppliesTo = (typeof DEDUCTION_APPLIES_TO)[number];

const name = z.string().trim().min(1).max(200);

export const createDeductionTypeBody = z
  .object({
    nameAr: name,
    nameEn: name,
    ratePct: percentString,
    appliesTo: z.enum(DEDUCTION_APPLIES_TO),
    payableAccountId: uuid,
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateDeductionTypeBody = createDeductionTypeBody
  .partial()
  .extend({ expectedVersion })
  .strict();

export type CreateDeductionTypeInput = z.output<typeof createDeductionTypeBody>;
export type UpdateDeductionTypeInput = z.output<typeof updateDeductionTypeBody>;

export interface DeductionType {
  id: string;
  nameAr: string;
  nameEn: string;
  ratePct: string;
  appliesTo: DeductionAppliesTo;
  payableAccountId: string;
  payableAccountCode: string;
  isActive: boolean;
  version: number;
}

// ---------------------------------------------------------------------------------------------
// Payment and supplier categories (same shape; payment categories add procurementOnly)
// ---------------------------------------------------------------------------------------------

export const categoryCode = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,40}$/, 'Use up to 40 lowercase letters, digits or _');

export const createSupplierCategoryBody = z
  .object({ code: categoryCode, nameAr: name, nameEn: name, isActive: z.boolean().default(true) })
  .strict();

export const updateSupplierCategoryBody = createSupplierCategoryBody
  .partial()
  .extend({ expectedVersion })
  .strict();

export const createPaymentCategoryBody = createSupplierCategoryBody
  .extend({ procurementOnly: z.boolean().default(false) })
  .strict();

export const updatePaymentCategoryBody = createPaymentCategoryBody
  .partial()
  .extend({ expectedVersion })
  .strict();

export type CreateSupplierCategoryInput = z.output<typeof createSupplierCategoryBody>;
export type UpdateSupplierCategoryInput = z.output<typeof updateSupplierCategoryBody>;
export type CreatePaymentCategoryInput = z.output<typeof createPaymentCategoryBody>;
export type UpdatePaymentCategoryInput = z.output<typeof updatePaymentCategoryBody>;

export interface SupplierCategory {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  version: number;
}

export interface PaymentCategory extends SupplierCategory {
  procurementOnly: boolean;
}
