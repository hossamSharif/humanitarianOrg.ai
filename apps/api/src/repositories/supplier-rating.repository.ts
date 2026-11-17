// supplier_rating (data-model §3): one rating per PO (FR-013); the trigger refreshes the
// supplier's averages.
import type { PoRatingInput } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export class SupplierRatingRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async exists(poId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.supplier_rating where tenant_id = ${this.tenantId} and po_id = ${poId}`;
    return !!row;
  }

  async insert(poId: string, supplierId: string, input: PoRatingInput): Promise<void> {
    if (await this.exists(poId)) {
      throw new AppError('INVALID_STATE', 'This purchase order is already rated');
    }
    await this.sql`
      insert into public.supplier_rating
        (tenant_id, supplier_id, po_id, on_time, quality, documentation, comment)
      values (${this.tenantId}, ${supplierId}, ${poId}, ${input.onTime}, ${input.quality},
              ${input.documentation}, ${input.comment ?? null})`;
  }
}
