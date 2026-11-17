// Document type registry for 002 (research D1/D7, data-model §1 and §12). Mirrors
// app.doc_type_registry and app.doa_type (migration 0012) — keep both in sync.

/** Every registered document code; also the numbering prefix (research D7). */
export const DOC_TYPE_CODES = [
  'PR',
  'RFQ',
  'TND',
  'QA',
  'WVR',
  'PO',
  'CON',
  'AMD',
  'GRN',
  'SCC',
  'INV',
  'PAY',
  'DPR',
  'ADV',
  'STL',
  'BPV',
  'CPV',
  'BRV',
  'CRV',
  'JV',
  'TRF',
] as const;
export type DocTypeCode = (typeof DOC_TYPE_CODES)[number];

/** DoA route types: the values of approval_rule.doc_type. */
export const DOA_TYPES = [
  'PR',
  'AWARD',
  'PO',
  'CON',
  'AMD',
  'WAIVER',
  'PAY',
  'DPR',
  'PV',
  'RV',
  'JV',
  'ADV',
  'STL',
] as const;
export type DoaType = (typeof DOA_TYPES)[number];

/** The DoA route a document type follows; null for types completed by signing or issuing. */
export const DOC_TYPE_DOA: Record<DocTypeCode, DoaType | null> = {
  PR: 'PR',
  RFQ: null,
  TND: null,
  QA: 'AWARD',
  WVR: 'WAIVER',
  PO: 'PO',
  CON: 'CON',
  AMD: 'AMD',
  GRN: null,
  SCC: null,
  INV: null,
  PAY: 'PAY',
  DPR: 'DPR',
  ADV: 'ADV',
  STL: 'STL',
  BPV: 'PV',
  CPV: 'PV',
  BRV: 'RV',
  CRV: 'RV',
  JV: 'JV',
  TRF: 'PV',
};

/** Numbered when created rather than at first submission (no DoA route). */
export const NUMBERED_ON_CREATION: readonly DocTypeCode[] = ['GRN', 'SCC', 'INV'];

export const VOUCHER_TYPES = ['BPV', 'CPV', 'BRV', 'CRV', 'JV', 'TRF'] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export function isDocTypeCode(value: unknown): value is DocTypeCode {
  return typeof value === 'string' && (DOC_TYPE_CODES as readonly string[]).includes(value);
}

export function isDoaType(value: unknown): value is DoaType {
  return typeof value === 'string' && (DOA_TYPES as readonly string[]).includes(value);
}

/** Step kinds of any route: 001's three plus the voucher `check` (data-model §1). */
export const DOC_STEP_KINDS = ['finance_check', 'check', 'approval', 'final_approval'] as const;
export type DocStepKind = (typeof DOC_STEP_KINDS)[number];

/** The kind step 1 must have, per DoA type (app.approval_rule_check); null = no requirement. */
export const REQUIRED_FIRST_KIND: Record<DoaType, DocStepKind | null> = {
  PR: 'finance_check',
  AWARD: null,
  PO: null,
  CON: null,
  AMD: null,
  WAIVER: null,
  PAY: null,
  DPR: null,
  PV: 'check',
  RV: 'check',
  JV: 'check',
  ADV: null,
  STL: null,
};

// ---------------------------------------------------------------------------------------------
// Route paths of the approvable types (contracts/rest-api.md "Shared document actions")
// ---------------------------------------------------------------------------------------------

export const DOC_SLUGS = [
  'bid-analyses',
  'waivers',
  'pos',
  'contracts',
  'amendments',
  'payment-requests',
  'direct-payments',
  'advances',
  'settlements',
  'vouchers',
] as const;
export type DocTypeSlug = (typeof DOC_SLUGS)[number];

/** Document codes served under each slug; `vouchers` serves every voucher kind. */
export const DOC_SLUG_TYPES: Record<DocTypeSlug, readonly DocTypeCode[]> = {
  'bid-analyses': ['QA'],
  waivers: ['WVR'],
  pos: ['PO'],
  contracts: ['CON'],
  amendments: ['AMD'],
  'payment-requests': ['PAY'],
  'direct-payments': ['DPR'],
  advances: ['ADV'],
  settlements: ['STL'],
  vouchers: VOUCHER_TYPES,
};

