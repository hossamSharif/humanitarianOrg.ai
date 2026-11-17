// committee_member (data-model §4, US5-4, US5-5): the analysis committee with each member's
// conflict-of-interest declaration (made once) and replacements. A member scores only after
// declaring no conflict, and only while not replaced.
import type { CommitteeFunction, CommitteeMemberView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  user_id: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  function: CommitteeFunction;
  declared_at: Date | null;
  has_conflict: boolean | null;
  conflict_supplier_ids: string[];
  excluded: boolean;
  replaced_by_id: string | null;
  signed_at: Date | null;
}

export interface CommitteeMemberRecord extends CommitteeMemberView {
  /** declared, no conflict, not replaced */
  eligible: boolean;
}

export class CommitteeMemberRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(analysisId: string): Promise<CommitteeMemberRecord[]> {
    const rows = await this.sql<Row[]>`
      select c.id, c.user_id, m.full_name_ar, m.full_name_en, c.function, c.declared_at,
             c.has_conflict, c.conflict_supplier_ids, c.excluded, c.replaced_by_id,
             (select s.acted_at from public.doc_signature s
              where s.doc_type = 'QA' and s.doc_id = c.bid_analysis_id
                and s.user_id = c.user_id and s.action = 'committee_sign') as signed_at
      from public.committee_member c
      left join public.membership m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
      where c.tenant_id = ${this.tenantId} and c.bid_analysis_id = ${analysisId}
      order by c.created_at, c.id`;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      nameAr: r.full_name_ar ?? '',
      nameEn: r.full_name_en ?? '',
      function: r.function,
      declaredAt: r.declared_at?.toISOString() ?? null,
      hasConflict: r.has_conflict,
      conflictSupplierIds: r.conflict_supplier_ids,
      excluded: r.excluded,
      replacedById: r.replaced_by_id,
      signedAt: r.signed_at?.toISOString() ?? null,
      eligible: r.declared_at !== null && !r.excluded && r.replaced_by_id === null,
    }));
  }

  async insert(analysisId: string, userId: string, fn: CommitteeFunction): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.committee_member (tenant_id, bid_analysis_id, user_id, function)
      values (${this.tenantId}, ${analysisId}, ${userId}, ${fn})
      returning id`;
    return row!.id;
  }

  async setFunction(id: string, fn: CommitteeFunction): Promise<void> {
    await this.sql`
      update public.committee_member set function = ${fn}
      where tenant_id = ${this.tenantId} and id = ${id} and function <> ${fn}`;
  }

  /** Only an undeclared member is removed; a declared one is replaced (kept for the record). */
  async remove(id: string): Promise<void> {
    await this.sql`
      delete from public.committee_member
      where tenant_id = ${this.tenantId} and id = ${id} and declared_at is null`;
  }

  async markReplaced(id: string, replacementId: string): Promise<void> {
    await this.sql`
      update public.committee_member set replaced_by_id = ${replacementId}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async declare(
    id: string,
    values: { hasConflict: boolean; conflictSupplierIds: readonly string[]; note: string | null }
  ): Promise<void> {
    const sql = this.sql;
    await sql`
      update public.committee_member
      set declared_at = now(), has_conflict = ${values.hasConflict},
          conflict_supplier_ids = ${sql.array([...values.conflictSupplierIds])}::uuid[],
          conflict_note = ${values.note}
      where tenant_id = ${this.tenantId} and id = ${id} and declared_at is null`;
  }

  async isMember(userId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.membership
      where tenant_id = ${this.tenantId} and user_id = ${userId} and status = 'active'`;
    return row !== undefined;
  }
}
