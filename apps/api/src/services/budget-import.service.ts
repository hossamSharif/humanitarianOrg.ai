// Budget-line import from .xlsx / .csv (FR-010, research R12). Every cell is read as text, so donor
// codes such as '2.2.31', '010' and '10202' stay exactly as entered. `preview` validates only;
// `commit` re-validates and inserts all valid rows in one statement — never partial bad data.
import {
  IMPORT_COLUMNS,
  IMPORT_HEADER_ALIASES,
  IMPORT_MAX_BYTES,
  normalizeLabel,
  parseAmount,
  parseBudgetCategory,
  type Grant,
  type ImportColumn,
  type ImportInvalidRow,
  type ImportResult,
  type ImportRowValues,
  type ImportValidRow,
} from '@ngo/shared';
import ExcelJS from 'exceljs';
import { AppError } from '../middleware/error';
import { BudgetLineRepository, type BudgetLineStore } from '../repositories/budget-line.repository';
import { GrantRepository } from '../repositories/grant.repository';
import type { RequestContext } from '../types/context';

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface SheetRow {
  /** spreadsheet row number, header = its own row number */
  row: number;
  values: ImportRowValues;
}

export interface BudgetImportDeps {
  grants: { findById(id: string): Promise<Grant | null> };
  lines: Pick<BudgetLineStore, 'listByGrant' | 'insertMany'>;
}

const MAX_CODE = 100;
const MAX_DESCRIPTION = 1000;
/** > 0, at most 2 decimals; thousands separators allowed ('1,500.00'). */
const AMOUNT = /^(\d{1,16}|\d{1,3}(,\d{3}){1,5})(\.\d{1,2})?$/;

function fileError(message: string): AppError {
  return new AppError('VALIDATION_ERROR', `Import file: ${message}`, [{ field: 'file', message }]);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Text of an exceljs cell value as the user typed it. */
export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    // a code typed as 010 in a cell formatted 000 is stored as 10: restore the zeros
    const fmt = cell.numFmt;
    if (fmt && /^0+$/.test(fmt) && Number.isInteger(value)) {
      return String(value).padStart(fmt.length, '0');
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value && typeof value.text === 'string') return value.text;
  if ('result' in value) {
    const result = value.result;
    if (result === null || result === undefined) return '';
    if (result instanceof Date) return result.toISOString().slice(0, 10);
    if (typeof result === 'object') return '';
    return String(result);
  }
  return '';
}

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF/LF); `;` when the header uses it. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Header row → column positions; unknown headers are ignored, missing ones reported. */
function mapHeader(header: readonly string[]): Record<ImportColumn, number> {
  const positions: Partial<Record<ImportColumn, number>> = {};
  header.forEach((text, index) => {
    const key = normalizeLabel(text);
    const column = IMPORT_COLUMNS.find((c) => IMPORT_HEADER_ALIASES[c].includes(key));
    if (column && positions[column] === undefined) positions[column] = index;
  });
  const missing = IMPORT_COLUMNS.filter((c) => positions[c] === undefined);
  if (missing.length) throw fileError(`missing_columns:${missing.join(',')}`);
  return positions as Record<ImportColumn, number>;
}

/** Turns a grid (first non-empty row = header) into data rows; blank rows are skipped. */
export function gridToRows(grid: readonly { row: number; cells: string[] }[]): SheetRow[] {
  const nonEmpty = grid.filter((r) => r.cells.some((c) => c.trim() !== ''));
  const [header, ...data] = nonEmpty;
  if (!header) throw fileError('empty');
  const positions = mapHeader(header.cells);
  return data.map((r) => ({
    row: r.row,
    values: {
      code: r.cells[positions.code] ?? '',
      description: r.cells[positions.description] ?? '',
      category: r.cells[positions.category] ?? '',
      amount: r.cells[positions.amount] ?? '',
    },
  }));
}

function isCsv(file: UploadedFile): boolean {
  return /\.csv$/i.test(file.originalName) || /^text\/(csv|plain)/.test(file.mimeType);
}

