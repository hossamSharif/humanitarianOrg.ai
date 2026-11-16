// In-memory PR stores and a ready-made US4 world for unit tests of PrService and
// PrWorkflowService: an RTHA-like tenant (base SDG, DoA USD, Africa/Khartoum, 30 backdating
// days), an active USD grant operating in Madani with budget line 10202, a USD rate of 600 SDG,
// the default route (finance check → final approval) with one eligible user per step, and a
// complete draft of 10 × 87,071.00 SDG. Behaviour mirrors the SQL repositories: generated line
// totals, version bumps on header writes, NOT_FOUND for unknown ids.
import { randomUUID } from 'node:crypto';
import {
  Decimal,
  SEEDED_ROLES,
  type Permission,
  type PrActionView,
  type PrReservation,
  type PrStepStatus,
} from '@ngo/shared';
import type { TxSql } from '../../../src/db/tx';
import { AppError } from '../../../src/middleware/error';
import type {
  ApprovalActionStore,
  NewApprovalAction,
} from '../../../src/repositories/approval-action.repository';
import type { BudgetCommitmentStore } from '../../../src/repositories/budget-commitment.repository';
import type {
  NewNotification,
  NotificationStore,
} from '../../../src/repositories/notification.repository';
import type {
  PrApprovalStepStore,
  PrStepRecord,
} from '../../../src/repositories/pr-approval-step.repository';
import type {
  AttachmentRecord,
  AttachmentStorage,
  NewAttachment,
  PrAttachmentStore,
} from '../../../src/repositories/pr-attachment.repository';
import type {
  ActorSnapshot,
  LockedLineValues,
  PrGrantRef,
  PrHeaderValues,
  PrLineRecord,
  PrLineValues,
  PrRecord,
  PrStore,
  PrintSnapshot,
  SubmissionValues,
  TenantSettings,
} from '../../../src/repositories/pr.repository';
import {
  ApprovalRoutingService,
  type PrStepRow,
} from '../../../src/services/approval-routing.service';
import { BudgetService } from '../../../src/services/budget.service';
import { ExchangeRateService } from '../../../src/services/exchange-rate.service';
import { NotificationService } from '../../../src/services/notification.service';
import { NumberingService } from '../../../src/services/numbering.service';
import { PrWorkflowService } from '../../../src/services/pr-workflow.service';
import { PrService, type PrActor, type PrRepos } from '../../../src/services/pr.service';
import { KST_OFFICE_ID, MAD_OFFICE_ID, TENANT_ID, buildRule } from './builders';
import {
  FAKE_TX,
  FakeBudgetLedger,
  FakeGrantStore,
  FakeRateStore,
  buildGrant,
  buildLine,
} from './funding-fakes';
import { InMemoryNumberingStore } from './in-memory-tenant-store';
import { InMemoryRoutingStore, buildCandidate, buildRole, toRuleLike } from './routing-store';

const clone = <T>(v: T): T => structuredClone(v);

