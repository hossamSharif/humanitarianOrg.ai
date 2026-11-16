// GET /prs/:id/print — everything the PR PDF shows (contracts/print-layout.md "Data shape").
// Labels are already in the requested locale; amounts are decimal strings and dates ISO, so the
// PDF templates only format (shared formatters) and never compute.
import { z } from 'zod';
import { PR_STATUSES } from '../pr-state';
import { currencyCode, isoDate } from './common';
import { prType } from './pr';

export const PRINT_LOCALES = ['ar', 'en'] as const;
export const printLocale = z.enum(PRINT_LOCALES);
export type PrintLocale = z.infer<typeof printLocale>;

/** GET /prs/:id/print?locale=ar|en (default ar) */
export const prPrintQuery = z.object({ locale: printLocale.default('ar') });
export type PrPrintQuery = z.infer<typeof prPrintQuery>;

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const label = z.object({ code: z.string(), name: z.string() });

const signature = z
  .object({ name: z.string(), position: z.string().nullable(), signedAt: z.string() })
  .nullable();

export const prPrintData = z.object({
  organization: z.object({
    nameAr: z.string(),
    nameEn: z.string(),
    /** short-lived signed URL of the logo frozen in the print snapshot */
    logoUrl: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  document: z.object({
    number: z.string().nullable(),
    status: z.enum(PR_STATUSES),
    watermark: z.enum(['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED']).nullable(),
    /** instant; shown as DD/MM/YYYY HH:mm in `timeZone` */
    printedAt: z.string(),
    timeZone: z.string(),
    locale: printLocale,
  }),
  header: z.object({
    prDate: isoDate.nullable(),
    requiredByDate: isoDate.nullable(),
    requestingOffice: label.nullable(),
    grant: label.nullable(),
    donor: z.object({ name: z.string(), shortName: z.string().nullable() }).nullable(),
    deliverTo: z.object({ name: z.string() }).nullable(),
    deliveryAddress: z.string().nullable(),
    contactName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    activity: label.nullable(),
    prType: prType.nullable(),
    purpose: z.string().nullable(),
  }),
  lines: z.array(
    z.object({
      lineNo: z.number().int(),
      description: z.string().nullable(),
      specifications: z.string().nullable(),
      quantity: decimal.nullable(),
      unit: label.nullable(),
      unitCost: decimal.nullable(),
      lineTotal: decimal.nullable(),
      currency: currencyCode,
      donorShortName: z.string().nullable(),
      budgetLocation: label.nullable(),
      budgetLineCode: z.string().nullable(),
    })
  ),
  /** one per line currency, in order of first appearance */
  totals: z.array(
    z.object({
      currency: currencyCode,
      amount: decimal,
      amountInWordsAr: z.string(),
      amountInWordsEn: z.string(),
    })
  ),
  /** grant-currency equivalent, when a line currency differs from the grant's (locked rates) */
  grantTotal: z
    .object({
      currency: currencyCode,
      amount: decimal,
      rates: z.array(
        z.object({
          currency: currencyCode,
          rateToBase: decimal,
          rateDate: isoDate,
          source: z.string(),
        })
      ),
    })
    .nullable(),
  signatures: z.object({
    requestedBy: signature,
    financeCheck: signature,
    finalApproval: signature,
  }),
});

export type PrPrintData = z.infer<typeof prPrintData>;
export type PrPrintSignature = PrPrintData['signatures']['requestedBy'];
