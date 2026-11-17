// opening_record and opening_attendee (data-model §4, research D3): who opened the quotations,
// where and when (database time), with the attendees. Written once by the opening command.
import type { OpeningView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface AttendeeValues {
  userId: string | null;
  externalName: string | null;
  function: string;
}

export class OpeningRecordRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Inserts the record at `now()` and returns its id and time. */
  async insert(
    eventId: string,
    values: { place: string | null; notes: string | null }
  ): Promise<{ id: string; openedAt: Date }> {
    const [row] = await this.sql<{ id: string; opened_at: Date }[]>`
      insert into public.opening_record (tenant_id, sourcing_event_id, opened_at, place, notes)
      values (${this.tenantId}, ${eventId}, now(), ${values.place}, ${values.notes})
      returning id, opened_at`;
    return { id: row!.id, openedAt: row!.opened_at };
  }

  async addAttendees(recordId: string, attendees: readonly AttendeeValues[]): Promise<void> {
    if (attendees.length === 0) return;
    const sql = this.sql;
    await sql`
      insert into public.opening_attendee ${sql(
        attendees.map((a) => ({
          tenant_id: this.tenantId,
          opening_record_id: recordId,
          user_id: a.userId,
          external_name: a.externalName,
          function: a.function,
        }))
      )}`;
  }

  async find(eventId: string): Promise<OpeningView | null> {
    const [record] = await this.sql<
      {
        id: string;
        opened_at: Date;
        place: string | null;
        notes: string | null;
        signed_complete_at: Date | null;
      }[]
    >`
      select id, opened_at, place, notes, signed_complete_at from public.opening_record
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}`;
    if (!record) return null;
    const attendees = await this.sql<
      { user_id: string | null; name: string | null; function: string }[]
    >`
      select a.user_id, coalesce(a.external_name, m.full_name_en, m.full_name_ar) as name,
             a.function
      from public.opening_attendee a
      left join public.membership m on m.tenant_id = a.tenant_id and m.user_id = a.user_id
      where a.opening_record_id = ${record.id}
      order by a.created_at, a.id`;
    return {
      openedAt: record.opened_at.toISOString(),
      place: record.place,
      notes: record.notes,
      attendees: attendees.map((a) => ({
        userId: a.user_id,
        name: a.name ?? '',
        function: a.function,
      })),
      signedCompleteAt: record.signed_complete_at?.toISOString() ?? null,
    };
  }

  /** The database clock (the opening is checked against it, never the client's). */
  async now(): Promise<Date> {
    const [row] = await this.sql<{ now: Date }[]>`select now() as now`;
    return row!.now;
  }
}
