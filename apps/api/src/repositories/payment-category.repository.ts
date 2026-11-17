// payment_category: direct-payment categories; `procurement_only` ones need a PO (US15-3).
import type { PaymentCategory } from '@ngo/shared';
import {
  CategoryRepository,
  type CategoryRow,
  type CategoryValues,
} from './supplier-category.repository';

export class PaymentCategoryRepository extends CategoryRepository<PaymentCategory> {
  protected readonly table = 'payment_category' as const;
  protected readonly label = 'Payment category';

  protected extraColumns() {
    return this.sql`, procurement_only`;
  }

  protected row(values: CategoryValues): Record<string, unknown> {
    const out = super.row(values);
    if (values.procurementOnly !== undefined) out.procurement_only = values.procurementOnly;
    return out;
  }

  protected toItem(r: CategoryRow): PaymentCategory {
    return {
      id: r.id,
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      isActive: r.is_active,
      version: r.version,
      procurementOnly: r.procurement_only ?? false,
    };
  }
}
