// Grant bodies. Codes are the donor's, stored exactly as entered; amounts are decimal strings in
// the grant currency.
import { z } from 'zod';
import { currencyCode, expectedVersion, isoDate, listQuery, moneyString, uuid } from './common';

export const GRANT_STATUSES = ['active', 'suspended', 'closed'] as const;
export const grantStatus = z.enum(GRANT_STATUSES);
export type GrantStatus = z.infer<typeof grantStatus>;

export const positiveMoneyString = moneyString.refine(
  (v) => /[1-9]/.test(v),
  'Must be greater than zero'
);

const grantFields = {
  donorId: uuid,
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  currency: currencyCode,
  totalAmount: positiveMoneyString,
  startDate: isoDate,
  endDate: isoDate,
  officeIds: z.array(uuid).min(1, 'Select at least one office'),
};

const periodOrdered = (v: { startDate?: string; endDate?: string }) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;
const periodMessage = { message: 'End date must be on or after start date', path: ['endDate'] };

export const grantCreate = z.object(grantFields).refine(periodOrdered, periodMessage);

/** PATCH: any field; status changes go through POST /grants/:id/status. */
export const grantUpdate = z
  .object(grantFields)
  .partial()
  .extend({ expectedVersion })
  .refine(periodOrdered, periodMessage);

export const grantStatusChange = z.object({
  status: grantStatus,
  expectedVersion,
  /** Echo of the pending-PR count shown to the user; required when PRs are pending. */
  confirmPendingCount: z.number().int().min(0).optional(),
});

export const grantListQuery = listQuery
  .extend({
    status: grantStatus.optional(),
    donorId: uuid.optional(),
    officeId: uuid.optional(),
    selectableFor: z.literal('pr').optional(),
    prDate: isoDate.optional(),
  })
  .refine((v) => v.selectableFor !== 'pr' || (v.prDate !== undefined && v.officeId !== undefined), {
    message: 'selectableFor=pr needs prDate and officeId',
    path: ['selectableFor'],
  });

export type GrantCreate = z.infer<typeof grantCreate>;
export type GrantUpdate = z.infer<typeof grantUpdate>;
export type GrantStatusChange = z.infer<typeof grantStatusChange>;
export type GrantListQuery = z.infer<typeof grantListQuery>;

export interface Grant {
  id: string;
  donorId: string;
  code: string;
  name: string;
  currency: string;
  totalAmount: string;
  startDate: string;
  endDate: string;
  status: GrantStatus;
  version: number;
  officeIds: string[];
}

/** GET /grants/:id — grant plus derived totals (FR-013, FR-022). */
export interface GrantDetail extends Grant {
  budgetLinesTotal: string;
  /** totalAmount − budgetLinesTotal; a warning when not zero, never an error */
  difference: string;
  hasDifference: boolean;
  pendingPrCount: number;
  /** currency is locked once any budget line has a commitment */
  currencyLocked: boolean;
}

export type GrantStatusChangeResult =
  | { requiresConfirmation: true; pendingPrCount: number }
  | { requiresConfirmation: false; grant: Grant };