function isXlsx(file: UploadedFile): boolean {
  return (
    /\.xlsx$/i.test(file.originalName) ||
    file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

export async function readSpreadsheet(file: UploadedFile): Promise<SheetRow[]> {
  if (file.size > IMPORT_MAX_BYTES || file.buffer.length > IMPORT_MAX_BYTES) {
    throw fileError('too_large');
  }
  if (isCsv(file)) {
    const grid = parseCsv(file.buffer.toString('utf8')).map((cells, i) => ({ row: i + 1, cells }));
    return gridToRows(grid);
  }
  if (!isXlsx(file)) throw fileError('unsupported_type');

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types predate the generic Buffer of @types/node 20
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    throw fileError('unreadable');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw fileError('empty');

  const grid: { row: number; cells: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let col = 1; col <= row.cellCount; col++) cells.push(cellText(row.getCell(col)));
    grid.push({ row: rowNumber, cells });
  });
  return gridToRows(grid);
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * Validates rows against the shared rules: code required (kept as text), description required,
 * category from the enum or its label, amount > 0 with ≤ 2 decimals, no duplicate code in the
 * file (every occurrence is reported) or in the grant.
 */
export function validateImportRows(
  rows: readonly SheetRow[],
  existingCodes: ReadonlySet<string>
): ImportResult {
  const codeCounts = new Map<string, number>();
  for (const r of rows) {
    const code = r.values.code.trim();
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }

  const validRows: ImportValidRow[] = [];
  const invalidRows: ImportInvalidRow[] = [];
  for (const r of rows) {
    const errors: ImportInvalidRow['errors'] = [];
    const code = r.values.code.trim();
    const description = r.values.description.trim();
    const amountText = r.values.amount.trim();

    if (!code) errors.push({ column: 'code', code: 'required' });
    else if (code.length > MAX_CODE) errors.push({ column: 'code', code: 'too_long' });
    else if ((codeCounts.get(code) ?? 0) > 1) {
      errors.push({ column: 'code', code: 'duplicate_in_file' });
    } else if (existingCodes.has(code)) errors.push({ column: 'code', code: 'already_exists' });

    if (!description) errors.push({ column: 'description', code: 'required' });
    else if (description.length > MAX_DESCRIPTION) {
      errors.push({ column: 'description', code: 'too_long' });
    }

    const category = parseBudgetCategory(r.values.category);
    if (!r.values.category.trim()) errors.push({ column: 'category', code: 'required' });
    else if (!category) errors.push({ column: 'category', code: 'invalid_category' });

    const amount = amountText.replace(/,/g, '');
    if (!amountText) errors.push({ column: 'amount', code: 'required' });
    else if (!AMOUNT.test(amountText) || !/[1-9]/.test(amount)) {
      errors.push({ column: 'amount', code: 'invalid_amount' });
    }

    if (errors.length || !category) {
      invalidRows.push({ row: r.row, values: r.values, errors });
    } else {
      validRows.push({
        row: r.row,
        code,
        description,
        category,
        amount: parseAmount(amount).toFixed(2),
      });
    }
  }
  return { validRows, invalidRows };
}

// ---------------------------------------------------------------------------------------------

export class BudgetImportService {
  constructor(private readonly deps: BudgetImportDeps) {}

  static forContext(ctx: RequestContext): BudgetImportService {
    return new BudgetImportService({
      grants: new GrantRepository(ctx),
      lines: new BudgetLineRepository(ctx),
    });
  }

  async preview(grantId: string, file: UploadedFile): Promise<ImportResult> {
    return this.validate(grantId, file);
  }

  /** Re-validates, then inserts every valid row at once; zero valid rows → IMPORT_INVALID_ROWS. */
  async commit(grantId: string, file: UploadedFile): Promise<ImportResult> {
    const result = await this.validate(grantId, file);
    if (result.validRows.length === 0) {
      throw new AppError('IMPORT_INVALID_ROWS', 'The file has no valid rows to import');
    }
    const created = await this.deps.lines.insertMany(
      result.validRows.map((r) => ({
        grantId,
        code: r.code,
        description: r.description,
        category: r.category,
        budgetAmount: r.amount,
        officeId: null,
      }))
    );
    return { ...result, created };
  }

  private async validate(grantId: string, file: UploadedFile): Promise<ImportResult> {
    if (!(await this.deps.grants.findById(grantId))) {
      throw new AppError('NOT_FOUND', 'grant not found');
    }
    const rows = await readSpreadsheet(file);
    const existing = await this.deps.lines.listByGrant(grantId);
    return validateImportRows(rows, new Set(existing.map((l) => l.code)));
  }
}
