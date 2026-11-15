// T067 — budget-line import (FR-010, US2-5): cells as text, category labels, amount rules,
// duplicates, row-level errors, and no partial bad data on commit.
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import {
  BudgetImportService,
  parseCsv,
  readSpreadsheet,
  type UploadedFile,
} from '../../src/services/budget-import.service';
import { FakeBudgetLedger, FakeGrantStore, buildGrant, buildLine } from './helpers/funding-fakes';

type Cell = string | number | { value: number; numFmt: string };

async function xlsx(rows: Cell[][]): Promise<UploadedFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Budget');
  rows.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      const target = sheet.getCell(r + 1, c + 1);
      if (typeof cell === 'object') {
        target.value = cell.value;
        target.numFmt = cell.numFmt;
      } else {
        target.value = cell;
      }
    });
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    originalName: 'budget.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
  };
}

function csv(text: string): UploadedFile {
  const buffer = Buffer.from(text, 'utf8');
  return { buffer, originalName: 'budget.csv', mimeType: 'text/csv', size: buffer.length };
}

const HEADER = ['code', 'description', 'category', 'amount'];

let grants: FakeGrantStore;
let ledger: FakeBudgetLedger;
let service: BudgetImportService;
const grant = buildGrant();

beforeEach(() => {
  grants = new FakeGrantStore().seed(grant);
  ledger = new FakeBudgetLedger();
  service = new BudgetImportService({ grants, lines: ledger });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe('reading cells as text (FR-009)', () => {
  it('keeps 2.2.31, 010 and 10202 exactly as entered', async () => {
    const file = await xlsx([
      HEADER,
      ['2.2.31', 'Training', 'services', '1500.00'],
      ['010', 'Fuel', 'running_costs', 200],
      [10202, 'Hygiene kits', 'supplies', 870710],
      [{ value: 7, numFmt: '000' }, 'Padded code', 'equipment', 1.5],
    ]);
    const rows = await readSpreadsheet(file);
    expect(rows.map((r) => r.values.code)).toEqual(['2.2.31', '010', '10202', '007']);
    expect(rows.map((r) => r.values.amount)).toEqual(['1500.00', '200', '870710', '1.5']);
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5]);
  });

  it('CSV: quoted fields, embedded commas, BOM, CRLF; codes stay text', () => {
    expect(parseCsv('\uFEFFcode,description\r\n"010","Kits, family"\r\n2.2.31,"Say ""hi"""\n')).toEqual([
      ['code', 'description'],
      ['010', 'Kits, family'],
      ['2.2.31', 'Say "hi"'],
    ]);
    expect(parseCsv('code;amount\n10202;5')).toEqual([
      ['code', 'amount'],
      ['10202', '5'],
    ]);
  });

  it('Arabic headers and column order are accepted; blank rows are skipped', async () => {
    const rows = await readSpreadsheet(
      csv('المبلغ,الفئة,الوصف,الرمز\n100,مستلزمات,مستلزمات نظافة,10202\n,,,\n')
    );
    expect(rows).toEqual([
      {
        row: 2,
        values: {
          code: '10202',
          description: 'مستلزمات نظافة',
          category: 'مستلزمات',
          amount: '100',
        },
      },
    ]);
  });

  it('a missing column is a file-level VALIDATION_ERROR', async () => {
    const error = await expectAppError(
      readSpreadsheet(csv('code,description,amount\n1,a,2')),
      'VALIDATION_ERROR'
    );
    expect(error.details).toEqual([{ field: 'file', message: 'missing_columns:category' }]);
  });

  it('other file types are rejected', async () => {
    await expectAppError(
      readSpreadsheet({
        buffer: Buffer.from('x'),
        originalName: 'budget.pdf',
        mimeType: 'application/pdf',
        size: 1,
      }),
      'VALIDATION_ERROR'
    );
  });
});

