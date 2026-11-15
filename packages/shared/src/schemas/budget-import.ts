// Budget-line spreadsheet import (research R12): columns code, description, category, amount.
// Cells are read as text; category accepts the enum value or its Arabic/English label.
import { z } from 'zod';
import { BUDGET_CATEGORIES, type BudgetCategory } from './budget-line';

export const IMPORT_COLUMNS = ['code', 'description', 'category', 'amount'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export const importModeQuery = z.object({ mode: z.enum(['preview', 'commit']) });

/** Accepted header names per column (compared lower-cased, spaces collapsed). */
export const IMPORT_HEADER_ALIASES: Record<ImportColumn, readonly string[]> = {
  code: ['code', 'budget line code', 'line code', 'الرمز', 'الكود', 'رمز البند', 'كود البند'],
  description: ['description', 'الوصف', 'البيان', 'وصف البند'],
  category: ['category', 'الفئة', 'التصنيف'],
  amount: ['amount', 'budget', 'budget amount', 'المبلغ', 'الميزانية', 'المبلغ المعتمد'],
};

const CATEGORY_LABELS: Record<BudgetCategory, readonly string[]> = {
  supplies: ['supplies', 'supply', 'مستلزمات', 'لوازم', 'إمدادات'],
  services: ['services', 'service', 'خدمات'],
  staff: ['staff', 'personnel', 'موظفون', 'الموظفون', 'موظفين'],
  equipment: ['equipment', 'معدات', 'أجهزة'],
  running_costs: [
    'running_costs',
    'running costs',
    'running cost',
    'operating costs',
    'تكاليف تشغيلية',
    'تكاليف التشغيل',
    'مصاريف تشغيلية',
  ],
};

export function normalizeLabel(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Maps an enum value or an Arabic/English label to a category; null when unknown. */
export function parseBudgetCategory(text: string): BudgetCategory | null {
  const key = normalizeLabel(text);
  if (!key) return null;
  return BUDGET_CATEGORIES.find((c) => CATEGORY_LABELS[c].includes(key)) ?? null;
}

export type ImportErrorCode =
  | 'required'
  | 'too_long'
  | 'invalid_category'
  | 'invalid_amount'
  | 'duplicate_in_file'
  | 'already_exists';

export interface ImportRowValues {
  code: string;
  description: string;
  category: string;
  amount: string;
}

export interface ImportValidRow {
  /** spreadsheet row number (the header is row 1) */
  row: number;
  code: string;
  description: string;
  category: BudgetCategory;
  amount: string;
}

export interface ImportInvalidRow {
  row: number;
  values: ImportRowValues;
  errors: { column: ImportColumn; code: ImportErrorCode }[];
}

export interface ImportResult {
  validRows: ImportValidRow[];
  invalidRows: ImportInvalidRow[];
  /** commit only: number of budget lines created */
  created?: number;
}
