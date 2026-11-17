// GET /rfqs/:id/print?supplierId=&locale= (US20-2, contracts/print-layout.md): the request for
// quotation addressed to one invited supplier. It carries the lines, terms and published criteria
// and nothing about offers: no prices, no other supplier's name, no receipt. The data is parsed
// with the strict `rfqPrintData` schema, so an offer or price key cannot reach the template.
import { rfqPrintData, type PrintLocale, type RfqPrintData } from '@ngo/shared';
import { withTenantTx, type TxSql } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { RequestContext } from '../../types/context';
import { SupabasePrintAssets, type PrintAssets } from '../pr-print.service';

export interface RfqPrintSource {
  event: {
    number: string | null;
    status: string;
    title: string;
    issueDate: string | null;
    submissionDeadline: string | null;
    deliveryPlace: string | null;
    deliveryTerms: string | null;
    paymentTerms: string | null;
    currency: string;
    offerValidityDays: number | null;
  };
  organization: { nameAr: string; nameEn: string; address: string | null; logoPath: string | null };
  office: { code: string; nameAr: string; nameEn: string };
  supplier: {
    nameAr: string;
    nameEn: string;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  lines: {
    lineNo: number;
    description: string | null;
    specifications: string | null;
    quantity: string;
    unit: string | null;
  }[];
  criteria: {
    nameAr: string;
    nameEn: string;
    kind: 'essential' | 'weighted';
    weightPct: string | null;
  }[];
}

export interface RfqPrintDeps {
  /** null when the event is missing, or the supplier is not invited to it */
  load(eventId: string, supplierId: string): Promise<RfqPrintSource | null>;
  assets: PrintAssets;
}

/** Reads only header, invitation, line and criterion columns — never offer tables. */
export async function loadRfqPrintSource(
  sql: TxSql,
  tenantId: string,
  eventId: string,
  supplierId: string
): Promise<RfqPrintSource | null> {
  const [head] = await sql<
    {
      number: string | null;
      status: string;
      title: string;
      issue_date: string | null;
      submission_deadline: Date | null;
      delivery_place: string | null;
      delivery_terms: string | null;
      payment_terms: string | null;
      currency: string;
      offer_validity_days: number | null;
      org_name_ar: string;
      org_name_en: string;
      org_address: string | null;
      logo_path: string | null;
      office_code: string;
      office_name_ar: string;
      office_name_en: string;
      supplier_name_ar: string;
      supplier_name_en: string;
      supplier_address: string | null;
      supplier_phone: string | null;
      supplier_email: string | null;
    }[]
  >`
    select e.number, e.status, e.title, e.issue_date::text, e.submission_deadline,
           e.delivery_place, e.delivery_terms, e.payment_terms, e.currency::text,
           e.offer_validity_days, t.name_ar as org_name_ar, t.name_en as org_name_en,
           t.address as org_address, t.logo_path, o.code as office_code,
           o.name_ar as office_name_ar, o.name_en as office_name_en,
           s.legal_name_ar as supplier_name_ar, s.legal_name_en as supplier_name_en,
           s.address as supplier_address, s.phone as supplier_phone, s.email as supplier_email
    from public.sourcing_event e
    join public.tenant t on t.id = e.tenant_id
    join public.office o on o.id = e.office_id
    join public.sourcing_invitation i on i.sourcing_event_id = e.id and i.supplier_id = ${supplierId}
    join public.supplier s on s.id = i.supplier_id
    where e.tenant_id = ${tenantId} and e.id = ${eventId} and e.kind = 'rfq'`;
  if (!head) return null;

  const lines = await sql<
    {
      line_no: number;
      description: string | null;
      specifications: string | null;
      quantity: string;
      unit: string | null;
    }[]
  >`
    select l.line_no, l.description, l.specifications, l.quantity::text, u.code as unit
    from public.sourcing_line l
    left join public.unit_of_measure u on u.id = l.unit_id
    where l.sourcing_event_id = ${eventId}
    order by l.line_no`;
  const criteria = await sql<
    {
      name_ar: string;
      name_en: string;
      kind: 'essential' | 'weighted';
      weight_pct: string | null;
    }[]
  >`
    select name_ar, name_en, kind, weight_pct::text
    from public.sourcing_criterion
    where sourcing_event_id = ${eventId}
    order by stage, sort_order`;

  return {
    event: {
      number: head.number,
      status: head.status,
      title: head.title,
      issueDate: head.issue_date,
      submissionDeadline: head.submission_deadline?.toISOString() ?? null,
      deliveryPlace: head.delivery_place,
      deliveryTerms: head.delivery_terms,
      paymentTerms: head.payment_terms,
      currency: head.currency,
      offerValidityDays: head.offer_validity_days,
    },
    organization: {
      nameAr: head.org_name_ar,
      nameEn: head.org_name_en,
      address: head.org_address,
      logoPath: head.logo_path,
    },
    office: { code: head.office_code, nameAr: head.office_name_ar, nameEn: head.office_name_en },
    supplier: {
      nameAr: head.supplier_name_ar,
      nameEn: head.supplier_name_en,
      address: head.supplier_address,
      phone: head.supplier_phone,
      email: head.supplier_email,
    },
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      description: l.description,
      specifications: l.specifications,
      quantity: l.quantity,
      unit: l.unit,
    })),
    criteria: criteria.map((c) => ({
      nameAr: c.name_ar,
      nameEn: c.name_en,
      kind: c.kind,
      weightPct: c.weight_pct,
    })),
  };
}

export function buildRfqPrintData(
  source: RfqPrintSource,
  locale: PrintLocale,
  logoUrl: string | null
): RfqPrintData {
  const { event } = source;
  const watermark =
    event.status === 'draft' ? 'DRAFT' : event.status === 'cancelled' ? 'CANCELLED' : null;
  return rfqPrintData.parse({
    docType: 'RFQ',
    locale,
    number: event.number,
    status: event.status,
    watermark,
    organization: {
      nameAr: source.organization.nameAr,
      nameEn: source.organization.nameEn,
      address: source.organization.address,
      logoUrl,
    },
    office: source.office,
    supplier: source.supplier,
    title: event.title,
    issueDate: event.issueDate,
    submissionDeadline: event.submissionDeadline,
    deliveryPlace: event.deliveryPlace,
    deliveryTerms: event.deliveryTerms,
    paymentTerms: event.paymentTerms,
    currency: event.currency,
    offerValidityDays: event.offerValidityDays,
    lines: source.lines,
    criteria: source.criteria.map((c) => ({
      name: locale === 'ar' ? c.nameAr : c.nameEn,
      kind: c.kind,
      weightPct: c.weightPct,
    })),
  });
}

export class RfqPrintService {
  constructor(private readonly deps: RfqPrintDeps) {}

  static forContext(ctx: RequestContext): RfqPrintService {
    return new RfqPrintService({
      load: (eventId, supplierId) =>
        withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
          loadRfqPrintSource(tx.sql, ctx.tenantId, eventId, supplierId)
        ),
      assets: new SupabasePrintAssets(ctx.accessToken),
    });
  }

  async printData(eventId: string, supplierId: string, locale: PrintLocale): Promise<RfqPrintData> {
    const source = await this.deps.load(eventId, supplierId);
    if (!source) {
      throw new AppError('NOT_FOUND', 'RFQ not found, or the supplier is not invited to it');
    }
    const { logoPath } = source.organization;
    const logoUrl = logoPath ? await this.deps.assets.logoUrl(logoPath) : null;
    return buildRfqPrintData(source, locale, logoUrl);
  }
}
