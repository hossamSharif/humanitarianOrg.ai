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

export interface NumberingPreviewParts {
  officeCode: string;
  year: number;
  seq: number;
}

export interface NumberingConfigResponse extends NumberingConfigInput {
  docType: DocType;
  /** next number for the office (first active office when none is given), e.g. PR-MAD-2026-0001 */
  preview: string;
  /** what `preview` was built from, so a form can re-format it live while editing */
  previewParts: NumberingPreviewParts;
}

/** `{prefix}{sep}{OFFICE}{sep}{YYYY}{sep}{seq padded}`; a longer sequence is never truncated. */
export function formatDocumentNumber(
  config: NumberingConfigInput,
  officeCode: string,
  year: number,
  seq: number
): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Invalid sequence ${seq}`);
  if (!Number.isInteger(config.padding) || config.padding < 1 || config.padding > 10) {
    throw new RangeError(`Invalid padding ${config.padding}`);
  }
  const parts = [config.prefix];
  if (config.includeOffice) parts.push(officeCode);
  if (config.includeYear) parts.push(String(year));
  parts.push(String(seq).padStart(config.padding, '0'));
  return parts.join(config.separator);
}
