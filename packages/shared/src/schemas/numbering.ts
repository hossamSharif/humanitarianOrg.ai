// Document numbering (FR-004, research R6): `{prefix}{sep}{OFFICE}{sep}{YYYY}{sep}{seq}` →
// PR-MAD-2026-0010. Changes apply to future numbers only (FR-005).
import { z } from 'zod';

export const DOC_TYPES = ['PR'] as const;
export const docType = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof docType>;

export const docTypeParam = z.object({ docType });

export const numberingConfigBody = z.object({
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,10}$/, 'Use 1-10 letters or digits'),
  includeOffice: z.boolean(),
  includeYear: z.boolean(),
  padding: z.number().int().min(1).max(10),
  separator: z.string().regex(/^[-/_.]{0,3}$/, 'Use up to 3 of - / _ .'),
});

export type NumberingConfigInput = z.output<typeof numberingConfigBody>;

export const numberingPreviewQuery = z.object({ officeId: z.string().uuid().optional() });

export interface NumberingConfigResponse extends NumberingConfigInput {
  docType: DocType;
  /** next number for the office (first active office when none is given), e.g. PR-MAD-2026-0001 */
  preview: string;
}
