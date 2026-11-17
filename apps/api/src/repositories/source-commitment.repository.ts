// budget_commitment rows of any source document (research D2): POs, contracts, amendments,
// direct payments, advances, settlements. PR rows keep going through BudgetTxRepository (001).
// Amounts are never edited: partial consumption releases the open row and inserts the
// remainder with supersedes_id ("split chain"), so every movement stays on record.
import type { DocTypeCode } from '@ngo/shared';
import type { TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { BudgetUsage, CommitmentStatus } from './budget-line.repository';

export type SourceReleaseReason =
  | 'returned'
  | 'rejected'
  | 'cancelled'
  | 'converted_to_po'
  | 'po_closed'
  | 'consumed_by_payment'
  | 'amended'
  | 'settled'
  | 'reversal_restore';

/** The document a commitment belongs to. PR sources also carry pr_id. */
export interface CommitmentSource {
  docType: DocTypeCode;
  docId: string;
}

/** The rate from the source's currency to the grant currency, locked when the row is created. */
export interface CommitmentRate {
  rateToGrant: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
}

export interface SourceCommitmentRow {
  id: string;
  sourceDocType: DocTypeCode;
  sourceDocId: string;
  sourceLineId: string | null;
  budgetLineId: string;
  cycle: number;
  amount: string;
  status: CommitmentStatus;
  releaseReason: SourceReleaseReason | null;
  supersedesId: string | null;
  rateToGrant: string | null;
}

export interface NewSourceCommitment {
  source: CommitmentSource;
  sourceLineId?: string | null;
  budgetLineId: string;
  cycle: number;
  amount: string;
  status: 'reserved' | 'committed';
  supersedesId?: string | null;
  rate?: CommitmentRate | null;
}

export interface SourceCommitmentStore {
  list(tx: TenantTx, source: CommitmentSource): Promise<SourceCommitmentRow[]>;
  find(tx: TenantTx, id: string): Promise<SourceCommitmentRow | null>;
  insert(tx: TenantTx, row: NewSourceCommitment): Promise<SourceCommitmentRow>;
  /** reserved → committed */
  commit(tx: TenantTx, id: string): Promise<SourceCommitmentRow>;
  release(tx: TenantTx, id: string, reason: SourceReleaseReason): Promise<SourceCommitmentRow>;
  /** Reserved / committed per budget line, without the source's own open rows. */
  usage(
    tx: TenantTx,
    budgetLineIds: readonly string[],
    exclude?: CommitmentSource
  ): Promise<Map<string, BudgetUsage>>;
}

interface Row {
  id: string;
  source_doc_type: DocTypeCode;
  source_doc_id: string;
  source_line_id: string | null;
  budget_line_id: string;
  cycle: number;
  amount: string;
  status: CommitmentStatus;
  release_reason: SourceReleaseReason | null;
  supersedes_id: string | null;
  rate_to_grant: string | null;
}

const RETURNING = `id, source_doc_type, source_doc_id, source_line_id, budget_line_id, cycle,
  amount::text as amount, status, release_reason, supersedes_id, rate_to_grant::text as rate_to_grant`;

function toRow(r: Row): SourceCommitmentRow {
  return {
    id: r.id,
    sourceDocType: r.source_doc_type,
    sourceDocId: r.source_doc_id,
    sourceLineId: r.source_line_id,
    budgetLineId: r.budget_line_id,
    cycle: r.cycle,
    amount: r.amount,
    status: r.status,
    releaseReason: r.release_reason,
    supersedesId: r.supersedes_id,
    rateToGrant: r.rate_to_grant,
  };
}

export class SourceCommitmentRepository implements SourceCommitmentStore {
  constructor(private readonly tenantId: string) {}

  async list(tx: TenantTx, source: CommitmentSource): Promise<SourceCommitmentRow[]> {
    const rows = await tx.sql.unsafe<Row[]>(
      `select ${RETURNING} from public.budget_commitment
       where tenant_id = $1 and source_doc_type = $2 and source_doc_id = $3
       order by cycle, budget_line_id, created_at, id`,
      [this.tenantId, source.docType, source.docId]
    );
    return rows.map(toRow);
  }

  async find(tx: TenantTx, id: string): Promise<SourceCommitmentRow | null> {
    const [row] = await tx.sql.unsafe<Row[]>(
      `select ${RETURNING} from public.budget_commitment where tenant_id = $1 and id = $2`,
      [this.tenantId, id]
    );
    return row ? toRow(row) : null;
  }

  async insert(tx: TenantTx, r: NewSourceCommitment): Promise<SourceCommitmentRow> {
    const prId = r.source.docType === 'PR' ? r.source.docId : null;
    const [row] = await tx.sql.unsafe<Row[]>(
      `insert into public.budget_commitment
         (tenant_id, budget_line_id, pr_id, source_doc_type, source_doc_id, source_line_id, cycle,
          amount, status, committed_at, supersedes_id, rate_to_grant, rate_date, rate_source,
          exchange_rate_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               case when $9 = 'committed' then now() end, $10, $11, $12, $13, $14)
       returning ${RETURNING}`,
      [
        this.tenantId,
        r.budgetLineId,
        prId,
        r.source.docType,
        r.source.docId,
        r.sourceLineId ?? null,
        r.cycle,
        r.amount,
        r.status,
        r.supersedesId ?? null,
        r.rate?.rateToGrant ?? null,
        r.rate?.rateDate ?? null,
        r.rate?.rateSource ?? null,
        r.rate?.exchangeRateId ?? null,
      ]
    );
    return toRow(row!);
  }

  async commit(tx: TenantTx, id: string): Promise<SourceCommitmentRow> {
    const [row] = await tx.sql.unsafe<Row[]>(
      `update public.budget_commitment set status = 'committed', committed_at = now()
       where tenant_id = $1 and id = $2 and status = 'reserved'
       returning ${RETURNING}`,
      [this.tenantId, id]
    );
    if (!row) throw new AppError('INVALID_STATE', 'Only a reserved commitment can be committed');
    return toRow(row);
  }

  async release(
    tx: TenantTx,
    id: string,
    reason: SourceReleaseReason
  ): Promise<SourceCommitmentRow> {
    const [row] = await tx.sql.unsafe<Row[]>(
      `update public.budget_commitment
       set status = 'released', released_at = now(), release_reason = $3
       where tenant_id = $1 and id = $2 and status in ('reserved', 'committed')
       returning ${RETURNING}`,
      [this.tenantId, id, reason]
    );
    if (!row) throw new AppError('INVALID_STATE', 'The commitment is already released');
    return toRow(row);
  }

  async usage(
    tx: TenantTx,
    budgetLineIds: readonly string[],
    exclude?: CommitmentSource
  ): Promise<Map<string, BudgetUsage>> {
    const usage = new Map<string, BudgetUsage>();
    if (budgetLineIds.length === 0) return usage;
    const rows = await tx.sql<{ budget_line_id: string; reserved: string; committed: string }[]>`
      select c.budget_line_id,
             coalesce(sum(c.amount) filter (where c.status = 'reserved'), 0)::text as reserved,
             coalesce(sum(c.amount) filter (where c.status = 'committed'), 0)::text as committed
      from public.budget_commitment c
      where c.budget_line_id in ${tx.sql([...new Set(budgetLineIds)])}
        and c.status in ('reserved', 'committed')
        and not (
          c.source_doc_type is not distinct from ${exclude?.docType ?? null}::text
          and c.source_doc_id is not distinct from ${exclude?.docId ?? null}::uuid
        )
      group by c.budget_line_id`;
    for (const r of rows) {
      usage.set(r.budget_line_id, { reserved: r.reserved, committed: r.committed });
    }
    return usage;
  }
}
