// In-memory document type for the generic workflow engine (T007): a fake adapter over a Map of
// documents, fake step / signature stores and a recording notifier, routed by the real
// ApprovalRoutingService over InMemoryRoutingStore. The route is Finance Manager `approval`
// then Country Director `final_approval`, as the 002 default DoA rules (research D8).
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, SEEDED_ROLES_002, type DocTypeCode, type Permission } from '@ngo/shared';
import type { TenantTx } from '../../../src/db/tx';
import { ApprovalRoutingService } from '../../../src/services/approval-routing.service';
import type {
  DocAdapter,
  DocRef,
  Outcome,
  StatusChange,
  WorkflowBinding,
  WorkflowDoc,
  WorkflowSignature,
  WorkflowStep,
} from '../../../src/services/doc-adapters/types';
import { DocumentWorkflowService } from '../../../src/services/document-workflow.service';
import type { PriorSignature } from '../../../src/services/segregation.service';
import { MAD_OFFICE_ID } from './builders';
import { InMemoryRoutingStore, buildCandidate } from './routing-store';

export interface FakeDoc extends WorkflowDoc {
  creatorId: string;
  officeId: string;
  amount: string;
  grantStatus: 'active' | 'suspended' | 'closed';
  approvedAt: string | null;
  reason: string | null;
}

const FAKE_TX = {
  sql: null as never,
  setAuditComment: async () => {},
} satisfies TenantTx;

export class FakeDocWorld {
  readonly docs = new Map<string, FakeDoc>();
  readonly steps: (WorkflowStep & { docId: string })[] = [];
  readonly signatures: (WorkflowSignature & { userId: string })[] = [];
  readonly notified: { kind: string; docId: string; userIds?: string[]; outcome?: Outcome }[] = [];
  readonly effects: string[] = [];
  readonly routing = new InMemoryRoutingStore();
  readonly numbers = new Map<string, number>();
  readonly fm = buildCandidate();
  readonly cd = buildCandidate();
  readonly creatorId = randomUUID();
  readonly admin = randomUUID();
  readonly fmRole = randomUUID();
  readonly cdRole = randomUUID();
  docType: DocTypeCode = 'PO';
  frozenGrantOverride = false;
  now = new Date('2026-11-16T08:00:00Z');

  constructor() {
    const role = (id: string, key: 'finance_manager' | 'country_director') => ({
      id,
      nameAr: SEEDED_ROLES_002[key].nameAr,
      nameEn: SEEDED_ROLES_002[key].nameEn,
      permissions: [...SEEDED_ROLES_002[key].permissions],
    });
    this.routing.roles.push(
      role(this.fmRole, 'finance_manager'),
      role(this.cdRole, 'country_director')
    );
    this.fm.roleIds = [this.fmRole];
    this.cd.roleIds = [this.cdRole];
    this.routing.members.push(this.fm, this.cd);
    this.routing.rules.push({
      id: randomUUID(),
      name: 'Default PO approval',
      officeId: null,
      isActive: true,
      steps: [
        {
          id: randomUUID(),
          stepOrder: 1,
          kind: 'approval',
          roleId: this.fmRole,
          minAmount: null,
          maxAmount: null,
        },
        {
          id: randomUUID(),
          stepOrder: 2,
          kind: 'final_approval',
          roleId: this.cdRole,
          minAmount: null,
          maxAmount: null,
        },
      ],
    });
  }

  seed(overrides: Partial<FakeDoc> = {}): FakeDoc {
    const doc: FakeDoc = {
      id: randomUUID(),
      status: 'draft',
      version: 1,
      number: null,
      submissionCycle: 0,
      currentStepOrder: null,
      creatorId: this.creatorId,
      officeId: MAD_OFFICE_ID,
      amount: '1000.00',
      grantStatus: 'active',
      approvedAt: null,
      reason: null,
      ...overrides,
    };
    this.docs.set(doc.id, structuredClone(doc));
    return doc;
  }

  doc(id: string): FakeDoc {
    return structuredClone(this.docs.get(id)!);
  }

  /** The workflow as `userId` with `permissions`. */
  as(userId: string, permissions: Permission[] = []): DocumentWorkflowService<FakeDoc, null> {
    return new DocumentWorkflowService<FakeDoc, null>({
      actor: { userId, permissions: new Set(permissions) },
      now: () => this.now,
      run: async (fn) => fn(this.binding(), FAKE_TX),
    });
  }

  currentStep(id: string): WorkflowStep & { docId: string } {
    const doc = this.docs.get(id)!;
    return this.steps.find(
      (s) => s.docId === id && s.cycle === doc.submissionCycle && s.status === 'pending'
    )!;
  }

  private ref(doc: FakeDoc): DocRef {
    return {
      id: doc.id,
      requesterId: doc.creatorId,
      requestingOfficeId: doc.officeId,
      number: doc.number,
      doc: { docType: this.docType, doaType: this.docType === 'PAY' ? 'PAY' : 'PO' },
    };
  }

  private write(doc: FakeDoc, values: Partial<FakeDoc>): number {
    const stored = this.docs.get(doc.id)!;
    Object.assign(stored, values, { version: stored.version + 1 });
    return stored.version;
  }

