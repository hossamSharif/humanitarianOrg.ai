// PR history timeline (FR-044, SC-002). Two sources are merged in time order:
// - approval_action: submit / approve / reject / return / cancel / reassign / change budget
//   line, with the actor's name and position snapshot and the comment;
// - audit_history of the PR, its lines and attachments: creation and draft edits, with the
//   changed fields. Rows written in the same transaction as an approval_action (same instant:
//   now() is fixed per transaction) belong to that action and are not shown again; the PR row's
//   status change of that transaction gives the action its from → to states.
// Consecutive draft edits by one user within HISTORY_EDIT_MERGE_MINUTES form one entry whose
// changes run from the first value to the last; the audit trail itself keeps every save.
import {
  HISTORY_EDIT_MERGE_MINUTES,
  type PrHistoryAction,
  type PrHistoryChange,
  type PrHistoryEntry,
  type PrStatus,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  PrHistoryRepository,
  type ActionRow,
  type ActorLabel,
  type AuditRow,
  type PrHistoryStore,
} from '../repositories/pr-history.repository';
import type { RequestContext } from '../types/context';

/** Bookkeeping and derived columns never shown as changes. */
const HIDDEN_COLUMNS = new Set([
  'id',
  'tenant_id',
  'pr_id',
  'created_at',
  'updated_at',
  'created_by',
  'version',
  'print_snapshot',
  'line_total',
  'line_no',
]);

/** Columns holding ids shown by their code (office, grant, budget line, unit, activity). */
const ID_COLUMNS = new Set([
  'requesting_office_id',
  'deliver_to_office_id',
  'grant_id',
  'activity_id',
  'budget_line_id',
  'unit_id',
  'location_office_id',
]);

const camel = (column: string) => column.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

const UNKNOWN_ACTOR: ActorLabel = { nameAr: '', nameEn: '', position: null };

interface Draft extends PrHistoryEntry {
  /** for merging: when the first edit of the burst happened */
  startedAt: number;
}

function changeKey(c: PrHistoryChange): string {
  return `${c.field}#${c.lineNo ?? ''}`;
}

/** Changes of one save (one transaction's audit rows) in a readable form. */
function saveChanges(rows: readonly AuditRow[], codes: ReadonlyMap<string, string>) {
  const label = (column: string, value: string | null) =>
    value !== null && ID_COLUMNS.has(column) ? (codes.get(value) ?? value) : value;
  const changes: PrHistoryChange[] = [];

  for (const row of rows) {
    const oldData = row.oldData ?? {};
    const newData = row.newData ?? {};
    if (row.tableName === 'purchase_requisition' && row.action === 'update') {
      for (const column of row.changedFields) {
        if (HIDDEN_COLUMNS.has(column)) continue;
        changes.push({
          field: camel(column),
          from: label(column, oldData[column] ?? null),
          to: label(column, newData[column] ?? null),
        });
      }
    } else if (row.tableName === 'pr_line') {
      const lineNo = Number((row.action === 'delete' ? oldData : newData).line_no);
      if (row.action === 'insert') {
        changes.push({ field: 'line', lineNo, from: null, to: newData.description ?? '' });
      } else if (row.action === 'delete') {
        changes.push({ field: 'line', lineNo, from: oldData.description ?? '', to: null });
      } else {
        for (const column of row.changedFields) {
          if (HIDDEN_COLUMNS.has(column)) continue;
          changes.push({
            field: `line.${camel(column)}`,
            lineNo,
            from: label(column, oldData[column] ?? null),
            to: label(column, newData[column] ?? null),
          });
        }
      }
    } else if (row.tableName === 'pr_attachment' && row.action === 'update') {
      const name = newData.file_name ?? oldData.file_name ?? '';
      if (oldData.uploaded_at === null && newData.uploaded_at !== null) {
        changes.push({ field: 'attachment', from: null, to: name });
      } else if (oldData.deleted_at === null && newData.deleted_at !== null) {
        changes.push({ field: 'attachment', from: name, to: null });
      }
    }
  }
  return changes;
}

/** Combines a burst of edits: each field from its first `from` to its last `to`. */
function mergeChanges(a: readonly PrHistoryChange[], b: readonly PrHistoryChange[]) {
  const byKey = new Map<string, PrHistoryChange>();
  for (const c of [...a, ...b]) {
    const current = byKey.get(changeKey(c));
    byKey.set(changeKey(c), current ? { ...current, to: c.to } : { ...c });
  }
  return [...byKey.values()].filter((c) => c.from !== c.to);
}

function actionName(row: ActionRow): PrHistoryAction {
  if (row.action === 'submit') return row.payload?.resubmission === true ? 'resubmit' : 'submit';
  return row.action as PrHistoryAction;
}

export class PrHistoryService {
  constructor(private readonly run: <T>(fn: (store: PrHistoryStore) => Promise<T>) => Promise<T>) {}

