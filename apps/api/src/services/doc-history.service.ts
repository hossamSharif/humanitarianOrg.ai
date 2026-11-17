// Timeline of any 002 document (R30, contracts/rest-api.md `GET /X/:id/history`), in the 001
// shape: doc_signature rows (submit, approve, reject, return, cancel, reassign, receipt and
// committee signatures, posting, reversal…) with the signer's snapshot and comment, merged in
// time order with the document's audit_history (header and child tables, by doc_type/doc_id).
// Record changes written in the same transaction as a signature (same instant: now() is fixed
// per transaction) belong to that signature; the header's status change of that transaction
// gives it its from → to states. Consecutive edits by one user of one table within
// HISTORY_EDIT_MERGE_MINUTES form one entry. PRs keep their own pr-history.service.
import {
  HISTORY_EDIT_MERGE_MINUTES,
  type DocHistoryEntry,
  type DocTypeCode,
  type PrHistoryChange,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  DocHistoryRepository,
  type DocActorLabel,
  type DocAuditRow,
  type DocHistoryStore,
  type DocSignatureRow,
} from '../repositories/doc-history.repository';
import type { RequestContext } from '../types/context';

/** Bookkeeping columns never shown as changes. */
const HIDDEN_COLUMNS = new Set([
  'id',
  'tenant_id',
  'created_at',
  'updated_at',
  'created_by',
  'version',
  'print_snapshot',
]);

/** Tables whose changes the signatures already describe. */
const SIGNATURE_TABLES = new Set(['doc_approval_step', 'doc_signature']);

const camel = (column: string) => column.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const UNKNOWN_ACTOR: DocActorLabel = { nameAr: '', nameEn: '', position: null };

function changesOf(row: DocAuditRow): PrHistoryChange[] {
  if (row.action !== 'update') return [];
  const oldData = row.oldData ?? {};
  const newData = row.newData ?? {};
  return row.changedFields
    .filter((c) => !HIDDEN_COLUMNS.has(c))
    .map((c) => ({ field: camel(c), from: oldData[c] ?? null, to: newData[c] ?? null }));
}

/** Pure merge of the two sources (exported for tests). */
export function buildDocTimeline(
  headerTable: string,
  audit: readonly DocAuditRow[],
  signatures: readonly DocSignatureRow[],
  actors: ReadonlyMap<string, DocActorLabel>
): DocHistoryEntry[] {
  const signedAt = new Set(signatures.map((s) => s.actedAt));
  const stateAt = new Map<string, { from: string | null; to: string | null }>();
  for (const row of audit) {
    if (row.tableName === headerTable && row.action === 'update' && row.toState !== row.fromState) {
      stateAt.set(row.occurredAt, { from: row.fromState, to: row.toState });
    }
  }

  const entries: (DocHistoryEntry & { startedAt: number })[] = [];

  for (const s of signatures) {
    const state = stateAt.get(s.actedAt);
    const nameAr = typeof s.payload?.nameAr === 'string' ? s.payload.nameAr : s.userName;
    entries.push({
      at: s.actedAt,
      actor: { userId: s.userId, nameAr, nameEn: s.userName, position: s.userPosition },
      action: s.action,
      fromState: state?.from ?? null,
      toState: state?.to ?? null,
      comment: s.comment,
      cycle: s.cycle,
      stepKind: s.stepKind ?? (typeof s.payload?.kind === 'string' ? s.payload.kind : null),
      tableName: null,
      changes: [],
      startedAt: Date.parse(s.actedAt),
    });
  }

  const mergeMs = HISTORY_EDIT_MERGE_MINUTES * 60_000;
  let last: (DocHistoryEntry & { startedAt: number }) | null = null;
  for (const row of audit) {
    if (SIGNATURE_TABLES.has(row.tableName) || signedAt.has(row.occurredAt)) continue;
    const actor = row.actorId ? (actors.get(row.actorId) ?? UNKNOWN_ACTOR) : UNKNOWN_ACTOR;
    const action = row.action === 'insert' ? 'create' : row.action;
    const at = Date.parse(row.occurredAt);
    if (
      action === 'update' &&
      last &&
      last.action === 'update' &&
      last.tableName === row.tableName &&
      last.actor.userId === row.actorId &&
      at - last.startedAt <= mergeMs
    ) {
      for (const change of changesOf(row)) {
        const existing = last.changes.find((c) => c.field === change.field);
        if (existing) existing.to = change.to;
        else last.changes.push(change);
      }
      last.at = row.occurredAt;
      continue;
    }
    const entry = {
      at: row.occurredAt,
      actor: { userId: row.actorId, ...actor },
      action,
      fromState: row.fromState,
      toState: row.toState,
      comment: null,
      cycle: null,
      stepKind: null,
      tableName: row.tableName,
      changes: changesOf(row),
      startedAt: at,
    };
    entries.push(entry);
    last = entry;
  }

  return entries
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.startedAt - b.startedAt)
    .map(({ startedAt: _startedAt, ...e }) => e);
}

export class DocHistoryService {
  constructor(
    private readonly run: <T>(fn: (store: DocHistoryStore) => Promise<T>) => Promise<T>,
    private readonly headerTables: Partial<Record<DocTypeCode, string>> = {}
  ) {}

  static forContext(ctx: RequestContext): DocHistoryService {
    return new DocHistoryService((fn) =>
      withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
        fn(new DocHistoryRepository(tx.sql, ctx.tenantId))
      )
    );
  }

  /** GET /X/:id/history — 404 when the document is missing or outside the caller's offices. */
  history(docType: DocTypeCode, docId: string, headerTable: string): Promise<DocHistoryEntry[]> {
    return this.run(async (store) => {
      if (!(await store.exists(docType, docId))) {
        throw new AppError('NOT_FOUND', 'document not found');
      }
      const [audit, signatures] = await Promise.all([
        store.auditRows(docType, docId),
        store.signatures(docType, docId),
      ]);
      const actorIds = audit.map((r) => r.actorId).filter((id): id is string => id !== null);
      const actors = await store.actors(actorIds);
      return buildDocTimeline(this.headerTables[docType] ?? headerTable, audit, signatures, actors);
    });
  }
}