  private binding(world: FakeDocWorld = this): WorkflowBinding<FakeDoc, null> {
    const adapter: DocAdapter<FakeDoc, null> = {
      docType: world.docType,
      doaType: world.docType === 'PAY' ? 'PAY' : 'PO',
      reassignPermissions: [PERMISSIONS.SETTINGS_MANAGE],
      get frozenGrantOverride() {
        return world.frozenGrantOverride;
      },
      load: async (id) => (world.docs.has(id) ? world.doc(id) : null),
      creatorId: (doc) => doc.creatorId,
      officeId: (doc) => doc.officeId,
      assertMaySubmit() {},
      isPending: (status) => status === 'pending_approval',
      pendingStatus: () => 'pending_approval',
      cancellable: (status) => ['pending_approval', 'returned', 'approved'].includes(status),
      mayCancel: () => true,
      prepareSubmit: async (doc) => ({
        officeId: doc.officeId,
        doaAmount: doc.amount,
        timeZone: 'Africa/Khartoum',
        submittedAt: world.now,
        state: null,
      }),
      onSubmit: async (doc, _plan, cycle) => {
        world.effects.push(`reserve:${doc.id}:${cycle}`);
      },
      markSubmitted: async (doc, _plan, info) =>
        world.write(doc, {
          status: info.firstStepStatus,
          number: info.number,
          submissionCycle: info.cycle,
          currentStepOrder: info.firstStepOrder,
        }),
      grantFrozen: async (doc) => doc.grantStatus !== 'active',
      onApproved: async (doc) => {
        world.effects.push(`commit:${doc.id}`);
      },
      onReleased: async (doc, reason) => {
        world.effects.push(`release:${doc.id}:${reason}`);
      },
      setStatus: async (doc, change: StatusChange) => {
        switch (change.kind) {
          case 'advanced':
            return world.write(doc, {
              status: change.status,
              currentStepOrder: change.currentStepOrder,
            });
          case 'approved':
            return world.write(doc, {
              status: 'approved',
              approvedAt: change.at,
              currentStepOrder: null,
            });
          case 'rejected':
          case 'returned':
          case 'cancelled':
            return world.write(doc, {
              status: change.kind,
              reason: change.reason,
              currentStepOrder: null,
            });
          case 'touched':
            return world.write(doc, {});
        }
      },
      ref: (doc, number) => ({
        ...world.ref(doc),
        number: number === undefined ? doc.number : number,
      }),
    };

    const routingStore = Object.assign(Object.create(world.routing) as InMemoryRoutingStore, {
      docSignatures: async (_docType: DocTypeCode, docId: string): Promise<PriorSignature[]> =>
        world.signatures
          .filter((s) => s.docId === docId)
          .map((s) => ({
            userId: s.userId,
            action: s.action,
            cycle: s.cycle,
            stepOrder: s.stepOrder,
          })),
    });
    const routing = new ApprovalRoutingService(routingStore);

    return {
      adapter,
      routing,
      steps: {
        list: async (docId, cycle) =>
          structuredClone(world.steps.filter((s) => s.docId === docId && s.cycle === cycle)),
        update: async (id, changes) => {
          Object.assign(
            world.steps.find((s) => s.id === id)!,
            changes
          );
        },
        cancelWaiting: async (docId, cycle) => {
          for (const s of world.steps) {
            if (s.docId === docId && s.cycle === cycle && s.status === 'waiting')
              s.status = 'cancelled';
          }
        },
        materialise: async (docId, cycle, route) =>
          route.steps.map((s, i) => {
            const status = i === 0 ? 'pending' : 'waiting';
            world.steps.push({
              id: randomUUID(),
              docId,
              cycle,
              stepOrder: s.stepOrder,
              kind: s.kind,
              requiredRoleId: s.roleId,
              assignedUserId: null,
              status,
            });
            return { stepOrder: s.stepOrder, kind: s.kind, status };
          }),
      },
      signatures: {
        insert: async (row) => {
          world.signatures.push({ ...structuredClone(row), userId: world.actingUser });
        },
        list: async (docId) =>
          world.signatures
            .filter((s) => s.docId === docId)
            .map((s) => ({
              userId: s.userId,
              action: s.action,
              cycle: s.cycle,
              stepOrder: s.stepOrder,
            })),
      },
      notifier: {
        stepEligible: async (doc, step) => {
          const users = await routing.eligibleUsers(step, doc);
          world.notified.push({ kind: 'step', docId: doc.id, userIds: users.map((u) => u.userId) });
        },
        creator: async (doc, outcome) => {
          world.notified.push({ kind: 'creator', docId: doc.id, outcome });
        },
        reassigned: async (doc, _step, userId) => {
          world.notified.push({ kind: 'reassigned', docId: doc.id, userIds: [userId] });
        },
      },
      actorSnapshot: async (userId) => {
        world.actingUser = userId;
        return {
          nameAr: `ع ${userId.slice(0, 4)}`,
          nameEn: `U ${userId.slice(0, 4)}`,
          position: null,
        };
      },
      setAuditComment: async () => {},
      assignNumber: async (docType) => {
        const next = (world.numbers.get(docType) ?? 0) + 1;
        world.numbers.set(docType, next);
        return `${docType}-MAD-2026-${String(next).padStart(4, '0')}`;
      },
    };
  }

  /** set by actorSnapshot: the user whose signature the next insert records */
  private actingUser = '';
}