  static forContext(ctx: RequestContext): PrHistoryService {
    return new PrHistoryService((fn) =>
      withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
        fn(new PrHistoryRepository(tx.sql, ctx.tenantId))
      )
    );
  }

  /** GET /prs/:id/history — oldest first. */
  history(prId: string): Promise<PrHistoryEntry[]> {
    return this.run(async (store) => {
      if (!(await store.prExists(prId))) {
        throw new AppError('NOT_FOUND', 'purchase_requisition not found');
      }
      const [audit, actions, lineNumbers] = await Promise.all([
        store.auditRows(prId),
        store.actions(prId),
        store.lineNumbers(prId),
      ]);

      const idValues = new Set<string>();
      for (const row of audit) {
        for (const data of [row.oldData, row.newData]) {
          for (const column of ID_COLUMNS) {
            const v = data?.[column];
            if (v) idValues.add(v);
          }
        }
      }
      for (const a of actions) {
        for (const key of ['fromBudgetLineId', 'toBudgetLineId']) {
          const v = a.payload?.[key];
          if (typeof v === 'string') idValues.add(v);
        }
      }
      const actorIds = audit.flatMap((r) => (r.actorId ? [r.actorId] : []));
      const [codes, actors] = await Promise.all([
        store.codes([...idValues]),
        store.actors(actorIds),
      ]);

      // audit rows by transaction instant
      const byInstant = new Map<string, AuditRow[]>();
      for (const row of audit) {
        const list = byInstant.get(row.occurredAt) ?? [];
        list.push(row);
        byInstant.set(row.occurredAt, list);
      }
      const statusChange = (instant: string) => {
        const prRows = (byInstant.get(instant) ?? []).filter(
          (r) => r.tableName === 'purchase_requisition'
        );
        if (prRows.length === 0) return null;
        return { from: prRows[0]!.fromState, to: prRows[prRows.length - 1]!.toState };
      };

      const entries: Draft[] = [];
      const actionInstants = new Set(actions.map((a) => a.actedAt));

      for (const a of actions) {
        const states = statusChange(a.actedAt);
        const changes: PrHistoryChange[] = [];
        if (a.action === 'change_budget_line' && a.payload) {
          const code = (key: string) => {
            const id = a.payload?.[key];
            return typeof id === 'string' ? (codes.get(id) ?? id) : null;
          };
          const lineNo = lineNumbers.get(String(a.payload.lineId));
          changes.push({
            field: 'line.budgetLineId',
            ...(lineNo !== undefined ? { lineNo } : {}),
            from: code('fromBudgetLineId'),
            to: code('toBudgetLineId'),
          });
        }
        const nameAr = typeof a.payload?.nameAr === 'string' ? a.payload.nameAr : a.userName;
        entries.push({
          at: a.actedAt,
          startedAt: Date.parse(a.actedAt),
          actor: { userId: a.userId, nameAr, nameEn: a.userName, position: a.userPosition },
          action: actionName(a),
          fromState: states?.from ?? null,
          toState: states?.to ?? null,
          comment: a.comment,
          cycle: a.cycle,
          stepKind: a.stepKind,
          changes,
        });
      }

      for (const [instant, rows] of byInstant) {
        if (actionInstants.has(instant)) continue;
        const actorId = rows.find((r) => r.actorId)?.actorId ?? null;
        const actor = { userId: actorId, ...(actors.get(actorId ?? '') ?? UNKNOWN_ACTOR) };
        const created = rows.some(
          (r) => r.tableName === 'purchase_requisition' && r.action === 'insert'
        );
        if (created) {
          entries.push({
            at: instant,
            startedAt: Date.parse(instant),
            actor,
            action: 'create',
            fromState: null,
            toState: 'draft',
            comment: null,
            cycle: null,
            stepKind: null,
            changes: [],
          });
          continue;
        }
        const changes = saveChanges(rows, codes);
        if (changes.length === 0) continue;
        const states = statusChange(instant);
        entries.push({
          at: instant,
          startedAt: Date.parse(instant),
          actor,
          action: 'update',
          fromState: states?.from ?? null,
          toState: states?.to ?? null,
          comment: null,
          cycle: null,
          stepKind: null,
          changes,
        });
      }

      entries.sort((x, y) => x.startedAt - y.startedAt);
      return this.withStatesAndBursts(entries);
    });
  }

  /**
   * Fills missing states from the running status (actions that did not change the PR row, e.g.
   * reassign) and merges bursts of draft edits.
   */
  private withStatesAndBursts(entries: readonly Draft[]): PrHistoryEntry[] {
    const windowMs = HISTORY_EDIT_MERGE_MINUTES * 60_000;
    const out: Draft[] = [];
    let status: PrStatus | null = null;
    for (const entry of entries) {
      const e = { ...entry };
      if (e.toState === null && e.action !== 'create') {
        e.fromState = status;
        e.toState = status;
      }
      status = e.toState ?? status;

      const last = out[out.length - 1];
      if (
        last &&
        last.action === 'update' &&
        e.action === 'update' &&
        last.actor.userId === e.actor.userId &&
        e.startedAt - last.startedAt <= windowMs
      ) {
        last.at = e.at;
        last.toState = e.toState;
        last.changes = mergeChanges(last.changes, e.changes);
        continue;
      }
      out.push(e);
    }
    return out
      .filter((e) => e.action !== 'update' || e.changes.length > 0)
      .map(({ startedAt: _startedAt, ...entry }) => entry);
  }
}
