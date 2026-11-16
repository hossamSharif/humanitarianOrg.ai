// The PR form's values (React Hook Form) and their mapping to the API: inputs hold '' for "not
// entered", the API takes null. The submit schema is the shared complete header/line schemas
// with blanks read as missing, so the client reports the same fields the server would.
import {
  prHeader,
  prLine,
  uuid,
  type PrDetail,
  type PrDraftUpdate,
  type PrType,
} from '@ngo/shared';
import { z } from 'zod';

export interface PrLineFormValues {
  /** stored line id; absent until the first save returns it */
  id?: string;
  description: string;
  specifications: string;
  quantity: string;
  unitId: string;
  unitCost: string;
  currency: string;
  budgetLineId: string;
  locationOfficeId: string;
  activityId: string;
}

export interface PrFormValues {
  header: {
    prDate: string | null;
    requestingOfficeId: string;
    grantId: string;
    deliverToOfficeId: string;
    deliveryAddress: string;
    contactName: string;
    contactPhone: string;
    requiredByDate: string | null;
    activityId: string;
    purpose: string;
    prType: PrType | '';
  };
  lines: PrLineFormValues[];
}

const blank = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
const orEmpty = (v: string | null | undefined) => v ?? '';

export function emptyLine(defaults: {
  currency: string;
  locationOfficeId: string;
}): PrLineFormValues {
  return {
    description: '',
    specifications: '',
    quantity: '',
    unitId: '',
    unitCost: '',
    currency: defaults.currency,
    budgetLineId: '',
    locationOfficeId: defaults.locationOfficeId,
    activityId: '',
  };
}

export function fromDetail(pr: PrDetail): PrFormValues {
  return {
    header: {
      prDate: pr.prDate,
      requestingOfficeId: orEmpty(pr.requestingOfficeId),
      grantId: orEmpty(pr.grantId),
      deliverToOfficeId: orEmpty(pr.deliverToOfficeId),
      deliveryAddress: orEmpty(pr.deliveryAddress),
      contactName: orEmpty(pr.contactName),
      contactPhone: orEmpty(pr.contactPhone),
      requiredByDate: pr.requiredByDate,
      activityId: orEmpty(pr.activityId),
      purpose: orEmpty(pr.purpose),
      prType: pr.prType ?? '',
    },
    lines: pr.lines.map((l) => ({
      id: l.id,
      description: orEmpty(l.description),
      specifications: orEmpty(l.specifications),
      quantity: l.quantity ? trimDecimal(l.quantity) : '',
      unitId: orEmpty(l.unitId),
      unitCost: orEmpty(l.unitCost),
      currency: l.currency,
      budgetLineId: orEmpty(l.budgetLineId),
      locationOfficeId: orEmpty(l.locationOfficeId),
      activityId: orEmpty(l.activityId),
    })),
  };
}

/** '10.000' → '10', '2.500' → '2.5' (quantities are stored with 3 decimals). */
export function trimDecimal(v: string): string {
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

export function toDraftBody(values: PrFormValues, expectedVersion: number): PrDraftUpdate {
  const h = values.header;
  return {
    expectedVersion,
    header: {
      prDate: h.prDate,
      requestingOfficeId: blank(h.requestingOfficeId),
      grantId: blank(h.grantId),
      deliverToOfficeId: blank(h.deliverToOfficeId),
      deliveryAddress: blank(h.deliveryAddress),
      contactName: blank(h.contactName),
      contactPhone: blank(h.contactPhone),
      requiredByDate: h.requiredByDate,
      activityId: blank(h.activityId),
      purpose: blank(h.purpose),
      prType: blank(h.prType) as PrType | null,
    },
    lines: values.lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      description: blank(l.description),
      specifications: blank(l.specifications),
      quantity: blank(l.quantity),
      unitId: blank(l.unitId),
      unitCost: blank(l.unitCost),
      currency: blank(l.currency),
      budgetLineId: blank(l.budgetLineId),
      locationOfficeId: blank(l.locationOfficeId),
      activityId: blank(l.activityId),
    })),
  };
}

/** Content hash for "changed since the last save"; line ids do not count as content. */
export function documentHash(values: PrFormValues): string {
  const { header, lines } = toDraftBody(values, 0);
  return JSON.stringify({ header, lines: lines.map(({ id: _id, ...rest }) => rest) });
}

const blankAsMissing = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

function withBlanks<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, blankAsMissing(schema as z.ZodTypeAny)])
  ) as { [K in keyof T]: z.ZodEffects<T[K]> };
}

/** Checked before submitting (the server repeats every rule). */
export const prSubmitFormSchema = z.object({
  header: z
    .object(withBlanks(prHeader.shape))
    .refine((h) => !h.requiredByDate || !h.prDate || h.requiredByDate >= h.prDate, {
      message: 'required_by_before_pr_date',
      path: ['requiredByDate'],
    }),
  lines: z.array(z.object({ id: uuid.optional(), ...withBlanks(prLine.shape) })).min(1, 'no_lines'),
});
