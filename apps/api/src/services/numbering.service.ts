// Document numbering (FR-004, Business Rule 9, research R6; 002 D7 for every registered code).
// Numbers are assigned inside the transaction that submits (or, for GRN, SCC and INV, creates)
// the document, per type, office and year; the year is that of the instant in the tenant's
// timezone, not the document date. A rolled-back transaction never consumes a number.
import {
  calendarDateInTimeZone,
  formatDocumentNumber,
  type DocTypeCode,
  type NumberingConfigInput,
  type NumberingConfigResponse,
  type NumberingPreviewParts,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import {
  NumberingTxRepository,
  type NumberingStore,
  type NumberingTxStore,
} from '../repositories/numbering.repository';

/** Shown in previews when the organization has no office yet. */
export const PREVIEW_OFFICE_PLACEHOLDER = 'OFFICE';

/** The one formatter, shared with the web form's live preview. */
export const formatNumber = formatDocumentNumber;

export function submissionYear(submittedAt: string | Date, timeZone: string): number {
  return Number(calendarDateInTimeZone(submittedAt, timeZone).slice(0, 4));
}

export class NumberingService {
  constructor(
    private readonly store: NumberingStore,
    private readonly txStore: (tx: TxSql) => NumberingTxStore = () => {
      throw new Error('NumberingService needs a transaction store to assign numbers');
    }
  ) {}

  /** Next number for the office, without consuming it. */
  async preview(docType: DocTypeCode, officeId?: string, now: Date = new Date()): Promise<string> {
    const config = await this.store.getConfig(docType);
    const parts = await this.previewParts(docType, officeId, now);
    return formatNumber(config, parts.officeCode, parts.year, parts.seq);
  }

  async get(
    docType: DocTypeCode,
    officeId?: string,
    now: Date = new Date()
  ): Promise<NumberingConfigResponse> {
    return this.withPreview(docType, await this.store.getConfig(docType), officeId, now);
  }

  /** Changes apply to numbers assigned from now on; issued numbers never change (FR-005). */
  async update(
    docType: DocTypeCode,
    input: NumberingConfigInput,
    officeId?: string,
    now: Date = new Date()
  ): Promise<NumberingConfigResponse> {
    return this.withPreview(docType, await this.store.saveConfig(docType, input), officeId, now);
  }

  async assignNumber(
    tx: TxSql,
    docType: DocTypeCode,
    officeId: string,
    submittedAt: string | Date,
    timeZone: string
  ): Promise<string> {
    const store = this.txStore(tx);
    const [config, office] = await Promise.all([store.getConfig(docType), store.office(officeId)]);
    const year = submissionYear(submittedAt, timeZone);
    const seq = await store.nextValue(docType, office.id, year);
    return formatNumber(config, office.code, year, seq);
  }

  private async withPreview(
    docType: DocTypeCode,
    config: NumberingConfigInput,
    officeId: string | undefined,
    now: Date
  ): Promise<NumberingConfigResponse> {
    const parts = await this.previewParts(docType, officeId, now);
    const preview = formatNumber(config, parts.officeCode, parts.year, parts.seq);
    return { docType, ...config, preview, previewParts: parts };
  }

  private async previewParts(
    docType: DocTypeCode,
    officeId: string | undefined,
    now: Date
  ): Promise<NumberingPreviewParts> {
    const [office, timeZone] = await Promise.all([
      officeId ? this.store.office(officeId) : this.store.firstActiveOffice(),
      this.store.timeZone(),
    ]);
    const year = submissionYear(now, timeZone);
    const last = office ? await this.store.lastValue(docType, office.id, year) : 0;
    return { officeCode: office?.code ?? PREVIEW_OFFICE_PLACEHOLDER, year, seq: last + 1 };
  }
}

/** Transaction store for US4 submit: `new NumberingService(repo, numberingTxStore(tenantId))`. */
export function numberingTxStore(tenantId: string): (tx: TxSql) => NumberingTxStore {
  return (tx) => new NumberingTxRepository(tx, tenantId);
}
