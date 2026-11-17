// Supplier registry and vetting (002 US2, contracts/rest-api.md "Suppliers"): suppliers with
// categories, documents, insert-only vetting, status changes with reasons, eligibility, and
// staff payees. Duplicate matches are warnings, never blocks (FR-012). Bodies are `.strict()`.
import { z } from 'zod';
import { expectedVersion, isoDate, listQuery, uuid } from './common';

export const SUPPLIER_TYPES = ['company', 'individual', 'government', 'ngo'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const SUPPLIER_STATUSES = [
  'pending_vetting',
  'approved',
  'suspended',
  'blacklisted',
] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

/** Allowed status changes; back to `approved` needs a current clear vetting (FR-010). */
export const SUPPLIER_STATUS_TRANSITIONS: Record<SupplierStatus, readonly SupplierStatus[]> = {
  pending_vetting: ['approved', 'blacklisted'],
  approved: ['suspended', 'blacklisted'],
  suspended: ['approved', 'blacklisted'],
  blacklisted: ['approved'],
};

/** Statuses that need a reason (US2-5). */
export const SUPPLIER_REASON_STATUSES: readonly SupplierStatus[] = ['suspended', 'blacklisted'];

export const SUPPLIER_DOC_KINDS = ['registration', 'tax', 'other'] as const;
export type SupplierDocKind = (typeof SUPPLIER_DOC_KINDS)[number];

export const VETTING_RESULTS = ['clear', 'match', 'inconclusive'] as const;
export type VettingResult = (typeof VETTING_RESULTS)[number];

/** Why a supplier cannot be awarded or paid (SUPPLIER_NOT_ELIGIBLE `details.reasons`). */
export const SUPPLIER_INELIGIBLE_REASONS = [
  'not_approved',
  'blacklisted',
  'vetting_overdue',
  'expired_document',
] as const;
export type SupplierIneligibleReason = (typeof SUPPLIER_INELIGIBLE_REASONS)[number];

export type EligibilityPurpose = 'invite' | 'award' | 'pay';

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

const supplierFields = {
  legalNameAr: z.string().trim().min(1).max(300),
  legalNameEn: z.string().trim().min(1).max(300),
  tradeName: optionalText(300),
  type: z.enum(SUPPLIER_TYPES),
  registrationNo: optionalText(100),
  taxNo: optionalText(100),
  address: optionalText(500),
  city: optionalText(100),
  phone: optionalText(50),
  email: z
    .union([z.string().trim().email().max(200), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  contactPerson: optionalText(200),
  bankName: optionalText(200),
  bankBranch: optionalText(200),
  bankAccountName: optionalText(200),
  bankAccountNo: optionalText(100),
  notes: optionalText(2000),
  categoryIds: z.array(uuid).max(50),
};

export const createSupplierBody = z
  .object({ ...supplierFields, categoryIds: supplierFields.categoryIds.default([]) })
  .strict();

export const updateSupplierBody = z
  .object(supplierFields)
  .partial()
  .extend({ expectedVersion })
  .strict();

export type CreateSupplierInput = z.output<typeof createSupplierBody>;
export type UpdateSupplierInput = z.output<typeof updateSupplierBody>;

export const supplierStatusBody = z
  .object({
    status: z.enum(SUPPLIER_STATUSES),
    reason: z.string().trim().max(2000).optional(),
    expectedVersion,
  })
  .strict();

export type SupplierStatusInput = z.output<typeof supplierStatusBody>;

export const supplierDocumentBody = z
  .object({
    docKind: z.enum(SUPPLIER_DOC_KINDS),
    isRequired: z.boolean().default(false),
    number: optionalText(100),
    issueDate: isoDate.nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate >= d.issueDate, {
    message: 'The expiry date cannot be before the issue date',
    path: ['expiryDate'],
  });

export type SupplierDocumentInput = z.output<typeof supplierDocumentBody>;

export const supplierVettingBody = z
  .object({
    checkedOn: isoDate,
    listsChecked: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    result: z.enum(VETTING_RESULTS),
    notes: optionalText(2000),
  })
  .strict();

export type SupplierVettingInput = z.output<typeof supplierVettingBody>;

export const supplierListQuery = listQuery.extend({
  status: z.enum(SUPPLIER_STATUSES).optional(),
  categoryId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  compliance: z.enum(['eligible', 'flagged']).optional(),
});

export type SupplierListQuery = z.output<typeof supplierListQuery>;

/** A supplier or staff payee sharing a normalized identifier (warning only, US2-3). */
export interface DuplicateWarning {
  partyKind: 'supplier' | 'staff_payee';
  partyId: string;
  nameAr: string;
  nameEn: string;
  field: 'registration_no' | 'tax_no' | 'phone' | 'bank_account_no';
}

export interface SupplierCompliance {
  vettingOverdue: boolean;
  hasExpiredRequiredDoc: boolean;
  canInvite: boolean;
  canAwardOrPay: boolean;
}

export interface SupplierSummary {
  id: string;
  legalNameAr: string;
  legalNameEn: string;
  tradeName: string | null;
  type: SupplierType;
  status: SupplierStatus;
  phone: string | null;
  lastVettedAt: string | null;
  compliance: SupplierCompliance;
  categoryIds: string[];
}

export interface SupplierDocument {
  id: string;
  docKind: SupplierDocKind;
  isRequired: boolean;
  number: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expired: boolean;
}

export interface SupplierVetting {
  id: string;
  checkedOn: string;
  checkedBy: string;
  checkedByName: string;
  listsChecked: string[];
  result: VettingResult;
  notes: string | null;
  createdAt: string;
}

export interface Supplier extends SupplierSummary {
  registrationNo: string | null;
  taxNo: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  contactPerson: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  notes: string | null;
  statusReason: string | null;
  ratings: {
    onTime: string | null;
    quality: string | null;
    documentation: string | null;
    count: number;
  };
  documents: SupplierDocument[];
  vettings: SupplierVetting[];
  duplicateWarnings: DuplicateWarning[];
  version: number;
}

export interface SupplierEligibility {
  supplierId: string;
  purpose: EligibilityPurpose;
  eligible: boolean;
  reasons: SupplierIneligibleReason[];
}

// ---------------------------------------------------------------------------------------------
// Staff payees (direct payments and advances)
// ---------------------------------------------------------------------------------------------

const payeeFields = {
  membershipId: uuid.nullable().optional(),
  fullNameAr: z.string().trim().min(1).max(200),
  fullNameEn: z.string().trim().min(1).max(200),
  phone: optionalText(50),
  bankName: optionalText(200),
  bankBranch: optionalText(200),
  bankAccountName: optionalText(200),
  bankAccountNo: optionalText(100),
  isActive: z.boolean(),
};

export const createStaffPayeeBody = z
  .object({ ...payeeFields, isActive: payeeFields.isActive.default(true) })
  .strict();

export const updateStaffPayeeBody = z
  .object(payeeFields)
  .partial()
  .extend({ expectedVersion })
  .strict();

export type CreateStaffPayeeInput = z.output<typeof createStaffPayeeBody>;
export type UpdateStaffPayeeInput = z.output<typeof updateStaffPayeeBody>;

export const staffPayeeListQuery = listQuery.extend({
  q: z.string().trim().max(100).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type StaffPayeeListQuery = z.output<typeof staffPayeeListQuery>;

export interface StaffPayee {
  id: string;
  membershipId: string | null;
  fullNameAr: string;
  fullNameEn: string;
  phone: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  isActive: boolean;
  version: number;
  duplicateWarnings?: DuplicateWarning[];
}
