// PR numbering (FR-004, Business Rule 9, research R6). Numbers are assigned at first submission
// (US4) inside the submit transaction; the year is that of the submission instant in the
// tenant's timezone, not the PR date.
import {
  calendarDateInTimeZone,
  type DocType,
  type NumberingConfigInput,
  type NumberingConfigResponse,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import {
  NumberingTxRepository,
  type NumberingStore,
  type NumberingTxStore,
} from '../repositories/numbering.repository';

/** Shown in previews when the organization has no office yet. */
export const PREVIEW_OFFICE_PLACEHOLDER = 'OFFICE';

export function formatNumber(
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
  async preview(docType: DocType, officeId?: string, now: Date = new Date()): Promise<string> {
    return this.previewWith(await this.store.getConfig(docType), docType, officeId, now);
  }

  async get(
    docType: DocType,
    officeId?: string,
    now: Date = new Date()
  ): Promise<NumberingConfigResponse> {
    const config = await this.store.getConfig(docType);
    return { docType, ...config, preview: await this.previewWith(config, docType, officeId, now) };
  }

  /** Changes apply to numbers assigned from now on; issued numbers never change (FR-005). */
  async update(
    docType: DocType,
    input: NumberingConfigInput,
    officeId?: string,
    now: Date = new Date()
  ): Promise<NumberingConfigResponse> {
    const config = await this.store.saveConfig(docType, input);
    return { docType, ...config, preview: await this.previewWith(config, docType, officeId, now) };
  }

  async assignNumber(
    tx: TxSql,
    docType: DocType,
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

  private async previewWith(
    config: NumberingConfigInput,
    docType: DocType,
    officeId: string | undefined,
    now: Date
  ): Promise<string> {
    const [office, timeZone] = await Promise.all([
      officeId ? this.store.office(officeId) : this.store.firstActiveOffice(),
      this.store.timeZone(),
    ]);
    const year = submissionYear(now, timeZone);
    const last = office ? await this.store.lastValue(docType, office.id, year) : 0;
    return formatNumber(config, office?.code ?? PREVIEW_OFFICE_PLACEHOLDER, year, last + 1);
  }
}

/** Transaction store for US4 submit: `new NumberingService(repo, numberingTxStore(tenantId))`. */
export function numberingTxStore(tenantId: string): (tx: TxSql) => NumberingTxStore {
  return (tx) => new NumberingTxRepository(tx, tenantId);
}