describe('row validation (US2-5)', () => {
  it('category: enum values and Arabic/English labels map; anything else is invalid', async () => {
    const result = await service.preview(
      grant.id,
      csv(
        [
          'code,description,category,amount',
          'A1,a,supplies,1',
          'A2,b,Running costs,1',
          'A3,c,تكاليف تشغيلية,1',
          'A4,d,معدات,1',
          'A5,e,Staff,1',
          'A6,f,furniture,1',
        ].join('\n')
      )
    );
    expect(result.validRows.map((r) => r.category)).toEqual([
      'supplies',
      'running_costs',
      'running_costs',
      'equipment',
      'staff',
    ]);
    expect(result.invalidRows).toEqual([
      {
        row: 7,
        values: { code: 'A6', description: 'f', category: 'furniture', amount: '1' },
        errors: [{ column: 'category', code: 'invalid_category' }],
      },
    ]);
  });

  it('amount must be > 0 with at most 2 decimals', async () => {
    const result = await service.preview(
      grant.id,
      csv(
        [
          'code,description,category,amount',
          'B1,a,supplies,"1,500.25"',
          'B2,b,supplies,0',
          'B3,c,supplies,10.123',
          'B4,d,supplies,-5',
          'B5,e,supplies,abc',
          'B6,f,supplies,',
        ].join('\n')
      )
    );
    expect(result.validRows).toEqual([
      { row: 2, code: 'B1', description: 'a', category: 'supplies', amount: '1500.25' },
    ]);
    expect(result.invalidRows.map((r) => [r.values.code, r.errors[0]?.code])).toEqual([
      ['B2', 'invalid_amount'],
      ['B3', 'invalid_amount'],
      ['B4', 'invalid_amount'],
      ['B5', 'invalid_amount'],
      ['B6', 'required'],
    ]);
  });

  it('duplicate codes within the file (every occurrence) and codes already in the grant', async () => {
    ledger.seedLines(buildLine({ grantId: grant.id, code: '10202' }));
    const result = await service.preview(
      grant.id,
      csv(
        [
          'code,description,category,amount',
          '10202,existing,supplies,1',
          '2.2.31,first,services,1',
          '2.2.31,second,services,1',
          '10203,fine,supplies,1',
        ].join('\n')
      )
    );
    expect(result.validRows.map((r) => r.code)).toEqual(['10203']);
    expect(result.invalidRows.map((r) => [r.row, r.errors])).toEqual([
      [2, [{ column: 'code', code: 'already_exists' }]],
      [3, [{ column: 'code', code: 'duplicate_in_file' }]],
      [4, [{ column: 'code', code: 'duplicate_in_file' }]],
    ]);
  });

  it('several errors on one row are all reported with the raw values', async () => {
    const result = await service.preview(
      grant.id,
      csv('code,description,category,amount\n,,toys,0\n')
    );
    expect(result.invalidRows).toEqual([
      {
        row: 2,
        values: { code: '', description: '', category: 'toys', amount: '0' },
        errors: [
          { column: 'code', code: 'required' },
          { column: 'description', code: 'required' },
          { column: 'category', code: 'invalid_category' },
          { column: 'amount', code: 'invalid_amount' },
        ],
      },
    ]);
  });
});

describe('commit', () => {
  it('creates only the valid rows, codes as entered', async () => {
    const file = await xlsx([
      HEADER,
      ['2.2.31', 'Training', 'services', 1500],
      ['010', 'Fuel', 'Running costs', '200.50'],
      ['X1', 'Bad', 'furniture', 10],
    ]);
    const result = await service.commit(grant.id, file);
    expect(result.created).toBe(2);
    expect(result.invalidRows).toHaveLength(1);
    const lines = await ledger.listByGrant(grant.id);
    expect(lines.map((l) => [l.code, l.category, l.budgetAmount])).toEqual([
      ['010', 'running_costs', '200.50'],
      ['2.2.31', 'services', '1500.00'],
    ]);
  });

  it('zero valid rows → IMPORT_INVALID_ROWS and nothing is created', async () => {
    await expectAppError(
      service.commit(grant.id, csv('code,description,category,amount\nX,a,furniture,1\n')),
      'IMPORT_INVALID_ROWS'
    );
    expect(ledger.lines.size).toBe(0);
  });

  it('unknown grant → NOT_FOUND', async () => {
    await expectAppError(
      service.preview(randomUUID(), csv('code,description,category,amount\n')),
      'NOT_FOUND'
    );
  });
});
