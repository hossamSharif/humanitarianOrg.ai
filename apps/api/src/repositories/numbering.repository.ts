// numbering_config and document_sequence (research R6). Configuration goes through supabase-js;
// the sequence is incremented only inside the PR submit transaction.
import type { Tables } from '@ngo/database';
import type { DocType, NumberingConfigInput } from '@ngo/shared';
import type { UserClient } from '../db/supabase';
import type { TxSql } from '../db/tx';
import { AppError, fromPostgresError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { BaseRepository } from './base.repository';

export interface OfficeRef {
  id: string;
  code: string;
}

/** What preview and configuration need. */
export interface NumberingStore {
  getConfig(docType: DocType): Promise<NumberingConfigInput>;
  saveConfig(docType: DocType, input: NumberingConfigInput): Promise<NumberingConfigInput>;
  office(officeId: string): Promise<OfficeRef>;
  firstActiveOffice(): Promise<OfficeRef | null>;
  /** current last_value of the sequence, 0 when it has not started */
  lastValue(docType: DocType, officeId: string, year: number): Promise<number>;
  timeZone(): Promise<string>;
}

/** What number assignment needs, inside the caller's transaction. */
export interface NumberingTxStore {
  getConfig(docType: DocType): Promise<NumberingConfigInput>;
  office(officeId: string): Promise<OfficeRef>;
  nextValue(docType: DocType, officeId: string, year: number): Promise<number>;
}

function toConfig(row: Tables<'numbering_config'>): NumberingConfigInput {
  return {
    prefix: row.prefix,
    includeOffice: row.include_office,
    includeYear: row.include_year,
    padding: row.padding,
    separator: row.separator,
  };
}

function raise(error: { code?: string; message: string }): never {
  throw fromPostgresError(error) ?? new AppError('INTERNAL_ERROR', error.message);
}

export class NumberingRepository
  extends BaseRepository<Tables<'numbering_config'>>
  implements NumberingStore
{
  constructor(ctx: RequestContext, db?: UserClient) {
    super(ctx, 'numbering_config', db);
  }

  async getConfig(docType: DocType): Promise<NumberingConfigInput> {
    const { data, error } = await this.query().select('*').eq('doc_type', docType).maybeSingle();
    if (error) raise(error);
    if (!data) throw new AppError('NOT_FOUND', `No numbering configured for ${docType}`);
    return toConfig(data as Tables<'numbering_config'>);
  }

  async saveConfig(docType: DocType, input: NumberingConfigInput): Promise<NumberingConfigInput> {
    const { data, error } = await this.query()
      .upsert(
        {
          tenant_id: this.ctx.tenantId,
          doc_type: docType,
          prefix: input.prefix,
          include_office: input.includeOffice,
          include_year: input.includeYear,
          padding: input.padding,
          separator: input.separator,
        },
        { onConflict: 'tenant_id,doc_type' }
      )
      .select()
      .single();
    if (error) raise(error);
    return toConfig(data as Tables<'numbering_config'>);
  }

  async office(officeId: string): Promise<OfficeRef> {
    const { data, error } = await this.db
      .from('office')
      .select('id, code')
      .eq('id', officeId)
      .maybeSingle();
    if (error) raise(error);
    if (!data) throw new AppError('NOT_FOUND', 'office not found');
    return data;
  }

  async firstActiveOffice(): Promise<OfficeRef | null> {
    const { data, error } = await this.db
      .from('office')
      .select('id, code')
      .eq('is_active', true)
      .order('code')
      .limit(1)
      .maybeSingle();
    if (error) raise(error);
    return data ?? null;
  }

  async lastValue(docType: DocType, officeId: string, year: number): Promise<number> {
    const { data, error } = await this.db
      .from('document_sequence')
      .select('last_value')
      .eq('doc_type', docType)
      .eq('office_id', officeId)
      .eq('year', year)
      .maybeSingle();
    if (error) raise(error);
    return data?.last_value ?? 0;
  }

  async timeZone(): Promise<string> {
    const { data, error } = await this.db
      .from('tenant')
      .select('timezone')
      .eq('id', this.ctx.tenantId)
      .single();
    if (error) raise(error);
    return data.timezone;
  }

  /** Next number in the sequence; the row lock serializes concurrent submits (gap-free). */
  nextValue(tx: TxSql, docType: DocType, officeId: string, year: number): Promise<number> {
    return new NumberingTxRepository(tx, this.ctx.tenantId).nextValue(docType, officeId, year);
  }
}

export class NumberingTxRepository implements NumberingTxStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async getConfig(docType: DocType): Promise<NumberingConfigInput> {
    const [row] = await this.sql<Tables<'numbering_config'>[]>`
      select * from public.numbering_config
      where tenant_id = ${this.tenantId} and doc_type = ${docType}`;
    if (!row) throw new AppError('NOT_FOUND', `No numbering configured for ${docType}`);
    return toConfig(row);
  }

  async office(officeId: string): Promise<OfficeRef> {
    const [row] = await this.sql<OfficeRef[]>`
      select id, code from public.office where id = ${officeId}`;
    if (!row) throw new AppError('NOT_FOUND', 'office not found');
    return row;
  }

  async nextValue(docType: DocType, officeId: string, year: number): Promise<number> {
    const [row] = await this.sql<{ last_value: number }[]>`
      insert into public.document_sequence as s (tenant_id, doc_type, office_id, year, last_value)
      values (${this.tenantId}, ${docType}, ${officeId}, ${year}, 1)
      on conflict (tenant_id, doc_type, office_id, year)
        do update set last_value = s.last_value + 1
      returning s.last_value`;
    return row!.last_value;
  }
}
