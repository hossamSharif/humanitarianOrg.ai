// Budget status report (US8, FR-049, SC-004): per budget line Budget / Reserved / Committed /
// Actual / Available / % used with grant totals (the same derivation as the budget-lines screen,
// deriveFigures), the drill-down to the PRs holding each line, and the Excel export. The PDF
// export is rendered by the web client from the JSON report.
import ExcelJS from 'exceljs';
import {
  Decimal,
  formatDate,
  formatDateTime,
  parseAmount,
  type BudgetCategory,
  type BudgetDrillDown,
  type BudgetStatusReport,
  type PrintLocale,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { ReportRepository, type ReportStore } from '../repositories/report.repository';
import type { RequestContext } from '../types/context';
import { deriveFigures } from './budget.service';

const fixed2 = (d: Decimal) => d.toFixed(2);

/** Export labels; the web UI has its own in messages/*.json (`reports.*`). */
const LABELS: Record<
  PrintLocale,
  {
    title: string;
    grant: string;
    donor: string;
    currency: string;
    period: string;
    generated: string;
    columns: [string, string, string, string, string, string, string, string, string];
    totals: string;
    categories: Record<BudgetCategory, string>;
    sheet: string;
  }
> = {
  en: {
    title: 'Budget status report',
    grant: 'Grant',
    donor: 'Donor',
    currency: 'Currency',
    period: 'Grant period',
    generated: 'Generated',
    columns: [
      'Code',
      'Description',
      'Category',
      'Budget',
      'Reserved',
      'Committed',
      'Actual',
      'Available',
      '% used',
    ],
    totals: 'Totals',
    categories: {
      supplies: 'Supplies',
      services: 'Services',
      staff: 'Staff',
      equipment: 'Equipment',
      running_costs: 'Running costs',
    },
    sheet: 'Budget status',
  },
  ar: {
    title: 'تقرير حالة الميزانية',
    grant: 'المنحة',
    donor: 'المانح',
    currency: 'العملة',
    period: 'فترة المنحة',
    generated: 'تاريخ الإعداد',
    columns: [
      'الرمز',
      'الوصف',
      'الفئة',
      'الميزانية',
      'المحجوز',
      'الملتزم به',
      'الفعلي',
      'المتاح',
      '% المستخدم',
    ],
    totals: 'الإجماليات',
    categories: {
      supplies: 'مستلزمات',
      services: 'خدمات',
      staff: 'موظفون',
      equipment: 'معدات',
      running_costs: 'تكاليف تشغيلية',
    },
    sheet: 'حالة الميزانية',
  },
};

const MONEY_FORMAT = '#,##0.00';

export class ReportService {
  constructor(
    private readonly run: <T>(fn: (store: ReportStore) => Promise<T>) => Promise<T>,
    private readonly now: () => Date = () => new Date()
  ) {}

  static forContext(ctx: RequestContext): ReportService {
    return new ReportService((fn) =>
      withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
        fn(new ReportRepository(tx.sql, ctx.tenantId))
      )
    );
  }

  /** GET /reports/budget-status?grantId= */
  budgetStatus(grantId: string): Promise<BudgetStatusReport & { timeZone: string }> {
    return this.run(async (store) => {
      const [grant, lines] = await Promise.all([store.grant(grantId), store.lines(grantId)]);
      if (!grant) throw new AppError('NOT_FOUND', 'grant not found');

      const rows = lines.map((l) => ({
        budgetLineId: l.budgetLineId,
        code: l.code,
        description: l.description,
        category: l.category,
        isActive: l.isActive,
        ...deriveFigures(l.budget, { reserved: l.reserved, committed: l.committed }, l.actual),
      }));
      const sum = (pick: (r: (typeof rows)[number]) => string) =>
        rows.reduce((acc, r) => acc.plus(pick(r)), new Decimal(0));
      const budgetTotal = sum((r) => r.budget);
      const { timeZone, ...grantFields } = grant;

      return {
        grant: grantFields,
        lines: rows,
        totals: deriveFigures(
          fixed2(budgetTotal),
          { reserved: fixed2(sum((r) => r.reserved)), committed: fixed2(sum((r) => r.committed)) },
          fixed2(sum((r) => r.actual))
        ),
        difference: fixed2(parseAmount(grant.totalAmount).minus(budgetTotal)),
        generatedAt: this.now().toISOString(),
        timeZone,
      };
    });
  }

  /** GET /reports/budget-status/lines/:budgetLineId/prs?status= */
  drillDown(budgetLineId: string, status?: 'reserved' | 'committed'): Promise<BudgetDrillDown> {
    return this.run(async (store) => {
      const line = await store.budgetLine(budgetLineId);
      if (!line) throw new AppError('NOT_FOUND', 'budget_line not found');
      const rows = await store.commitments(
        budgetLineId,
        status ? [status] : ['reserved', 'committed']
      );
      return {
        budgetLine: line,
        data: rows.map((r) => ({ ...r, currency: line.currency })),
        total: fixed2(rows.reduce((acc, r) => acc.plus(r.amount), new Decimal(0))),
      };
    });
  }

  /** GET /reports/budget-status/export.xlsx — localized headers, DD/MM/YYYY, 2-dp numbers. */
  async exportXlsx(
    grantId: string,
    locale: PrintLocale
  ): Promise<{ fileName: string; content: Buffer }> {
    const report = await this.budgetStatus(grantId);
    const t = LABELS[locale];
    const { grant } = report;

    const workbook = new ExcelJS.Workbook();
    workbook.created = this.now();
    const sheet = workbook.addWorksheet(t.sheet, {
      views: [{ rightToLeft: locale === 'ar', state: 'frozen', ySplit: 8 }],
    });
    sheet.columns = [
      { width: 14 },
      { width: 40 },
      { width: 18 },
      ...Array.from({ length: 5 }, () => ({ width: 16 })),
      { width: 10 },
    ];

    sheet.addRow([t.title]).font = { bold: true, size: 14 };
    sheet.addRow([t.grant, `${grant.code} — ${grant.name}`]);
    sheet.addRow([t.donor, grant.donorName ?? '']);
    sheet.addRow([t.currency, grant.currency]);
    // dates as text so Excel never re-renders them in the viewer's locale (research R15)
    sheet.addRow([t.period, `${formatDate(grant.startDate)} – ${formatDate(grant.endDate)}`]);
    sheet.addRow([t.generated, formatDateTime(report.generatedAt, report.timeZone)]);
    sheet.addRow([]);
    const header = sheet.addRow(t.columns);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });

    // Excel cells are IEEE doubles: exact for 2-dp amounts below 10^13
    const money = (value: string) => Number(value);
    const pct = (value: string | null) => (value === null ? null : Number(value));
    const addFigures = (
      first: (string | null)[],
      f: {
        budget: string;
        reserved: string;
        committed: string;
        actual: string;
        available: string;
        pctUsed: string | null;
      }
    ) => {
      const row = sheet.addRow([
        ...first,
        money(f.budget),
        money(f.reserved),
        money(f.committed),
        money(f.actual),
        money(f.available),
        pct(f.pctUsed),
      ]);
      for (let c = 4; c <= 8; c++) row.getCell(c).numFmt = MONEY_FORMAT;
      row.getCell(9).numFmt = '0.00';
      row.getCell(1).numFmt = '@';
      return row;
    };

    for (const line of report.lines) {
      addFigures([line.code, line.description, t.categories[line.category]], line);
    }
    addFigures([t.totals, null, null], report.totals).font = { bold: true };

    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    const safeCode = grant.code.replace(/[^A-Za-z0-9._-]+/g, '_');
    return { fileName: `budget-status-${safeCode}-${locale}.xlsx`, content };
  }
}
