// sourcing_invitation: invited suppliers with their channel (data-model §4). Only approved
// suppliers are invited (trigger); overdue vetting and expired documents show as warnings
// through supplier_compliance (US2-1).
import type {
  InvitationChannel,
  SourcingInvitationInput,
  SourcingInvitationView,
  SupplierStatus,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  supplier_id: string;
  legal_name_ar: string;
  legal_name_en: string;
  status: SupplierStatus;
  vetting_overdue: boolean;
  has_expired_required_doc: boolean;
  can_invite: boolean;
  can_award_or_pay: boolean;
  invited_on: string;
  channel: InvitationChannel;
}

export class SourcingInvitationRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(eventId: string): Promise<SourcingInvitationView[]> {
    const rows = await this.sql<Row[]>`
      select i.id, i.supplier_id, s.legal_name_ar, s.legal_name_en, s.status,
             c.vetting_overdue, c.has_expired_required_doc, c.can_invite, c.can_award_or_pay,
             i.invited_on::text, i.channel
      from public.sourcing_invitation i
      join public.supplier s on s.id = i.supplier_id
      join public.supplier_compliance c on c.supplier_id = s.id
      where i.tenant_id = ${this.tenantId} and i.sourcing_event_id = ${eventId}
      order by s.legal_name_en`;
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierNameAr: r.legal_name_ar,
      supplierNameEn: r.legal_name_en,
      supplierStatus: r.status,
      compliance: {
        vettingOverdue: r.vetting_overdue,
        hasExpiredRequiredDoc: r.has_expired_required_doc,
        canInvite: r.can_invite,
        canAwardOrPay: r.can_award_or_pay,
      },
      invitedOn: r.invited_on,
      channel: r.channel,
    }));
  }

  async replace(
    eventId: string,
    invitations: readonly SourcingInvitationInput[],
    today: string
  ): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.sourcing_invitation
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}`;
    if (invitations.length === 0) return;
    await sql`
      insert into public.sourcing_invitation ${sql(
        invitations.map((i) => ({
          tenant_id: this.tenantId,
          sourcing_event_id: eventId,
          supplier_id: i.supplierId,
          channel: i.channel,
          invited_on: i.invitedOn ?? today,
        }))
      )}`;
  }

  /** Invited suppliers that are approved now (US3-4). */
  async countApproved(eventId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n
      from public.sourcing_invitation i
      join public.supplier s on s.id = i.supplier_id
      where i.tenant_id = ${this.tenantId} and i.sourcing_event_id = ${eventId}
        and s.status = 'approved'`;
    return row?.n ?? 0;
  }

  /** Invitation rows to copy onto a re-issued event. */
  async inputs(eventId: string): Promise<SourcingInvitationInput[]> {
    const rows = await this.sql<{ supplier_id: string; channel: InvitationChannel }[]>`
      select i.supplier_id, i.channel
      from public.sourcing_invitation i
      join public.supplier s on s.id = i.supplier_id
      where i.tenant_id = ${this.tenantId} and i.sourcing_event_id = ${eventId}
        and s.status = 'approved'`;
    return rows.map((r) => ({ supplierId: r.supplier_id, channel: r.channel }));
  }
}