/** The slug a document code is served under; null for PRs (001 routes) and non-approvable types. */
export function slugForDocType(code: DocTypeCode): DocTypeSlug | null {
  for (const slug of DOC_SLUGS) {
    if (DOC_SLUG_TYPES[slug].includes(code)) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// State enums per document (data-model §12)
// ---------------------------------------------------------------------------------------------

/** States every DoA-routed document shares around its approval. */
const APPROVAL_STATES = [
  'draft',
  'pending_approval',
  'approved',
  'returned',
  'rejected',
  'cancelled',
] as const;

export const SOURCING_EVENT_STATUSES = [
  'draft',
  'issued',
  'closed',
  'opened',
  'evaluated',
  'awarded',
  'cancelled',
] as const;
export type SourcingEventStatus = (typeof SOURCING_EVENT_STATUSES)[number];

export const BID_ANALYSIS_STATUSES = [
  'draft',
  'scoring',
  'signing',
  'pending_approval',
  'approved',
  'returned',
  'rejected',
  'cancelled',
] as const;
export type BidAnalysisStatus = (typeof BID_ANALYSIS_STATUSES)[number];

export const WAIVER_STATUSES = APPROVAL_STATES;
export type WaiverStatus = (typeof WAIVER_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  ...APPROVAL_STATES,
  'acknowledged',
  'partially_received',
  'fully_received',
  'closed',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const AMENDMENT_STATUSES = APPROVAL_STATES;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

/** GRN and completion certificate: completed by the two signatures, no DoA route. */
export const RECEIPT_STATUSES = ['draft', 'completed', 'cancelled'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const PAYMENT_REQUEST_STATUSES = [...APPROVAL_STATES, 'paid'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const CASH_ADVANCE_STATUSES = [
  ...APPROVAL_STATES,
  'paid',
  'partially_settled',
  'settled',
] as const;
export type CashAdvanceStatus = (typeof CASH_ADVANCE_STATUSES)[number];

export const SETTLEMENT_STATUSES = [...APPROVAL_STATES, 'posted'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const VOUCHER_STATUSES = [
  'draft',
  'pending_check',
  'checked',
  'approved',
  'posted',
  'returned',
  'cancelled',
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export const ACCOUNTING_PERIOD_STATUSES = ['open', 'closed'] as const;
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

export const BANK_STATEMENT_STATUSES = ['open', 'signed_off'] as const;
export type BankStatementStatus = (typeof BANK_STATEMENT_STATUSES)[number];

/** PR line sourcing state (pr_line.sourcing_status, migration 0012). */
export const PR_LINE_SOURCING_STATUSES = [
  'not_sourced',
  'in_sourcing',
  'ordered',
  'cancelled',
] as const;
export type PrLineSourcingStatus = (typeof PR_LINE_SOURCING_STATUSES)[number];

/** doc_signature.action (migration 0012). */
export const DOC_SIGNATURE_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'return',
  'cancel',
  'reassign',
  'change_budget_line',
  'committee_sign',
  'declare_coi',
  'attend',
  'received',
  'inspected',
  'certified',
  'confirmed',
  'acknowledge_warning',
  'override_match',
  'post',
  'reverse',
  'imported',
] as const;
export type DocSignatureAction = (typeof DOC_SIGNATURE_ACTIONS)[number];

/** doc_attachment.purpose (migration 0012, R31). */
export const DOC_ATTACHMENT_PURPOSES = [
  'general',
  'offer_scan',
  'po_acknowledgement',
  'received_by_copy',
  'receipt',
  'publication_evidence',
  'tor',
  'guarantee',
  'supplier_document',
  'vetting_evidence',
  'statement_import',
] as const;
export type DocAttachmentPurpose = (typeof DOC_ATTACHMENT_PURPOSES)[number];

/** Purposes added through their action endpoints, so allowed after the document left draft. */
export const ACTION_ATTACHMENT_PURPOSES: readonly DocAttachmentPurpose[] = [
  // the scanned quotation, uploaded after the opening (sealed until then, research D3)
  'offer_scan',
  'po_acknowledgement',
  'received_by_copy',
  'receipt',
];