function lineTotal(quantity: string | null, unitCost: string | null): string | null {
  if (quantity === null || unitCost === null) return null;
  return new Decimal(quantity).times(unitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------

export class FakePrStore implements PrStore {
  readonly prs = new Map<string, PrRecord>();
  readonly lineRows = new Map<string, PrLineRecord[]>();
  readonly snapshots = new Map<string, PrintSnapshot>();
  settingsValue: TenantSettings = {
    baseCurrency: 'SDG',
    doaReferenceCurrency: 'USD',
    timeZone: 'Africa/Khartoum',
    maxBackdateDays: 30,
  };
  readonly grants = new Map<string, PrGrantRef>();
  readonly budgetLines = new Map<string, string>();
  readonly activities = new Map<string, string>();
  readonly actors = new Map<string, ActorSnapshot>();
  readonly units = new Map<string, number>([
    ['SDG', 2],
    ['USD', 2],
    ['EUR', 2],
  ]);
  /** number of write calls, to assert "no write" */
  writes = 0;
  /** last values passed to markSubmitted */
  submitted: SubmissionValues | null = null;

  seed(pr: PrRecord, lines: PrLineRecord[] = []): this {
    this.prs.set(pr.id, clone(pr));
    this.lineRows.set(pr.id, clone(lines));
    return this;
  }

  async lock(id: string) {
    return this.find(id);
  }

  async find(id: string) {
    const pr = this.prs.get(id);
    return pr ? clone(pr) : null;
  }

  async lines(prId: string) {
    return clone([...(this.lineRows.get(prId) ?? [])].sort((a, b) => a.lineNo - b.lineNo));
  }

  async insert(values: PrHeaderValues) {
    this.writes++;
    const pr = buildPrRecord({ ...values, id: randomUUID() });
    this.prs.set(pr.id, pr);
    this.lineRows.set(pr.id, []);
    return clone(pr);
  }

  private bump(id: string, changes: Partial<PrRecord> = {}): number {
    const pr = this.prs.get(id);
    if (!pr) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    this.writes++;
    Object.assign(pr, changes, { version: pr.version + 1 });
    return pr.version;
  }

  async updateHeader(id: string, values: Partial<PrHeaderValues>) {
    return this.bump(id, values);
  }

  async touch(id: string) {
    return this.bump(id);
  }

  async delete(id: string) {
    if (!this.prs.delete(id)) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    this.writes++;
    this.lineRows.delete(id);
  }

  async insertLines(prId: string, lines: (PrLineValues & { lineNo: number })[]) {
    const rows = this.lineRows.get(prId) ?? [];
    const ids: string[] = [];
    for (const l of lines) {
      this.writes++;
      const row = buildPrLineRecord({ ...l, id: randomUUID() });
      rows.push(row);
      ids.push(row.id);
    }
    this.lineRows.set(prId, rows);
    return ids;
  }

  private findLine(id: string): PrLineRecord {
    for (const rows of this.lineRows.values()) {
      const line = rows.find((l) => l.id === id);
      if (line) return line;
    }
    throw new AppError('NOT_FOUND', 'pr_line not found');
  }

  async updateLine(id: string, values: Partial<PrLineValues> & { lineNo?: number }) {
    this.writes++;
    const line = this.findLine(id);
    Object.assign(line, values);
    line.lineTotal = lineTotal(line.quantity, line.unitCost);
  }

  async deleteLines(ids: readonly string[]) {
    if (ids.length === 0) return;
    this.writes++;
    for (const [prId, rows] of this.lineRows) {
      this.lineRows.set(
        prId,
        rows.filter((l) => !ids.includes(l.id))
      );
    }
  }

  async clearGrantLinks(prId: string) {
    this.writes++;
    for (const l of this.lineRows.get(prId) ?? []) {
      l.budgetLineId = null;
      l.activityId = null;
    }
  }

  async settings() {
    return clone(this.settingsValue);
  }

  async grant(id: string) {
    const g = this.grants.get(id);
    return g ? clone(g) : null;
  }

  async budgetLineGrants(ids: readonly string[]) {
    return new Map(
      ids.flatMap((id) => (this.budgetLines.has(id) ? [[id, this.budgetLines.get(id)!]] : [])) as [
        string,
        string,
      ][]
    );
  }

  async activityGrants(ids: readonly string[]) {
    return new Map(
      ids.flatMap((id) => (this.activities.has(id) ? [[id, this.activities.get(id)!]] : [])) as [
        string,
        string,
      ][]
    );
  }

  async minorUnits(codes: readonly string[]) {
    return new Map(
      codes.flatMap((c) => (this.units.has(c) ? [[c, this.units.get(c)!]] : [])) as [
        string,
        number,
      ][]
    );
  }

  async actor(userId: string) {
    const a = this.actors.get(userId);
    if (!a) throw new AppError('FORBIDDEN', 'No membership in this organization');
    return clone(a);
  }

  async printSnapshot(prId: string): Promise<PrintSnapshot> {
    return (
      this.snapshots.get(prId) ?? {
        organization: {
          nameAr: 'منظمة',
          nameEn: 'RTHA',
          logoPath: null,
          address: null,
          phone: null,
          email: null,
        },
        requestingOffice: { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' },
        deliverTo: { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' },
        grant: { code: 'ADRA-2026-01', name: 'WASH' },
        donor: { name: 'ADRA', shortName: 'ADRA' },
        activity: null,
        requester: null,
        lines: {},
      }
    );
  }

  async lockLine(id: string, values: LockedLineValues) {
    this.writes++;
    Object.assign(this.findLine(id), values);
  }

  async markSubmitted(id: string, values: SubmissionValues) {
    this.submitted = clone(values);
    const {
      printSnapshot: _snapshot,
      doaExchangeRateId: _d,
      grantExchangeRateId: _g,
      ...rest
    } = values;
    return this.bump(id, { ...rest, status: 'pending_finance_check' });
  }
}

export class FakeAttachmentStore implements PrAttachmentStore {
  readonly rows: AttachmentRecord[] = [];

  async list(prId: string) {
    return clone(this.rows.filter((a) => a.prId === prId && a.deletedAt === null));
  }

  async find(prId: string, id: string) {
    const a = this.rows.find((r) => r.prId === prId && r.id === id);
    return a ? clone(a) : null;
  }

  async insert(v: NewAttachment) {
    const row: AttachmentRecord = {
      ...v,
      uploadedBy: 'test-user',
      uploadedAt: null,
      deletedAt: null,
    };
    this.rows.push(row);
    return clone(row);
  }

  async markUploaded(id: string) {
    const a = this.rows.find((r) => r.id === id)!;
    a.uploadedAt ??= '2026-11-15T09:00:00.000Z';
  }

  async softDelete(id: string) {
    this.rows.find((r) => r.id === id)!.deletedAt = '2026-11-15T09:00:00.000Z';
  }
}

export class FakeAttachmentStorage implements AttachmentStorage {
  async uploadUrl(path: string) {
    return { signedUrl: `https://storage.test/upload/${path}`, token: 'upload-token' };
  }

  async downloadUrl(path: string) {
    return `https://storage.test/download/${path}`;
  }
}

/** Steps written by materialiseSteps, read back like pr_approval_step. */
export class FakeStepStore implements PrApprovalStepStore {
  readonly rows: (PrStepRecord & { prId: string; ruleStepId: string })[] = [];

  write = async (_tx: TxSql, rows: readonly PrStepRow[]) => {
    for (const r of rows) {
      if (
        this.rows.some(
          (s) => s.prId === r.prId && s.cycle === r.cycle && s.stepOrder === r.stepOrder
        )
      ) {
        throw new AppError('VALIDATION_ERROR', 'duplicate step');
      }
      this.rows.push({
        id: randomUUID(),
        prId: r.prId,
        cycle: r.cycle,
        stepOrder: r.stepOrder,
        kind: r.kind,
        requiredRoleId: r.requiredRoleId,
        ruleStepId: r.ruleStepId,
        roleNameAr: '',
        roleNameEn: '',
        assignedUserId: null,
        status: r.status as PrStepStatus,
        actedAt: null,
      });
    }
  };

  async list(prId: string, cycle: number) {
    return clone(
      this.rows
        .filter((s) => s.prId === prId && s.cycle === cycle)
        .sort((a, b) => a.stepOrder - b.stepOrder)
    );
  }
}

export class FakeActionStore implements ApprovalActionStore {
  readonly rows: (NewApprovalAction & { id: string; userId: string; actedAt: string })[] = [];

  constructor(private readonly currentUser: () => string) {}

  async insert(row: NewApprovalAction) {
    this.rows.push({
      ...clone(row),
      id: randomUUID(),
      userId: this.currentUser(),
      actedAt: '2026-11-15T09:00:00.000Z',
    });
  }

  async list(prId: string): Promise<PrActionView[]> {
    return this.rows
      .filter((r) => r.prId === prId)
      .map((r) => ({
        id: r.id,
        cycle: r.cycle,
        stepOrder: r.stepOrder,
        action: r.action,
        userId: r.userId,
        userName: r.userName,
        userPosition: r.userPosition,
        comment: r.comment,
        actedAt: r.actedAt,
      }));
  }
}

export class FakeNotificationStore implements NotificationStore {
  readonly rows: NewNotification[] = [];

  async insertMany(rows: readonly NewNotification[]) {
    this.rows.push(...clone(rows));
  }
}

class LedgerCommitmentReads implements BudgetCommitmentStore {
  constructor(
    private readonly ledger: FakeBudgetLedger,
    private readonly grants: Map<string, PrGrantRef>
  ) {}

  async listForPr(prId: string): Promise<PrReservation[]> {
    return this.ledger.commitments
      .filter((c) => c.prId === prId)
      .map((c) => {
        const line = this.ledger.lines.get(c.budgetLineId);
        return {
          budgetLineId: c.budgetLineId,
          cycle: c.cycle,
          amount: c.amount,
          currency: (line && this.grants.get(line.grantId)?.currency) ?? 'USD',
          status: c.status,
        };
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

export function buildPrRecord(overrides: Partial<PrRecord> = {}): PrRecord {
  return {
    id: randomUUID(),
    number: null,
    status: 'draft',
    version: 1,
    prDate: null,
    requestingOfficeId: null,
    grantId: null,
    deliverToOfficeId: null,
    deliveryAddress: null,
    contactName: null,
    contactPhone: null,
    requiredByDate: null,
    activityId: null,
    purpose: null,
    prType: null,
    requesterId: randomUUID(),
    requesterName: null,
    requesterPosition: null,
    submissionCycle: 0,
    currentStepOrder: null,
    doaCurrency: null,
    doaAmount: null,
    doaRateToBase: null,
    doaRateDate: null,
    doaRateSource: null,
    grantRateToBase: null,
    grantRateDate: null,
    grantRateSource: null,
    totalGrantCurrency: null,
    submittedAt: null,
    approvedAt: null,
    returnReason: null,
    rejectReason: null,
    cancelReason: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...overrides,
  };
}

export function buildPrLineRecord(overrides: Partial<PrLineRecord> = {}): PrLineRecord {
  const row: PrLineRecord = {
    id: randomUUID(),
    lineNo: 1,
    description: 'Jerrycan 20 L',
    specifications: null,
    quantity: '10',
    unitId: randomUUID(),
    unitCost: '87071.00',
    lineTotal: null,
    currency: 'SDG',
    budgetLineId: null,
    locationOfficeId: MAD_OFFICE_ID,
    activityId: null,
    rateToBase: null,
    rateDate: null,
    rateSource: null,
    exchangeRateId: null,
    amountGrant: null,
    ...overrides,
  };
  row.lineTotal = lineTotal(row.quantity, row.unitCost);
  return row;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

export interface PrWorld {
  db: FakePrStore;
  attachments: FakeAttachmentStore;
  steps: FakeStepStore;
  actions: FakeActionStore;
  notifications: FakeNotificationStore;
  ledger: FakeBudgetLedger;
  rates: FakeRateStore;
  routing: InMemoryRoutingStore;
  numbering: InMemoryNumberingStore;
  grantId: string;
  budgetLineId: string;
  unitId: string;
  requesterId: string;
  financeUserId: string;
  approverUserId: string;
  roles: { finance: string; approver: string };
  /** the caller; defaults to the requester */
  actor: PrActor;
  now: Date;
  prService(actor?: Partial<PrActor>): PrService;
  workflow(actor?: Partial<PrActor>): PrWorkflowService;
  /** a complete draft (one line of 870,710.00 SDG) owned by the requester */
  seedDraft(pr?: Partial<PrRecord>, lines?: Partial<PrLineRecord>[]): PrRecord;
}

export function buildPrWorld(): PrWorld {
  const db = new FakePrStore();
  const attachments = new FakeAttachmentStore();
  const steps = new FakeStepStore();
  const notifications = new FakeNotificationStore();
  const ledger = new FakeBudgetLedger();
  const rates = new FakeRateStore();
  const routing = new InMemoryRoutingStore();
  const numbering = new InMemoryNumberingStore();
  numbering.offices.push({ id: MAD_OFFICE_ID, code: 'MAD', isActive: true });
  numbering.offices.push({ id: KST_OFFICE_ID, code: 'KST', isActive: true });

  const grant = buildGrant({ currency: 'USD', officeIds: [MAD_OFFICE_ID] });
  db.grants.set(grant.id, {
    id: grant.id,
    currency: grant.currency,
    status: grant.status,
    startDate: grant.startDate,
    endDate: grant.endDate,
    officeIds: grant.officeIds,
  });
  const budgetLine = buildLine({ grantId: grant.id, code: '10202', budgetAmount: '10000.00' });
  ledger.seedLines(budgetLine);
  ledger.currencies.set(grant.id, 'USD');
  db.budgetLines.set(budgetLine.id, grant.id);
  rates.add({ currency: 'USD', rateToBase: '600', rateDate: '2026-11-01' });

  const finance = buildRole('finance_checker');
  const approver = buildRole('approver');
  const requesterRole = buildRole('requester');
  routing.roles.push(finance, approver, requesterRole);
  const rule = buildRule();
  rule.steps[0]!.roleId = finance.id;
  rule.steps[1]!.roleId = approver.id;
  routing.rules.push(toRuleLike(rule));
  const financeUser = buildCandidate({ roleIds: [finance.id] });
  const approverUser = buildCandidate({ roleIds: [approver.id] });
  routing.members.push(financeUser, approverUser);

  const requesterId = randomUUID();
  db.actors.set(requesterId, {
    nameAr: 'مقدم الطلب',
    nameEn: 'Amna Requester',
    position: 'WASH Officer',
  });

  const unitId = randomUUID();
  const actor: PrActor = {
    userId: requesterId,
    tenantId: TENANT_ID,
    permissions: new Set<Permission>(SEEDED_ROLES.requester.permissions),
    officeIds: [MAD_OFFICE_ID],
    orgWideAccess: false,
  };

  const world: PrWorld = {
    db,
    attachments,
    steps,
    actions: new FakeActionStore(() => world.actor.userId),
    notifications,
    ledger,
    rates,
    routing,
    numbering,
    grantId: grant.id,
    budgetLineId: budgetLine.id,
    unitId,
    requesterId,
    financeUserId: financeUser.userId,
    approverUserId: approverUser.userId,
    roles: { finance: finance.id, approver: approver.id },
    actor,
    now: new Date('2026-11-15T09:00:00Z'),

    prService(overrides = {}) {
      world.actor = { ...actor, ...overrides };
      return new PrService({
        actor: world.actor,
        run: (fn) => fn(repos(), FAKE_TX),
        storage: new FakeAttachmentStorage(),
      });
    },

    workflow(overrides = {}) {
      world.actor = { ...actor, ...overrides };
      const routingService = new ApprovalRoutingService(routing, steps.write);
      return new PrWorkflowService({
        actor: world.actor,
        run: (fn) =>
          fn(
            {
              ...repos(routingService),
              notifications: new NotificationService(notifications, routingService),
            },
            FAKE_TX
          ),
        budget: new BudgetService({
          grants: new FakeGrantStore(),
          lines: ledger,
          txStore: ledger,
          runTx: (fn) => fn(FAKE_TX),
        }),
        rates: new ExchangeRateService({ rates }),
        numbering: new NumberingService(numbering, () => numbering),
        now: () => world.now,
      });
    },

    seedDraft(pr = {}, lines) {
      const record = buildPrRecord({
        requesterId,
        prDate: '2026-11-10',
        requestingOfficeId: MAD_OFFICE_ID,
        grantId: grant.id,
        deliverToOfficeId: MAD_OFFICE_ID,
        requiredByDate: '2026-11-30',
        prType: 'goods',
        ...pr,
      });
      const lineRows = (lines ?? [{}]).map((l, i) =>
        buildPrLineRecord({ lineNo: i + 1, unitId, budgetLineId: budgetLine.id, ...l })
      );
      db.seed(record, lineRows);
      return record;
    },
  };

  function repos(routingService = new ApprovalRoutingService(routing, steps.write)): PrRepos {
    return {
      prs: db,
      attachments,
      steps,
      actions: world.actions,
      commitments: new LedgerCommitmentReads(ledger, db.grants),
      routing: routingService,
    };
  }

  return world;
}
